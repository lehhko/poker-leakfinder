"""
PokerStars Hand History Parser
Парсит .txt файлы и возвращает структурированные данные по каждой раздаче.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from pathlib import Path


# ---------------------------------------------------------------------------
# Структуры данных
# ---------------------------------------------------------------------------

@dataclass
class PlayerAction:
    player: str
    street: str          # preflop / flop / turn / river
    action: str          # folds / calls / raises / checks / bets
    amount: float = 0.0


@dataclass
class Hand:
    hand_id: str
    datetime: Optional[datetime]
    game_type: str       # Hold'em No Limit
    small_blind: float
    big_blind: float
    table_name: str
    hero: str            # имя героя (определяется по "Dealt to")

    # Игроки: {имя: стек в BB}
    players: dict = field(default_factory=dict)
    # Позиция героя: BTN/CO/HJ/MP/UTG/SB/BB
    hero_position: str = ""
    # Карты героя
    hero_cards: list = field(default_factory=list)
    # Борд
    board: list = field(default_factory=list)
    # Все действия
    actions: list = field(default_factory=list)

    # Итоги
    pot_total: float = 0.0
    hero_won: float = 0.0       # сколько выиграл (0 если проиграл)
    hero_net: float = 0.0       # чистый результат в BB (+/-)
    went_to_showdown: bool = False

    # Ключевые метрики для анализа
    vpip: bool = False           # вошёл в банк добровольно
    pfr: bool = False            # сделал рейз на префлопе
    three_bet: bool = False      # сделал 3-бет
    folded_to_3bet: bool = False
    cbet_flop: bool = False      # сделал c-bet на флопе
    wtsd: bool = False           # went to showdown


# ---------------------------------------------------------------------------
# Регулярные выражения
# ---------------------------------------------------------------------------

# PokerStars: "PokerStars Hand #12345: Hold'em No Limit ($0.05/$0.10) - 2024/01/15 12:34:56 ET"
RE_HEADER_PS = re.compile(
    r"PokerStars Hand #(\d+):\s+(.+?)\s+\((\$?[\d.]+)/(\$?[\d.]+)\)"
    r".*?(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})",
    re.IGNORECASE
)
# GGPoker: "Poker Hand #RC12345: Hold'em No Limit ($0.05/$0.10) - 2024/01/15 12:34:56"
RE_HEADER_GG = re.compile(
    r"Poker Hand #(\w+):\s+(.+?)\s+\((\$?[\d.]+)/(\$?[\d.]+)\)"
    r".*?(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})",
    re.IGNORECASE
)
RE_TABLE = re.compile(r"Table '(.+?)' \d+-max")
# Handles both "(1000 in chips)" [PS] and "($10.00 in chips)" [GG]
RE_SEAT = re.compile(r"Seat (\d+): (.+?) \(\$?([\d.]+) in chips\)")
RE_DEALT = re.compile(r"Dealt to (.+?) \[(.+?)\]")
RE_BOARD_FLOP = re.compile(r"\*\*\* FLOP \*\*\* \[(.+?)\]")
RE_BOARD_TURN = re.compile(r"\*\*\* TURN \*\*\* \[.+?\] \[(.+?)\]")
RE_BOARD_RIVER = re.compile(r"\*\*\* RIVER \*\*\* \[.+?\] \[(.+?)\]")
RE_ACTION = re.compile(r"^(.+?): (folds|calls|raises|checks|bets)(?: \$?([\d.]+))?")
RE_POT = re.compile(r"Total pot \$?([\d.]+)")
RE_COLLECTED = re.compile(r"(.+?) collected \$?([\d.]+) from")
# Handles both "Seat #3 is the button" [PS] and "Seat 3 is the button" [GG]
RE_BTN = re.compile(r"Seat #?(\d+) is the button")
RE_POSTS = re.compile(r"(.+?): posts (small|big) blind")


# ---------------------------------------------------------------------------
# Парсер одной раздачи
# ---------------------------------------------------------------------------

def _parse_position(seat_num: int, btn_seat: int, total_seats: int,
                    num_players: int) -> str:
    """Определяет позицию по номеру места относительно баттона."""
    seats_list = list(range(1, total_seats + 1))
    # упрощённо для 6-max
    distance = (seat_num - btn_seat) % total_seats
    positions_6max = {0: "BTN", 1: "SB", 2: "BB", 3: "UTG", 4: "HJ", 5: "CO"}
    return positions_6max.get(distance, f"seat{seat_num}")


def parse_hand(raw: str, hero_name: str) -> Optional[Hand]:
    lines = raw.strip().splitlines()
    if not lines:
        return None

    # --- Заголовок (PokerStars или GGPoker) ---
    m = RE_HEADER_PS.match(lines[0]) or RE_HEADER_GG.match(lines[0])
    if not m:
        return None

    hand_id = m.group(1)
    game_type = m.group(2).strip()
    sb = float(m.group(3).replace("$", ""))
    bb = float(m.group(4).replace("$", ""))
    try:
        dt = datetime.strptime(m.group(5), "%Y/%m/%d %H:%M:%S")
    except ValueError:
        dt = None

    # --- Название стола ---
    table_name = ""
    m_table = RE_TABLE.search(raw)
    if m_table:
        table_name = m_table.group(1)

    hand = Hand(
        hand_id=hand_id,
        datetime=dt,
        game_type=game_type,
        small_blind=sb,
        big_blind=bb,
        table_name=table_name,
        hero=hero_name,
    )

    # --- Сиды и стеки ---
    btn_seat = 0
    m_btn = RE_BTN.search(raw)
    if m_btn:
        btn_seat = int(m_btn.group(1))

    seat_numbers = {}   # имя -> номер места
    for m_seat in RE_SEAT.finditer(raw):
        seat_num = int(m_seat.group(1))
        name = m_seat.group(2).strip()
        stack = float(m_seat.group(3)) / bb  # стек в BB
        hand.players[name] = stack
        seat_numbers[name] = seat_num

    # Позиция героя
    if hero_name in seat_numbers:
        hand.hero_position = _parse_position(
            seat_numbers[hero_name], btn_seat,
            6, len(hand.players)
        )

    # --- Карты героя ---
    m_dealt = RE_DEALT.search(raw)
    if m_dealt:
        hand.hero = m_dealt.group(1).strip()
        hand.hero_cards = m_dealt.group(2).split()

    # --- Борд ---
    m_flop = RE_BOARD_FLOP.search(raw)
    if m_flop:
        hand.board += m_flop.group(1).split()
    m_turn = RE_BOARD_TURN.search(raw)
    if m_turn:
        hand.board.append(m_turn.group(1))
    m_river = RE_BOARD_RIVER.search(raw)
    if m_river:
        hand.board.append(m_river.group(1))

    # --- Действия по улицам ---
    current_street = "preflop"
    street_markers = {
        "*** HOLE CARDS ***": "preflop",
        "*** FLOP ***": "flop",
        "*** TURN ***": "turn",
        "*** RIVER ***": "river",
        "*** SHOW DOWN ***": "showdown",
    }
    preflop_raises = 0  # для определения 3-бета

    for line in lines:
        # Обновляем текущую улицу
        for marker, street in street_markers.items():
            if marker in line:
                current_street = street
                break

        m_act = RE_ACTION.match(line)
        if m_act and current_street not in ("showdown",):
            player = m_act.group(1).strip()
            action = m_act.group(2)
            amount = float(m_act.group(3)) / bb if m_act.group(3) else 0.0

            hand.actions.append(PlayerAction(
                player=player,
                street=current_street,
                action=action,
                amount=amount,
            ))

            # Метрики для героя
            if player == hand.hero:
                if current_street == "preflop":
                    if action in ("calls", "raises"):
                        hand.vpip = True
                    if action == "raises":
                        hand.pfr = True
                        preflop_raises += 1
                        if preflop_raises >= 2:
                            hand.three_bet = True
                if current_street == "flop" and action in ("bets",):
                    hand.cbet_flop = True
            else:
                # Фолд героя на 3-бет
                if current_street == "preflop" and action == "raises":
                    preflop_raises += 1
                if (current_street == "preflop" and
                        player == hand.hero and action == "folds" and
                        preflop_raises >= 2):
                    hand.folded_to_3bet = True

        if "*** SHOW DOWN ***" in line:
            hand.went_to_showdown = True
            hand.wtsd = True

    # --- Pot и результат ---
    m_pot = RE_POT.search(raw)
    if m_pot:
        hand.pot_total = float(m_pot.group(1)) / bb

    hero_collected = 0.0
    for m_col in RE_COLLECTED.finditer(raw):
        if m_col.group(1).strip() == hand.hero:
            hero_collected += float(m_col.group(2))

    # Считаем сколько герой вложил (через действия)
    hero_invested = sum(
        a.amount for a in hand.actions
        if a.player == hand.hero and a.action in ("calls", "raises", "bets")
    )
    # + блайнды (если герой в SB/BB)
    for line in lines:
        m_post = RE_POSTS.match(line)
        if m_post and m_post.group(1).strip() == hand.hero:
            blind_size = sb if m_post.group(2) == "small" else bb
            hero_invested += blind_size / bb

    hand.hero_won = hero_collected / bb
    hand.hero_net = hand.hero_won - hero_invested

    return hand


# ---------------------------------------------------------------------------
# Парсер файла целиком
# ---------------------------------------------------------------------------

def parse_file(filepath: str, hero_name: str) -> list[Hand]:
    """Читает .txt файл и возвращает список раздач."""
    text = Path(filepath).read_text(encoding="utf-8", errors="replace")
    # Раздачи разделены двумя пустыми строками
    raw_hands = re.split(r"\n\s*\n\s*\n", text.strip())
    hands = []
    for raw in raw_hands:
        raw = raw.strip()
        if not raw:
            continue
        hand = parse_hand(raw, hero_name)
        if hand:
            hands.append(hand)
    return hands


# ---------------------------------------------------------------------------
# Агрегация статистики (то что пойдёт в Claude для анализа)
# ---------------------------------------------------------------------------

def compute_stats(hands: list[Hand]) -> dict:
    """
    Считает ключевые метрики по списку раздач.
    Этот dict отправляется в Claude API для анализа leak-ов.
    """
    if not hands:
        return {}

    total = len(hands)
    hero = hands[0].hero

    # Общие метрики
    vpip_count = sum(1 for h in hands if h.vpip)
    pfr_count = sum(1 for h in hands if h.pfr)
    threebet_count = sum(1 for h in hands if h.three_bet)
    wtsd_count = sum(1 for h in hands if h.wtsd)
    cbet_flop_count = sum(1 for h in hands if h.cbet_flop)

    # Результат по позициям
    positions = {}
    for h in hands:
        pos = h.hero_position or "unknown"
        if pos not in positions:
            positions[pos] = {"hands": 0, "net_bb": 0.0, "vpip": 0, "pfr": 0}
        positions[pos]["hands"] += 1
        positions[pos]["net_bb"] += h.hero_net
        if h.vpip:
            positions[pos]["vpip"] += 1
        if h.pfr:
            positions[pos]["pfr"] += 1

    # Итог по позициям с BB/100
    pos_summary = {}
    for pos, data in positions.items():
        n = data["hands"]
        pos_summary[pos] = {
            "hands": n,
            "bb_per_100": round(data["net_bb"] / n * 100, 1) if n else 0,
            "vpip_pct": round(data["vpip"] / n * 100, 1) if n else 0,
            "pfr_pct": round(data["pfr"] / n * 100, 1) if n else 0,
        }

    # Результат по улице где сливаем
    street_loss = {"preflop": 0.0, "flop": 0.0, "turn": 0.0, "river": 0.0}
    for h in hands:
        # Упрощённо: определяем последнюю улицу героя
        hero_streets = set(a.street for a in h.actions if a.player == hero)
        last_street = (
            "river" if "river" in hero_streets else
            "turn" if "turn" in hero_streets else
            "flop" if "flop" in hero_streets else
            "preflop"
        )
        if h.hero_net < 0:
            street_loss[last_street] += h.hero_net

    total_net = sum(h.hero_net for h in hands)

    return {
        "hero": hero,
        "total_hands": total,
        "total_net_bb": round(total_net, 1),
        "bb_per_100": round(total_net / total * 100, 1) if total else 0,
        "vpip_pct": round(vpip_count / total * 100, 1),
        "pfr_pct": round(pfr_count / total * 100, 1),
        "three_bet_pct": round(threebet_count / total * 100, 1),
        "wtsd_pct": round(wtsd_count / total * 100, 1),
        "cbet_flop_pct": round(cbet_flop_count / total * 100, 1),
        "positions": pos_summary,
        "losses_by_street": {k: round(v, 1) for k, v in street_loss.items()},
    }


# ---------------------------------------------------------------------------
# CLI для быстрой проверки
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys, json

    if len(sys.argv) < 3:
        print("Usage: python hand_parser.py <file.txt> <HeroName>")
        sys.exit(1)

    filepath, hero = sys.argv[1], sys.argv[2]
    hands = parse_file(filepath, hero)
    stats = compute_stats(hands)

    print(f"\nПарсинг завершён: {len(hands)} раздач")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
