from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pathlib import Path
from datetime import datetime
import shutil, uuid, json, tempfile

from app.services.dicom_handler import detect_series_in_directory, convert_dicom_series_to_nifti

WORKSPACE_DIR = Path("workspace")
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/uploads", tags=["uploads"])

def short_id(n=8) -> str:
    return uuid.uuid4().hex[:n].upper()

def clean_stem(path: Path) -> str:
    name = path.name
    if name.endswith(".nii.gz"):
        return name[:-7]  # strip .nii.gz
    return path.stem

def unique_dest(dirpath: Path, filename: str) -> Path:
    name = Path(filename).name  # strip any path
    stem = clean_stem(Path(name))
    suffix = ''.join(Path(name).suffixes)  # preserves .nii.gz
    candidate = dirpath / (stem + suffix)
    i = 1
    while candidate.exists():
        candidate = dirpath / f"{stem}_{i}{suffix}"
        i += 1
    return candidate

@router.post("/")
async def upload_scan(
    files: list[UploadFile] = File(...),
    scan_type: str = Form(...),  # Required field
    title: str | None = Form(None),
    is_dicom_series: bool = Form(False),
    selected_series_uids: str | None = Form(None),  # JSON string of series UIDs
):
    """
    Upload scan files. Handles both individual files and DICOM series conversion.

    If is_dicom_series=True:
        - Detects series in uploaded files
        - Converts selected series (or all) to NIfTI
        - Saves as items in draft workspace
    Else:
        - Saves files directly to workspace (current behavior)
    """
    if not scan_type or scan_type not in ["CT", "MRI"]:
        return JSONResponse(
            {"error": "scan_type is required and must be either 'CT' or 'MRI'"},
            status_code=400
        )
    draft_id = short_id(8)
    draft_dir = WORKSPACE_DIR / draft_id
    draft_dir.mkdir(parents=True, exist_ok=True)

    items = []

    if is_dicom_series:
        temp_dir = Path(tempfile.mkdtemp(prefix="dicom_upload_"))

        try:
            # Save all uploaded files to temp directory
            for uploaded_file in files:
                dest_file = temp_dir / uploaded_file.filename
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                with dest_file.open("wb") as f:
                    shutil.copyfileobj(uploaded_file.file, f)

            # Detect series
            series_list = detect_series_in_directory(temp_dir)

            # Filter by selected UIDs if provided
            if selected_series_uids:
                selected_uids = json.loads(selected_series_uids)
                series_list = [s for s in series_list if s.series_uid in selected_uids]

            # Convert each series to NIfTI
            for i, series in enumerate(series_list):
                # Generate filename: series_{number}_{description}.nii.gz
                safe_description = "".join(c if c.isalnum() or c in (' ', '_') else '_'
                                          for c in series.series_description)
                safe_description = safe_description.strip().replace(' ', '_')[:50]

                filename = f"series_{series.series_number}_{safe_description}.nii.gz"
                output_path = draft_dir / filename

                convert_dicom_series_to_nifti(series, output_path)

                items.append({
                    "item_id": f"I{i+1:03d}",
                    "path": str(output_path.resolve()),
                    "original_filename": f"DICOM_Series_{series.series_number}",
                    "stored_filename": filename,
                    "segmented": False,
                    "source_format": "dicom",
                    "dicom_metadata": {
                        "series_uid": series.series_uid,
                        "series_description": series.series_description,
                        "series_number": series.series_number,
                        "modality": series.modality,
                        "num_source_files": series.num_slices,
                        "patient_id": series.patient_id,
                        "study_description": series.study_description
                    }
                })

        finally:
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)

    else:
        for i, f in enumerate(files):
            dest = unique_dest(draft_dir, f.filename)
            with dest.open("wb") as out:
                shutil.copyfileobj(f.file, out)

            items.append({
                "item_id": f"I{i+1:03d}",
                "path": str(dest.resolve()),
                "original_filename": Path(f.filename).name,
                "stored_filename": dest.name,
                "segmented": False,
            })

    meta = {
        "draft_id": draft_id,
        "title": title,
        "scan_type": scan_type,
        "segmented": False,
        "items": items,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    (draft_dir / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    return JSONResponse({"message": "Uploaded", "draft_id": draft_id})

@router.post("/scan-directory")
async def scan_directory(directory_files: list[UploadFile] = File(...)):
    """
    Analyze uploaded directory contents for DICOM series.
    Returns list of detected series metadata for frontend confirmation.

    Frontend sends ALL files from directory.
    Backend detects series and returns summary WITHOUT saving files yet.
    """
    temp_dir = Path(tempfile.mkdtemp(prefix="dicom_scan_"))

    try:
        # Save all uploaded files to temp directory, preserving relative paths
        for uploaded_file in directory_files:
            relative_path = Path(uploaded_file.filename)
            dest_file = temp_dir / relative_path.name
            dest_file.parent.mkdir(parents=True, exist_ok=True)

            with dest_file.open("wb") as f:
                shutil.copyfileobj(uploaded_file.file, f)

        series_list = detect_series_in_directory(temp_dir)

        if not series_list:
            return JSONResponse({
                "series": [],
                "message": "No DICOM series detected"
            })

        series_data = [s.to_dict() for s in series_list]

        return JSONResponse({
            "series": series_data,
            "temp_dir": str(temp_dir),  # Keep temp dir for subsequent upload
            "message": f"Found {len(series_list)} series"
        })

    except Exception as e:
        if temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise e

