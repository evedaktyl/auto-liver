# app/routes/routes_scans.py
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pathlib import Path
import json, os, shutil
from datetime import datetime
import nibabel as nib
import numpy as np
import zlib

SCANS_DIR = Path("data/scans")
SCANS_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/scans", tags=["scans"])

def save_scan(draft_meta: dict):
    scan_id = len(list(SCANS_DIR.iterdir())) + 1
    scan_dir = SCANS_DIR / str(scan_id)
    scan_dir.mkdir(parents=True, exist_ok=True)

    for f in draft_meta["files"]:
        shutil.copy(f, scan_dir)

    meta = {
        "scan_id": scan_id,
        "files": [str(scan_dir / Path(f).name) for f in draft_meta["files"]],
        "scan_type": draft_meta["scan_type"],
        "segmented": draft_meta.get("segmented", False),
        "mask_path": draft_meta.get("mask_path"),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    with (scan_dir / "meta.json").open("w") as m:
        json.dump(meta, m, indent=2)
    return scan_id, meta

def _volume_to_payload(arr: np.ndarray) -> bytes:
    """Convert 3D numpy array to compressed binary payload with shape header."""
    arr = np.ascontiguousarray(arr.astype(np.float32))
    X, Y, Z = arr.shape
    header = np.array([X, Y, Z], dtype=np.int32).tobytes()
    compressed = zlib.compress(arr.tobytes(order="C"), level=6)
    return header + compressed

def _load_scan_meta(scan_id: str) -> dict:
    meta_path = SCANS_DIR / scan_id / "meta.json"
    if not meta_path.exists():
        raise HTTPException(404, "Scan not found")
    return json.loads(meta_path.read_text(encoding="utf-8"))

@router.get("/")
def list_scans():
    scans = []
    for d in SCANS_DIR.iterdir():
        m = d / "meta.json"
        if m.exists():
            scans.append(json.load(open(m)))
    return scans

@router.get("/{scan_id}")
def get_scan_meta(scan_id: str):
    return _load_scan_meta(scan_id)

@router.get("/{scan_id}/scan")
def get_scan_volume(scan_id: str):
    meta = _load_scan_meta(scan_id)
    scan_path = meta.get("path")
    if not scan_path or not Path(scan_path).exists():
        raise HTTPException(404, "Scan file not found")

    img = nib.load(scan_path)
    arr = np.asarray(img.dataobj, dtype=np.float32)
    payload = _volume_to_payload(arr)

    return Response(content=payload, media_type="application/octet-stream")

@router.get("/{scan_id}/mask")
def get_scan_mask(scan_id: str):
    meta = _load_scan_meta(scan_id)
    mask_path = meta.get("mask_path")

    # If mask exists, return it
    if mask_path and Path(mask_path).exists():
        img = nib.load(str(mask_path))
        arr = np.asarray(img.dataobj, dtype=np.float32)
    else:
        # No mask - return empty mask with scan's shape
        scan_path = meta.get("path")
        if not scan_path:
            raise HTTPException(404, "Scan path not found")
        scan_img = nib.load(scan_path)
        arr = np.zeros(scan_img.shape, dtype=np.float32)

    payload = _volume_to_payload(arr)
    return Response(content=payload, media_type="application/octet-stream")
