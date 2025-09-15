from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pathlib import Path
from datetime import datetime
import shutil, uuid, json

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
    scan_type: str = Form("CT"),
    title: str | None = Form(None),
):
    draft_id = short_id(8)
    draft_dir = WORKSPACE_DIR / draft_id
    draft_dir.mkdir(parents=True, exist_ok=True)

    items = []
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
            "mask_path": None,
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
