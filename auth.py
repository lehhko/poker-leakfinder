import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from pydantic import BaseModel
import bcrypt as _bcrypt
from jose import JWTError, jwt

from database import get_db
from models import User

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30

bearer = HTTPBearer(auto_error=False)


class AuthRequest(BaseModel):
    email: str
    password: str


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: Session = Depends(get_db),
) -> Optional[User]:
    if not credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None
    return db.query(User).filter(User.id == user_id).first()


def require_user(user: Optional[User] = Depends(get_current_user)) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return user


def get_router():
    router = APIRouter()

    @router.post("/register")
    def register(body: AuthRequest, db: Session = Depends(get_db)):
        if len(body.password) < 6:
            raise HTTPException(400, "Пароль минимум 6 символов")
        if db.query(User).filter(User.email == body.email).first():
            raise HTTPException(400, "Email уже зарегистрирован")
        user = User(email=body.email, hashed_password=hash_password(body.password))
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"token": create_token(user.id), "email": user.email}

    @router.post("/login")
    def login(body: AuthRequest, db: Session = Depends(get_db)):
        user = db.query(User).filter(User.email == body.email).first()
        if not user or not verify_password(body.password, user.hashed_password):
            raise HTTPException(401, "Неверный email или пароль")
        return {"token": create_token(user.id), "email": user.email}

    @router.get("/me")
    def me(user: User = Depends(require_user)):
        return {
            "id": user.id,
            "email": user.email,
            "is_subscribed": user.is_subscribed,
            "analyses_count": user.analyses_count,
        }

    return router
