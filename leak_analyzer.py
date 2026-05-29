"""
Leak Analyzer — отправляет статистику игрока в Claude API
и получает структурированный разбор слабых мест.
"""

import json
import os
import httpx
from hand_parser import parse_file, compute_stats


# ---------------------------------------------------------------------------
# Референсные диапазоны для NL кэш (6-max)
# Используются в промпте чтобы Claude мог сравнить
# ---------------------------------------------------------------------------

BENCHMARKS = {
    "vpip_pct":      {"reg": (22, 28), "fish": (35, 60),  "nit": (10, 18)},
    "pfr_pct":       {"reg": (18, 24), "fish": (5,  15),  "nit": (8,  14)},
    "three_bet_pct": {"reg": (6,  10), "fish": (1,  4),   "nit": (3,  6)},
    "wtsd_pct":      {"reg": (24, 30), "fish": (35, 50),  "nit": (18, 24)},
    "cbet_flop_pct": {"reg": (55, 70), "fish": (30, 50),  "nit": (45, 60)},
}

POSITION_BB_100_BENCHMARKS = {
    "BTN": (8, 20),   # ожидаемый диапазон BB/100 для рега
    "CO":  (4, 12),
    "HJ":  (2, 8),
    "UTG": (-2, 5),
    "SB":  (-8, -2),
    "BB":  (-6, 0),
}


def _classify_stat(key: str, value: float) -> str:
    """Возвращает оценку стата: 'норма' / 'слишком высокий' / 'слишком низкий'."""
    if key not in BENCHMARKS:
        return "норма"
    reg_low, reg_high = BENCHMARKS[key]["reg"]
    if value < reg_low:
        return "слишком низкий"
    if value > reg_high:
        return "слишком высокий"
    return "норма"


def _position_assessment(positions: dict) -> str:
    """Текстовый блок с оценкой каждой позиции."""
    lines = []
    for pos, data in positions.items():
        bb100 = data["bb_per_100"]
        benchmark = POSITION_BB_100_BENCHMARKS.get(pos)
        if benchmark:
            lo, hi = benchmark
            if bb100 < lo:
                verdict = f"убыточная (норма {lo}..{hi})"
            elif bb100 > hi:
                verdict = f"отличная (норма {lo}..{hi})"
            else:
                verdict = f"в норме (норма {lo}..{hi})"
        else:
            verdict = "нет бенчмарка"

        lines.append(
            f"  {pos}: {bb100:+.1f} BB/100 за {data['hands']} раздач — {verdict}"
            f"  (VPIP {data['vpip_pct']}% / PFR {data['pfr_pct']}%)"
        )
    return "\n".join(lines) if lines else "  нет данных"


def build_prompt(stats: dict) -> str:
    """
    Формирует системный промпт + user-сообщение для Claude.
    Возвращает кортеж (system, user).
    """

    # --- Собираем диагностику по каждому стату ---
    stat_diagnostics = []
    for key, label in [
        ("vpip_pct",      "VPIP"),
        ("pfr_pct",       "PFR"),
        ("three_bet_pct", "3-bet %"),
        ("wtsd_pct",      "WTSD %"),
        ("cbet_flop_pct", "CBet флоп %"),
    ]:
        val = stats.get(key, 0)
        verdict = _classify_stat(key, val)
        reg_range = BENCHMARKS.get(key, {}).get("reg", ("?", "?"))
        stat_diagnostics.append(
            f"  {label}: {val}% (норма рега: {reg_range[0]}–{reg_range[1]}%) — {verdict}"
        )

    position_block = _position_assessment(stats.get("positions", {}))

    losses = stats.get("losses_by_street", {})
    total_loss = sum(v for v in losses.values() if v < 0)
    street_lines = []
    for street, val in losses.items():
        if val < 0 and total_loss != 0:
            pct = abs(val / total_loss * 100)
            street_lines.append(f"  {street}: {val:+.1f} BB ({pct:.0f}% от всех потерь)")

    # -------------------------------------------------------------------
    # SYSTEM PROMPT — роль и формат ответа
    # -------------------------------------------------------------------
    system = """Ты — AI-коуч по покеру. Ты анализируешь статистику игрока и находишь конкретные слабые места (leak-и).

Твои правила:
1. Пиши на русском языке, доступно — без GTO-жаргона там где можно объяснить проще.
2. Каждый leak — это конкретная проблема с конкретным советом, а не общая фраза.
3. Выдели ровно 3 главных leak-а, отсортированных по размеру потенциального выигрыша.
4. Для каждого leak-а: название → объяснение почему это проблема → конкретное действие что изменить.
5. В конце — одна строка "Приоритет #1: [что исправить прямо сейчас]"

Формат ответа — строго JSON:
{
  "player_type": "строка — тип игрока (нит / лузпассив / агрессивный рег / и т.д.)",
  "overall_assessment": "2-3 предложения общей оценки",
  "leaks": [
    {
      "rank": 1,
      "title": "Название leak-а",
      "explanation": "Почему это проблема и сколько это стоит",
      "fix": "Конкретное действие — что делать иначе",
      "severity": "high / medium / low"
    }
  ],
  "top_priority": "Одно предложение — что исправить прямо сейчас"
}"""

    # -------------------------------------------------------------------
    # USER MESSAGE — данные игрока
    # -------------------------------------------------------------------
    user = f"""Проанализируй статистику покерного игрока и найди его главные leak-и.

=== ОБЩАЯ СТАТИСТИКА ===
Игрок: {stats.get('hero', 'Неизвестно')}
Раздач: {stats.get('total_hands', 0)}
Общий результат: {stats.get('total_net_bb', 0):+.1f} BB
Winrate: {stats.get('bb_per_100', 0):+.1f} BB/100

=== КЛЮЧЕВЫЕ СТАТЫ (vs норма рега на 6-max) ===
{chr(10).join(stat_diagnostics)}

=== РЕЗУЛЬТАТ ПО ПОЗИЦИЯМ ===
{position_block}

=== ГДЕ ТЕРЯЮТСЯ ДЕНЬГИ (по улицам) ===
{chr(10).join(street_lines) if street_lines else '  нет значимых потерь'}

=== КОНТЕКСТ ===
Формат: NL кэш, 6-max
Лимит: NL{int(stats.get('big_blind_usd', 0.10) * 100) if 'big_blind_usd' in stats else '10'}
Объём: {'достаточный для выводов' if stats.get('total_hands', 0) >= 500 else 'малый — выводы предварительные'}

Найди 3 главных leak-а и дай конкретные советы."""

    return system, user


# ---------------------------------------------------------------------------
# Вызов Claude API
# ---------------------------------------------------------------------------

async def analyze_leaks(stats: dict) -> dict:
    """Отправляет статистику в Claude и возвращает разбор leak-ов."""

    system_prompt, user_message = build_prompt(stats)

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1500,
                "system": system_prompt,
                "messages": [
                    {"role": "user", "content": user_message}
                ],
            }
        )
        response.raise_for_status()
        data = response.json()

    raw_text = data["content"][0]["text"].strip()

    # Снимаем ```json обёртку если есть
    if raw_text.startswith("```"):
        raw_text = raw_text.split("```")[1]
        if raw_text.startswith("json"):
            raw_text = raw_text[4:]

    return json.loads(raw_text.strip())


# ---------------------------------------------------------------------------
# FastAPI endpoint (будет использоваться в веб-приложении)
# ---------------------------------------------------------------------------

def get_router():
    """
    Возвращает FastAPI router — подключается в main.py.
    Пример: app.include_router(get_router(), prefix="/api")
    """
    from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
    import tempfile
    from typing import Optional
    from sqlalchemy.orm import Session
    from database import get_db
    from models import Analysis
    from auth import get_current_user
    from models import User

    router = APIRouter()

    @router.post("/analyze")
    async def analyze_endpoint(
        file: UploadFile = File(...),
        hero_name: str = Form(...),
        db: Session = Depends(get_db),
        current_user: Optional[User] = Depends(get_current_user),
    ):
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="wb") as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        try:
            hands = parse_file(tmp_path, hero_name)
            if not hands:
                raise HTTPException(400, "Не удалось распарсить раздачи")

            stats = compute_stats(hands)
            analysis = await analyze_leaks(stats)

            if current_user:
                record = Analysis(
                    user_id=current_user.id,
                    hero_name=hero_name,
                    stats=stats,
                    analysis=analysis,
                    hands_parsed=len(hands),
                )
                db.add(record)
                db.commit()
                db.refresh(record)

            return {
                "stats": stats,
                "analysis": analysis,
                "hands_parsed": len(hands),
            }
        finally:
            os.unlink(tmp_path)

    @router.get("/history")
    def history_endpoint(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        if not current_user:
            return []
        records = (
            db.query(Analysis)
            .filter(Analysis.user_id == current_user.id)
            .order_by(Analysis.created_at.desc())
            .limit(20)
            .all()
        )
        return [
            {
                "id": r.id,
                "hero_name": r.hero_name,
                "hands_parsed": r.hands_parsed,
                "bb_per_100": r.stats.get("bb_per_100"),
                "player_type": r.analysis.get("player_type"),
                "created_at": r.created_at.isoformat(),
                "stats": r.stats,
                "analysis": r.analysis,
            }
            for r in records
        ]

    return router


# ---------------------------------------------------------------------------
# CLI тест
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys, asyncio

    if len(sys.argv) < 3:
        print("Usage: python leak_analyzer.py <file.txt> <HeroName>")
        sys.exit(1)

    hands = parse_file(sys.argv[1], sys.argv[2])
    stats = compute_stats(hands)

    print("=== Статистика ===")
    print(json.dumps(stats, ensure_ascii=False, indent=2))

    print("\n=== Промпт (user часть) ===")
    _, user_msg = build_prompt(stats)
    print(user_msg)

    print("\n[Для реального вызова API нужен ANTHROPIC_API_KEY в окружении]")
