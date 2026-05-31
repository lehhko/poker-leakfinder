import os
import hmac
import hashlib
import json
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from models import User
from auth import require_user

NOWPAYMENTS_API_KEY = os.getenv("NOWPAYMENTS_API_KEY", "")
NOWPAYMENTS_IPN_SECRET = os.getenv("NOWPAYMENTS_IPN_SECRET", "")
NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1"
APP_URL = os.getenv("APP_URL", "http://localhost:5173")

PLANS = {
    "monthly":  {"amount": 9.0,  "label": "Месячная подписка"},
    "lifetime": {"amount": 29.0, "label": "Навсегда"},
}


def _verify_signature(payload: bytes, signature: str) -> bool:
    if not NOWPAYMENTS_IPN_SECRET:
        return True  # dev mode — skip verification
    data = json.dumps(json.loads(payload), sort_keys=True, separators=(",", ":"))
    expected = hmac.new(
        NOWPAYMENTS_IPN_SECRET.encode(), data.encode(), hashlib.sha512
    ).hexdigest()
    return hmac.compare_digest(expected, signature.lower())


def get_router():
    router = APIRouter()

    @router.post("/create")
    async def create_payment(
        plan: str,
        user: User = Depends(require_user),
    ):
        if plan not in PLANS:
            raise HTTPException(400, "Неизвестный план")
        if user.is_subscribed:
            raise HTTPException(400, "У тебя уже есть подписка")

        p = PLANS[plan]
        if not NOWPAYMENTS_API_KEY:
            raise HTTPException(503, "Платёжная система не настроена")

        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"{NOWPAYMENTS_BASE}/invoice",
                headers={"x-api-key": NOWPAYMENTS_API_KEY},
                json={
                    "price_amount": p["amount"],
                    "price_currency": "usd",
                    "order_id": f"user_{user.id}_{plan}",
                    "order_description": f"Poker Leakfinder — {p['label']}",
                    "ipn_callback_url": f"{APP_URL}/api/payment/webhook",
                    "success_url": f"{APP_URL}?payment=success",
                    "cancel_url": f"{APP_URL}?payment=cancel",
                },
            )
        if not res.is_success:
            raise HTTPException(502, "Ошибка платёжной системы")

        data = res.json()
        return {"payment_url": data.get("invoice_url"), "plan": plan}

    @router.post("/webhook")
    async def payment_webhook(request: Request, db: Session = Depends(get_db)):
        payload = await request.body()
        signature = request.headers.get("x-nowpayments-sig", "")

        if not _verify_signature(payload, signature):
            raise HTTPException(400, "Invalid signature")

        data = json.loads(payload)
        status = data.get("payment_status", "")

        if status in ("finished", "confirmed", "partially_paid"):
            order_id: str = data.get("order_id", "")
            try:
                user_id = int(order_id.split("_")[1])
            except (IndexError, ValueError):
                return {"status": "ok"}

            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.is_subscribed = True
                db.commit()

        return {"status": "ok"}

    @router.get("/plans")
    def get_plans():
        return [
            {"id": k, "label": v["label"], "amount_usd": v["amount"]}
            for k, v in PLANS.items()
        ]

    return router
