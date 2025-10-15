from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pathlib import Path
import json, io
import nibabel as nib
import numpy as np
from PIL import Image

from app.services.file_handler import delete_draft
from app.services.segment import segment
from app.services.slice_png import slice_to_png_bytes, mask_to_rgba_png_bytes
from app.services.store import save_item_to_scans_store
from app.api.routes.routes_uploads import clean_stem
from app.models.scan import MaskPayload

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
    if not items: raise HTTPException(400, "No items")
    if item_id is None: return items[0]
    for it in items:
        if it["item_id"] == item_id:
            return it
    raise HTTPException(404, "Item not found")

@router.get("/")
def list_drafts():
    drafts = []
    for d in WORKSPACE_DIR.iterdir():
        m = d / "meta.json"
        if m.exists():
            drafts.append(json.load(open(m)))
    return drafts

@router.get("/{draft_id}")
def get_draft(draft_id: str):
    return _load_meta(draft_id)

@router.get("/{draft_id}/item-shape")
def get_item_shape(
    draft_id: str,
    item: str | None = Query(None, description="item_id (e.g., I001)"),
):
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)
    img = nib.load(WORKSPACE_DIR/meta["draft_id"]/it["stored_filename"])
    x, y, z = img.shape
    return {"shape": [x, y, z]}

@router.get("/{draft_id}/slice.png")
def slice_png(
    draft_id: str,
    plane: str = Query(..., regex="^(axial|coronal|sagittal)$"),
    index: int = Query(..., ge=0),
    item: str | None = Query(None),
):
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)
    img = nib.load(WORKSPACE_DIR/meta["draft_id"]/it["stored_filename"])
    if plane == "axial":
        if index >= img.shape[2]: raise HTTPException(400, "index out of range")
        arr = np.rot90(np.asarray(img.dataobj[:, :, index], dtype=np.float32))
    elif plane == "coronal":
        if index >= img.shape[1]: raise HTTPException(400, "index out of range")
        arr = np.rot90(np.asarray(img.dataobj[:, index, :], dtype=np.float32))
    else:
        if index >= img.shape[0]: raise HTTPException(400, "index out of range")
        arr = np.rot90(np.asarray(img.dataobj[index, :, :], dtype=np.float32))
    png = slice_to_png_bytes(arr)
    return StreamingResponse(io.BytesIO(png), media_type="image/png")

def _ensure_mask(meta, it) -> Path:
    mp = it.get("mask_path")
    if mp and str(mp).strip():
        mask_path = Path(mp)
        if mask_path.exists() and mask_path.is_file():
            return mask_path

    scan_img = nib.load(WORKSPACE_DIR/meta["draft_id"]/it["stored_filename"])
    empty = np.zeros(scan_img.shape, dtype=np.uint8)

    draft_dir = _meta_path(meta["draft_id"]).parent
    base_name = clean_stem(Path(it.get("stored_filename", it["path"])))
    mask_path = draft_dir / f"{base_name}_mask.nii.gz"

    nib.save(nib.Nifti1Image(empty, scan_img.affine, scan_img.header), str(mask_path))

    it["mask_path"] = str(mask_path.resolve())
    _save_meta(meta["draft_id"], meta)

    return mask_path

@router.get("/{draft_id}/mask/slice.png")
def mask_slice_png(
    draft_id: str,
    plane: str = Query(..., regex="^(axial|coronal|sagittal)$"),
    index: int = Query(..., ge=0),
    item: str | None = Query(None),
    alpha: float = Query(1.0, ge=0.0, le=1.0),
):
    meta = _load_meta(draft_id)
    it = _get_item(meta, item)
    mask_path = _ensure_mask(meta, it)
    # mask_path = Path(it.get("mask_path") or "")
    if not mask_path.exists():
        raise HTTPException(404, "Mask not found")
    mimg = nib.load(str(mask_path))
    if plane == "axial":
        if index >= mimg.shape[2]: raise HTTPException(400, "index out of range")
        sl = np.rot90(np.asarray(mimg.dataobj[:, :, index]) > 0)
    elif plane == "coronal":
        if index >= mimg.shape[1]: raise HTTPException(400, "index out of range")
        sl = np.rot90(np.asarray(mimg.dataobj[:, index, :]) > 0)
    else:
        if index >= mimg.shape[0]: raise HTTPException(400, "index out of range")
        sl = np.rot90(np.asarray(mimg.dataobj[index, :, :]) > 0)
    png = mask_to_rgba_png_bytes(sl, color="FF0000", alpha=alpha)
    return StreamingResponse(io.BytesIO(png), media_type="image/png")

# @router.get("/{draft_id}/mask/array")
# def get_mask_array(draft_id: str, item: str | None = None):
#     meta = _load_meta(draft_id)
#     it = _get_item(meta, item)
#     mask_path = _ensure_mask(meta, it)

#     mimg = nib.load(str(mask_path))
#     arr = np.asarray(mimg.dataobj, dtype=np.uint8)
#     shape = arr.shape
#     flat = arr.flatten().tolist()

#     return {"shape": shape, "data": flat}

# @router.put("/{draft_id}/mask/array")
# def put_mask_array(draft_id: str, payload: MaskPayload, item: str | None = None):
#     meta = _load_meta(draft_id)
#     it = _get_item(meta, item)
#     mask_path = _ensure_mask(meta, it)

#     shape = tuple(payload.shape)
#     arr = np.array(payload.data, dtype=np.uint8).reshape(shape)

#     scan_img = nib.load(it["path"])
#     new_img = nib.Nifti1Image(arr, scan_img.affine, scan_img.header)
#     nib.save(new_img, str(mask_path))

#     return {"message": "Mask saved", "mask_path": str(mask_path)}

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

@router.put("/{draft_id}/mask/slice")
def put_mask_slice(
  draft_id: str,
  item: str | None = Query(None),
  plane: str = Query(..., regex="^(axial|coronal|sagittal)$"),
  index: int = Query(..., ge=0),
  png: UploadFile = File(...),   # image/png of the slice (red overlay not required; use alpha/white)
):
  meta = _load_meta(draft_id)
  it = _get_item(meta, item)
  mask_path = _ensure_mask(meta, it)

  # read PNG -> boolean slice
  raw = png.file.read()
  img = Image.open(io.BytesIO(raw)).convert("L")  # grayscale: 0..255
  sl = (np.array(img) > 0).astype(np.uint8)       # 1 = mask

  # un-rotate to volume orientation (we rotated +90 when serving)
  sl_vol = np.rot90(sl, k=3)  # inverse of rot90(...)

  mimg = nib.load(str(mask_path))
  vol = mimg.get_fdata().astype(np.uint8)

  if plane == "axial":
    if index >= vol.shape[2]: raise HTTPException(400, "index OOR")
    vol[:, :, index] = sl_vol
  elif plane == "coronal":
    if index >= vol.shape[1]: raise HTTPException(400, "index OOR")
    vol[:, index, :] = sl_vol
  else:
    if index >= vol.shape[0]: raise HTTPException(400, "index OOR")
    vol[index, :, :] = sl_vol

  nib.save(nib.Nifti1Image(vol, mimg.affine, mimg.header), str(mask_path))
  return {"message": "slice saved", "mask_path": str(mask_path)}

@router.post("/{draft_id}/delete")
def delete(draft_id: str):
    dir_to_del = WORKSPACE_DIR / draft_id
    delete_draft(dir_to_del)
    return {"message": "deleted"}