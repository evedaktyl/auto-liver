from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse
from pathlib import Path
from typing import List
from app.models.scan import Scan
import os

from app.services.id_generator import get_next_scan_id
from app.services.file_handler import save_to_temp, is_valid_file, save_scan
from app.services.segment import segment

router = APIRouter()

scan_metadata = {}
scan_metadata[6] = {
    "scan_id": 6,
    "filename": "test.nii.gz",
    "path": "data/1/test.nii.gz",
    "scan_type": "MRI",
    "segmented": False
}

@router.post("/")
async def upload_scan(
    file: UploadFile = File(...),
    scan_type: str = Form(...),
):
    """
    To do: accept multiple dicom files/dicom directory
    """
    temp_path = save_to_temp(file)
    file.file.seek(0)

    if not is_valid_file(temp_path):
        print(f"Invalid file: {temp_path}")
        os.remove(temp_path)
        raise HTTPException(status_code=400, detail="Invalid file type.")
    
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

@router.get("/", response_model=List[Scan])
def list_scans():
    return list(scan_metadata.values())

@router.get("/{scan_id}", response_model=Scan)
def get_scan(scan_id: int):
    if scan_id not in scan_metadata:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    return scan_metadata[scan_id]

@router.post("/{scan_id}/segment")
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