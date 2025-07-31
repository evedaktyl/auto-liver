from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse
from pathlib import Path
import shutil
from typing import List
from models.scan import Scan

from services.id_generator import get_next_scan_id
from services.file_handler import save_scan, get_scans
from services.segment import segment

router = APIRouter()

scan_metadata = {}

@router.post("/upload")
async def upload_scan(
    file: UploadFile = File(...),
    scan_type: str = Form(...),
):
    try: 
        scan_id, path = save_scan(file)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    
    scan_metadata[scan_id] = {
        "scan_id": scan_id,
        "filename": file.filename,
        "path": str(path),
        "scan_type": scan_type,
        "segmented": False
    }
    return JSONResponse({"message": "Scan uploaded.", "scan_id": scan_id})

@router.get("/scans", response_model=List[Scan])
def list_scans():
    return list(scan_metadata.values())

@router.get("/scans/{scan_id}", response_model=Scan)
def get_scan(scan_id: int):
    if scan_id not in scan_metadata:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    return scan_metadata[scan_id]

@router.post("/scan/{scan_id}/segment")
def segment_scan(scan_id: int):
    if scan_id not in scan_metadata:
        raise HTTPException(status_code=404, detail="Scan not found.")
    
    scan_info = scan_metadata[scan_id]
    scan_path = Path(scan_info["path"])
    scan_type = scan_info.get("scan_type", "CT")

    if scan_info.get("segmented", False):
        return {"message": "Already segmented", "mask_path": str(scan_path.parent / "mask.nii.gz")}
    
    try: 
        mask_path = segment(scan_path, scan_type)
        scan_info["segmented"] = True
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")

    return {"message": "Segmentation complete", "mask_path": str(mask_path)}