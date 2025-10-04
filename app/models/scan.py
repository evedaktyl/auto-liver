from pydantic import BaseModel
from typing import Tuple, Dict
from datetime import datetime

class Scan(BaseModel):
    scan_id: int
    original_filename: str
    stored_filename: str
    path: str
    scan_type: str
    segmented: bool
    created_at: datetime

class ScanPreview(BaseModel):
    shape: Tuple[int, int, int]
    indices: Dict[str, int]
    
class MaskPayload(BaseModel):
    shape: tuple[int, int, int]
    data: list[int]