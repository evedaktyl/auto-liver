from typing import Dict, Tuple
from pathlib import Path
from fastapi import UploadFile
import shutil

from id_generator import get_next_scan_id

SCANS_DIR = Path("data/scans")
SCANS_DIR.mkdir(parents=True, exist_ok=True)

def save_scan(file: UploadFile) -> Tuple[int, Path]:
    scan_id = get_next_scan_id()
    scan_dir = SCANS_DIR / str(scan_id)
    scan_dir.mkdir(parents=True, exist_ok=True)
    destination = scan_dir / file.filename

    with destination.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    return scan_id, destination


