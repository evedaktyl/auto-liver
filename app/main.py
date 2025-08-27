from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.routes_scans import router as scans_router
from app.api.routes.routes_uploads import router as uploads_router
from app.api.routes.routes_drafts import router as drafts_router


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

app.include_router(scans_router)
app.include_router(uploads_router)
app.include_router(drafts_router)