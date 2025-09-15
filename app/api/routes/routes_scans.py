# app/routes/routes_scans.py
from fastapi import APIRouter, HTTPException
from pathlib import Path
import json, os, shutil
from datetime import datetime

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

@router.get("/")
def list_scans():
    scans = []
    for d in SCANS_DIR.iterdir():
        m = d / "meta.json"
        if m.exists():
            scans.append(json.load(open(m)))
    return scans
