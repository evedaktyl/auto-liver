from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes_scans import router as scans_router

app = FastAPI(
    title="Auto Liver Segmentation",
    description="Upload, segment, edit, and manage MRI/CT scans.",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scans_router, prefix="/scans", tags=["Scans"])