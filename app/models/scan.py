from pydantic import BaseModel

class Scan(BaseModel):
    scan_id: int
    filename: str
    path: str
    