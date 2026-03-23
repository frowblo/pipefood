from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import engine, Base
from app.api.routes.recipes import router as recipes_router
from app.api.routes.plans import router as plans_router
from app.api.routes.shopping_pantry import shopping_router, pantry_router

app = FastAPI(title="PipeFood API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def create_tables():
    """Create all tables on startup — replace with Alembic migrations later."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


app.include_router(recipes_router, prefix="/api")
app.include_router(plans_router, prefix="/api")
app.include_router(shopping_router, prefix="/api")
app.include_router(pantry_router, prefix="/api")
