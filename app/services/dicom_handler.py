"""
DICOM series detection and handling utilities.
Handles directories of DICOM files, groups by series, and converts to NIfTI.
"""

from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict
import pydicom
from pydicom.misc import is_dicom
import tempfile
import shutil

@dataclass
class DicomSeries:
    """Represents a detected DICOM series."""
    series_uid: str
    series_description: str
    series_number: int
    modality: str
    num_slices: int
    files: List[Path]
    patient_id: Optional[str] = None
    study_description: Optional[str] = None

    def __str__(self):
        return f"Series {self.series_number}: {self.series_description} ({self.modality}, {self.num_slices} slices)"

    def to_dict(self):
        """Convert to dictionary, excluding files list for JSON serialization."""
        d = asdict(self)
        d.pop('files')  # Remove file paths for API response
        return d


def scan_directory_for_dicoms(directory: Path, recursive: bool = True) -> List[Path]:
    """
    Recursively scan directory for DICOM files (including extensionless).

    Args:
        directory: Root directory to scan
        recursive: Whether to scan subdirectories

    Returns:
        List of paths to valid DICOM files
    """
    dicom_files = []

    if recursive:
        files = directory.rglob("*")
    else:
        files = directory.glob("*")

    for filepath in files:
        if not filepath.is_file():
            continue

        # Skip hidden files and common non-DICOM extensions
        if filepath.name.startswith('.'):
            continue
        if filepath.suffix.lower() in ['.txt', '.pdf', '.xml', '.json', '.log', '.md']:
            continue

        try:
            if is_dicom(str(filepath)):
                dicom_files.append(filepath)
        except Exception:
            pass

    return dicom_files


def group_dicom_files_by_series(dicom_files: List[Path]) -> Dict[str, DicomSeries]:
    """
    Group DICOM files by SeriesInstanceUID.

    Args:
        dicom_files: List of DICOM file paths

    Returns:
        Dictionary mapping SeriesInstanceUID to DicomSeries objects
    """
    series_dict: Dict[str, List[Tuple[Path, pydicom.Dataset]]] = {}

    # First pass: group by series UID
    for filepath in dicom_files:
        try:
            dcm = pydicom.dcmread(str(filepath), stop_before_pixels=True)
            series_uid = str(dcm.SeriesInstanceUID)

            if series_uid not in series_dict:
                series_dict[series_uid] = []

            series_dict[series_uid].append((filepath, dcm))

        except Exception as e:
            print(f"Warning: Could not read DICOM file {filepath}: {e}")
            continue

    # Second pass: create DicomSeries objects
    series_objects = {}

    for series_uid, files_and_datasets in series_dict.items():
        if not files_and_datasets:
            continue

        # Use first file to get series metadata
        first_file, first_dcm = files_and_datasets[0]

        # Sort files by instance number or slice location
        sorted_files = sort_dicom_files(files_and_datasets)

        series = DicomSeries(
            series_uid=series_uid,
            series_description=str(getattr(first_dcm, 'SeriesDescription', 'Unknown')),
            series_number=int(getattr(first_dcm, 'SeriesNumber', 0)),
            modality=str(getattr(first_dcm, 'Modality', 'Unknown')),
            num_slices=len(sorted_files),
            files=sorted_files,
            patient_id=str(getattr(first_dcm, 'PatientID', None)),
            study_description=str(getattr(first_dcm, 'StudyDescription', None))
        )

        series_objects[series_uid] = series

    return series_objects


def sort_dicom_files(files_and_datasets: List[Tuple[Path, pydicom.Dataset]]) -> List[Path]:
    """
    Sort DICOM files by InstanceNumber or SliceLocation.

    Args:
        files_and_datasets: List of (filepath, dataset) tuples

    Returns:
        Sorted list of file paths
    """
    # Try to sort by InstanceNumber first
    try:
        sorted_pairs = sorted(
            files_and_datasets,
            key=lambda x: int(getattr(x[1], 'InstanceNumber', 0))
        )
        return [filepath for filepath, _ in sorted_pairs]
    except (AttributeError, ValueError, TypeError):
        pass

    # Try SliceLocation
    try:
        sorted_pairs = sorted(
            files_and_datasets,
            key=lambda x: float(getattr(x[1], 'SliceLocation', 0.0))
        )
        return [filepath for filepath, _ in sorted_pairs]
    except (AttributeError, ValueError, TypeError):
        pass

    # Fallback: sort by filename
    sorted_pairs = sorted(files_and_datasets, key=lambda x: x[0].name)
    return [filepath for filepath, _ in sorted_pairs]


def convert_dicom_series_to_nifti(series: DicomSeries, output_path: Path) -> Path:
    """
    Convert a DICOM series to NIfTI format using dicom2nifti.

    Args:
        series: DicomSeries object with files to convert
        output_path: Output path for NIfTI file (should end in .nii.gz)

    Returns:
        Path to created NIfTI file
    """
    import dicom2nifti
    import dicom2nifti.settings as settings

    # Configure dicom2nifti settings to be more permissive
    settings.disable_validate_orthogonal()
    settings.disable_validate_slice_increment()

    # Create temporary directory with DICOM files
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Copy DICOM files to temp directory with sequential naming
        for i, dicom_file in enumerate(series.files):
            dest = temp_path / f"{i:04d}.dcm"
            shutil.copy2(dicom_file, dest)

        # Convert directory to NIfTI
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # dicom2nifti.convert_directory writes to output_dir
        try:
            dicom2nifti.convert_directory(
                str(temp_path),
                str(output_path.parent),
                compression=True,
                reorient=True
            )
        except Exception as e:
            raise RuntimeError(f"NIfTI conversion failed for series {series.series_uid}: {e}")

        # Find the generated file (dicom2nifti may add suffixes or use different naming)
        generated_files = list(output_path.parent.glob("*.nii.gz"))
        if not generated_files:
            generated_files = list(output_path.parent.glob("*.nii"))

        if generated_files:
            # Rename to expected output path if necessary
            if generated_files[0] != output_path:
                generated_files[0].rename(output_path)
            return output_path
        else:
            raise RuntimeError(f"NIfTI conversion produced no output for series {series.series_uid}")


def detect_series_in_directory(directory: Path) -> List[DicomSeries]:
    """
    Main entry point: detect all DICOM series in a directory.

    Args:
        directory: Directory path to scan

    Returns:
        List of detected DicomSeries objects, sorted by series number
    """
    dicom_files = scan_directory_for_dicoms(directory, recursive=True)

    if not dicom_files:
        return []

    series_dict = group_dicom_files_by_series(dicom_files)
    series_list = sorted(series_dict.values(), key=lambda s: s.series_number)

    return series_list