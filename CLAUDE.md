# Poker Leak Finder — Project Brief for Claude Code

## Что это за проект

Веб-приложение для анализа покерных leak-ов. Пользователь загружает hand history файл (.txt) с PokerStars, вводит свой никнейм — получает AI-разбор где теряет деньги, статистику по позициям и конкретные советы.

---

## Текущее состояние (MVP работает локально)

### Что уже сделано и работает:
- `hand_parser.py` — парсит .txt файлы PokerStars, считает VPIP/PFR/3-bet/WTSD/CBet и BB/100 по позициям
- `leak_analyzer.py` — формирует промпт, вызывает Claude API (claude-sonnet-4-20250514), возвращает JSON с 3 leak-ами
- `main.py` — FastAPI бэкенд с CORS, endpoint POST /api/analyze
- `src/App.jsx` — React UI (dark luxury стиль): загрузка файла → дашборд со статами → карточки leak-ов
- `.env` — содержит ANTHROPIC_API_KEY

### Как запускать локально:
```bash
# Терминал 1 — бэкенд (из корня проекта)
python -m uvicorn main:app --reload --port 8000

# Терминал 2 — фронтенд (из корня проекта)
npm run dev
```

Фронт: http://localhost:5173
Бэк: http://localhost:8000

---

## Структура проекта

```
poker-leakfinder/
├── src/
│   ├── App.jsx          # Весь React UI — загрузка, дашборд, leak-карточки
│   ├── App.css          # Пустой
│   └── index.css        # Пустой
├── main.py              # FastAPI точка входа
├── hand_parser.py       # Парсер hand history
├── leak_analyzer.py     # Claude API + промпт + FastAPI router
├── .env                 # ANTHROPIC_API_KEY=sk-ant-...
├── package.json         # React + Vite + framer-motion
├── vite.config.js       # Vite конфиг
└── CLAUDE.md            # Этот файл
```

---

## Стек

| Слой | Технология |
|------|-----------|
| Фронтенд | React 18 + Vite + framer-motion |
| Бэкенд | Python 3.14 + FastAPI + uvicorn |
| AI | Claude API (claude-sonnet-4-20250514) через httpx |
| БД | Пока нет (следующий шаг — PostgreSQL) |
| Деплой | VPS (Ubuntu) — nginx + systemd (ещё не сделано) |

---

## Следующие задачи (приоритет сверху вниз)

### 🔴 Срочно — подключить реальный fetch

В `src/App.jsx` функция `handleAnalyze` сейчас возвращает `MOCK_RESULT` даже при загрузке файла.
Нужно заменить на реальный запрос к бэкенду:

```js
const handleAnalyze = async (file, heroName) => {
  if (!file) {
    setResult(MOCK_RESULT);
    setView("result");
    return;
  }
  setView("loading");
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("hero_name", heroName);
    const res = await fetch("http://localhost:8000/api/analyze", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error("Ошибка сервера");
    const data = await res.json();
    setResult(data);
    setView("result");
  } catch (e) {
    alert("Ошибка: " + e.message);
    setView("upload");
  }
};
```

### 🟡 Добавить авторизацию

- Email + пароль, JWT токены
- FastAPI + PostgreSQL + SQLAlchemy
- Сохранять историю анализов пользователя

### 🟡 Деплой на VPS

- nginx как reverse proxy (фронт на 80/443, бэк на 8000)
- systemd сервис для uvicorn
- Собрать фронт: `npm run build` → раздавать через nginx

### 🟢 Поддержка GGPoker

- В `hand_parser.py` добавить парсинг формата GGPoker
- Формат немного отличается в заголовке и блайндах

### 🟢 AI-коуч в чате

- Отдельный endpoint POST /api/chat
- Принимает историю сообщений + контекст stats игрока
- Возвращает стриминговый ответ

### 🟢 Монетизация

- Freemium: 1 загрузка бесплатно, потом подписка
- ЮKassa или Stripe для платежей
- Поле `subscription_active` в модели пользователя

---

## Важные детали реализации

### hand_parser.py
- Функция `parse_file(filepath, hero_name)` → список объектов `Hand`
- Функция `compute_stats(hands)` → dict со статами для Claude
- Позиции определяются относительно баттона (6-max логика)
- Бенчмарки нормального рега зашиты в `BENCHMARKS` dict в `leak_analyzer.py`

### leak_analyzer.py
- `build_prompt(stats)` → возвращает `(system_prompt, user_message)`
- `analyze_leaks(stats)` → async, возвращает dict с полями: `player_type`, `overall_assessment`, `leaks[]`, `top_priority`
- Claude отвечает строго JSON — парсим через `json.loads()`
- `get_router()` → FastAPI router, подключается в main.py

### App.jsx
- Три view: `upload` → `loading` → `result`
- `MOCK_RESULT` — константа с тестовыми данными вверху файла (для демо-режима)
- Компоненты: `UploadView`, `LoadingView`, `ResultView`, `LeakCard`, `StatBar`, `PositionGrid`, `StreetLossBar`
- Стиль: тёмный фон `#111009`, акцент золото `#c9a84c`, шрифты Playfair Display + DM Mono

---

## Тестовый файл

`test_hands.txt` — 10 раздач с никнеймом `Hero` на NL10 (PokerStars формат).
Лежит в корне проекта. Использовать для тестирования парсера и API.

---

## Переменные окружения (.env)

```
ANTHROPIC_API_KEY=sk-ant-твой_ключ
```

В `leak_analyzer.py` ключ читается через:
```python
from dotenv import load_dotenv
load_dotenv()
headers["x-api-key"] = os.environ["ANTHROPIC_API_KEY"]
```

---

## Команды

```bash
# Установка зависимостей Python
python -m pip install fastapi uvicorn httpx python-multipart python-dotenv

# Установка зависимостей Node
npm install

# Запуск бэка
python -m uvicorn main:app --reload --port 8000

# Запуск фронта
npm run dev

# Сборка фронта для прода
npm run build

# Тест парсера напрямую
python hand_parser.py test_hands.txt Hero

# Тест промпта (без вызова API)
python leak_analyzer.py test_hands.txt Hero
```
