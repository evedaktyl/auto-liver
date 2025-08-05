from typing import Dict, Tuple
from pathlib import Path
from fastapi import UploadFile
import shutil
from pydicom.misc import is_dicom
import nibabel as nib
import tempfile

from app.services.id_generator import get_next_scan_id

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCANS_DIR = PROJECT_ROOT / "data" / "scans"
SCANS_DIR.mkdir(parents=True, exist_ok=True)

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
    
def save_scan(file: UploadFile) -> Tuple[int, Path]:
    scan_id = get_next_scan_id()
    scan_dir = SCANS_DIR / str(scan_id)
    scan_dir.mkdir(parents=True, exist_ok=True)
    destination = scan_dir / file.filename

    with destination.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    return scan_id, destination