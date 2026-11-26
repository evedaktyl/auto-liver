from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pathlib import Path
import json
import os
import nibabel as nib
import numpy as np
import zlib

from app.services.file_handler import delete_draft
from app.services.segment import segment
from app.services.store import save_item_to_scans_store
from app.api.routes.routes_uploads import clean_stem

WORKSPACE_DIR = Path("workspace")
router = APIRouter(prefix="/drafts", tags=["Drafts"])

def _meta_path(draft_id: str) -> Path:
    return WORKSPACE_DIR / draft_id / "meta.json"

def _load_meta(draft_id: str) -> dict:
    mp = _meta_path(draft_id)
    if not mp.exists():
        raise HTTPException(404, "Draft not found")
    return json.loads(mp.read_text(encoding="utf-8"))

def _save_meta(draft_id: str, meta: dict):
    _meta_path(draft_id).write_text(json.dumps(meta, indent=2), encoding="utf-8")

def _get_item(meta: dict, item_id: str | None) -> dict:
    items = meta.get("items") or []
    if not items:
        raise HTTPException(400, "No items")
    if item_id is None:
        return items[0]
    for it in items:
        if it["item_id"] == item_id:
            return it
    raise HTTPException(404, "Item not found")

def _volume_to_payload(arr: np.ndarray) -> bytes:
    """Convert 3D numpy array to compressed binary payload with shape header."""
    arr = np.ascontiguousarray(arr.astype(np.float32))
    X, Y, Z = arr.shape
    header = np.array([X, Y, Z], dtype=np.int32).tobytes()
    compressed = zlib.compress(arr.tobytes(order="C"), level=6)
    return header + compressed

@router.get("/")
def list_drafts():
    if not WORKSPACE_DIR.exists():
        return []
    drafts = []
    for d in WORKSPACE_DIR.iterdir():
        m = d / "meta.json"
        if m.exists():
            drafts.append(json.loads(m.read_text()))
    return drafts

@router.get("/{draft_id}")
def get_draft(draft_id: str):
    return _load_meta(draft_id)

@router.get("/{draft_id}/scan")
def get_scan(draft_id: str, item: str | None = Query(None)):
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)

    img = nib.load(it["path"])
    arr = np.asarray(img.dataobj, dtype=np.float32)
    payload = _volume_to_payload(arr)

    return Response(content=payload, media_type="application/octet-stream")

@router.get("/{draft_id}/mask")
def get_mask(draft_id: str, item: str | None = Query(None)):
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)
    mask_path = it.get("mask_path")

    # If mask exists, return it
    if mask_path and Path(mask_path).exists():
        img = nib.load(str(mask_path))
        arr = np.asarray(img.dataobj, dtype=np.float32)
    else:
        # No mask yet - return empty mask with scan's shape
        scan_img = nib.load(it["path"])
        arr = np.zeros(scan_img.shape, dtype=np.float32)

    payload = _volume_to_payload(arr)
    return Response(content=payload, media_type="application/octet-stream")

@router.put("/{draft_id}/mask")
async def put_mask(draft_id: str, request: Request, item: str | None = Query(None)):
    """Replace the item's mask with an edited one.

    Body: int32 [X, Y, Z] header followed by a zlib-compressed uint8 array (C order).
    """
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)
    mask_path = it.get("mask_path")
    if not mask_path or not Path(mask_path).exists():
        raise HTTPException(400, "Item has no mask to update")
    mask_path = Path(mask_path)

    body = await request.body()
    if len(body) < 12:
        raise HTTPException(400, "Payload too short")
    shape = tuple(int(v) for v in np.frombuffer(body[:12], dtype=np.int32))

    ref = nib.load(str(mask_path))
    if shape != tuple(ref.shape):
        raise HTTPException(400, f"Shape {shape} does not match mask shape {tuple(ref.shape)}")
    affine = ref.affine.copy()
    header = ref.header.copy()
    del ref

    try:
        data = zlib.decompress(body[12:])
    except zlib.error:
        raise HTTPException(400, "Payload is not valid zlib data")
    if len(data) != int(np.prod(shape)):
        raise HTTPException(400, "Payload size does not match shape")

    arr = (np.frombuffer(data, dtype=np.uint8).reshape(shape) > 0).astype(np.uint8)
    header.set_data_dtype(np.uint8)
    out = nib.Nifti1Image(arr, affine, header)

    # Write next to the target, then swap, so a failed write cannot corrupt the mask
    tmp_path = mask_path.with_name(f"tmp_{mask_path.name}")
    nib.save(out, str(tmp_path))
    os.replace(tmp_path, mask_path)

    return {"message": "ok", "voxels": int(arr.sum())}

@router.get("/{draft_id}/geometry")
def get_geometry(draft_id: str, item: str | None = Query(None)):
    """Voxel grid geometry of the scan: shape, spacing (mm) and voxel-to-world (RAS) affine."""
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)

    img = nib.load(it["path"])
    return {
        "shape": [int(v) for v in img.shape[:3]],
        "spacing": [float(v) for v in img.header.get_zooms()[:3]],
        "affine": [[float(v) for v in row] for row in img.affine],
    }

@router.post("/{draft_id}/segment")
def segment_one(draft_id: str, item: str | None = Query(None)):
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)

    draft_dir = _meta_path(draft_id).parent
    stem = clean_stem(Path(it["stored_filename"])) if it.get("stored_filename") else clean_stem(Path(it["path"]))
    mask_path = draft_dir / f"{stem}_mask.nii.gz"

    out_path = segment(Path(it["path"]), meta.get("scan_type", "CT"), output_path=mask_path)

    it["segmented"] = True
    it["mask_path"] = str(Path(out_path).resolve())
    _save_meta(draft_id, meta)
    return {"message": "ok", "mask_path": it["mask_path"]}

@router.post("/{draft_id}/save")
def save_selected(draft_id: str, item: str | None = Query(None)):
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)
    scan = Path(it["path"])
    mask = Path(it["mask_path"]) if it.get("mask_path") else None
    saved = save_item_to_scans_store(scan, mask, it["segmented"], meta.get("scan_type", "CT"))
    return {"message": "saved", "scan_id": saved["scan_id"]}

@router.post("/{draft_id}/save_all")
def save_all(draft_id: str):
    meta = _load_meta(draft_id)
    results = []
    for it in meta.get("items") or []:
        mask = Path(it["mask_path"]) if it.get("mask_path") else None
        if mask and mask.exists():
            saved = save_item_to_scans_store(Path(it["path"]), mask, it["segmented"], meta.get("scan_type", "CT"))
            results.append(saved["scan_id"])
    return {"message": "saved", "count": len(results), "scan_ids": results}

@router.post("/{draft_id}/delete")
def delete(draft_id: str):
    dir_to_del = WORKSPACE_DIR / draft_id
    delete_draft(dir_to_del)
    return {"message": "deleted"}
