import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv()

from database import engine
import models
models.Base.metadata.create_all(bind=engine)

# Миграция: добавляем новые колонки если их нет (безопасно при повторном запуске)
def _migrate():
    with engine.connect() as conn:
        for sql in [
            "ALTER TABLE users ADD COLUMN is_subscribed BOOLEAN DEFAULT 0",
            "ALTER TABLE users ADD COLUMN analyses_count INTEGER DEFAULT 0",
        ]:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # колонка уже существует

_migrate()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "message": "Poker Leak Finder API"}


from leak_analyzer import get_router as get_analyze_router
from auth import get_router as get_auth_router
from payment import get_router as get_payment_router

app.include_router(get_analyze_router(), prefix="/api")
app.include_router(get_auth_router(), prefix="/api/auth")
app.include_router(get_payment_router(), prefix="/api/payment")
