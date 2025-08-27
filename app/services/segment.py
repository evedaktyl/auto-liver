from pathlib import Path
from totalsegmentator.python_api import totalsegmentator
import tempfile
import shutil
import numpy as np

def segment(filepath: Path, scan_type: str = "CT", output_path: str = "") -> Path:
    """
    Runs TotalSegmentator on the scan and saves the liver mask
    in the same directory.
    
    Returns Path to the output mask.
    """
    if not filepath.exists():
        raise FileNotFoundError(f"Scan file not found: {filepath}")
    
    task = "total_mr" if scan_type == "MRI" else "total"
    temp_output = Path(tempfile.mkdtemp())

    totalsegmentator(
        input=filepath,
        output=temp_output,
        task=task,
        quiet=True,
        fast=True,
        ml=False,
        skip_saving=False,
        output_type="nifti"
    )

    liver_mask_path = temp_output/"liver.nii.gz"
    if not liver_mask_path.exists():
        raise RuntimeError("Liver mask was not found.")
    
    destination_path = filepath.parent / "mask.nii.gz"
    shutil.copy(liver_mask_path, output_path)

    return output_path
