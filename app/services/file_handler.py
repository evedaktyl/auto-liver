from datetime import datetime
from typing import Dict, Tuple
from pathlib import Path
from fastapi import UploadFile
import shutil
from pydicom.misc import is_dicom
import nibabel as nib
import tempfile, os, json

from app.services.id_generator import get_next_scan_id

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCANS_DIR = PROJECT_ROOT / "data" / "scans"
SCANS_DIR.mkdir(parents=True, exist_ok=True)

def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())

def save_to_temp(file: UploadFile) -> str:
    full_suffix = ''.join(Path(file.filename).suffixes)
    with tempfile.NamedTemporaryFile(delete=False, suffix=full_suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        temp_path = tmp.name
    return temp_path

def is_valid_file(filepath: Path) -> bool:
    if is_dicom(filepath):
        return True
    try:
        nib.load(str(filepath))
        return True
    except Exception:
        return False
    
def save_scan(file: UploadFile, scan_type: str) -> Tuple[int, dict]:
    scan_id = get_next_scan_id()
    scan_dir = SCANS_DIR / f"{scan_id:06d}"
    scan_dir.mkdir(parents=True, exist_ok=True)

    original_name = Path(file.filename).name
    ext = ''.join(Path(original_name).suffixes)
    dest_name = "scan" + (ext or "")
    destination = scan_dir / dest_name

    with destination.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    meta = {
        "scan_id": scan_id,
        "original_filename": original_name,
        "stored_filename": dest_name,
        "path": str(destination),
        "scan_type": scan_type,
        "segmented": False,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    meta_destination = scan_dir / "meta.json"
    with open(meta_destination, "w") as f:
        json.dump(meta, f, indent=4)

    return scan_id, meta

def delete_draft(draft_dir: Path):
    shutil.rmtree(draft_dir)