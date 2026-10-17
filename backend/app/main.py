from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import settings
from app.errors import install_error_handlers

app = FastAPI(title="Operations Under Pressure", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Idempotent-Replayed"],
)
install_error_handlers(app)
app.include_router(router, prefix="/api")


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}
