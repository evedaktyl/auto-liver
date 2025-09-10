from pathlib import Path
import shutil, json
from datetime import datetime
from app.services.id_generator import get_next_scan_id
import os

SCANS_DIR = Path("data/scans")
SCANS_DIR.mkdir(parents=True, exist_ok=True)

def save_item_to_scans_store(src_scan: Path, src_mask: Path | None, segmented: bool, scan_type: str) -> dict:
    scan_id = get_next_scan_id()
    out_dir = SCANS_DIR / str(scan_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Copy over to data folder
    dst_scan = out_dir / src_scan.name
    shutil.copy2(src_scan, dst_scan)
    dst_mask = None
    if src_mask and src_mask.exists():
        dst_mask = out_dir / src_mask.name
        shutil.copy2(src_mask, dst_mask)

    try:
        src_scan.unlink(missing_ok=True)
        if src_mask and src_mask.exists():
            src_mask.unlink(missing_ok=True)
    except Exception as e:
        # Optional: log but don't break saving
        print(f"Warning: could not delete originals: {e}")

    # Update draft meta.json
    draft_dir = src_scan.parent  # folder containing the draft files
    draft_meta_path = draft_dir / "meta.json"

    if draft_meta_path.exists():
        try:
            draft_meta = json.loads(draft_meta_path.read_text(encoding="utf-8"))
            items = draft_meta.get("items", [])

            # Keep only items that are NOT this src_scan
            new_items = [it for it in items if it.get("path") != str(src_scan)]

            if new_items:
                draft_meta["items"] = new_items
                draft_meta_path.write_text(json.dumps(draft_meta, indent=2), encoding="utf-8")
            else:
                # If no items left, delete the whole draft folder
                shutil.rmtree(draft_dir, ignore_errors=True)

        except Exception as e:
            print(f"Warning: could not update draft meta.json: {e}")

    meta = {
        "scan_id": scan_id,
        "filename": src_scan.name,
        "path": str(dst_scan.resolve()),
        "scan_type": scan_type,
        "segmented": segmented,
        "mask_path": str(dst_mask.resolve()) if dst_mask else None,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta
