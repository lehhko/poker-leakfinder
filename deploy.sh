#!/bin/bash
# Обновление уже задеплоенного проекта.
# Запускать от root: bash deploy.sh
set -e

PROJECT_DIR="/opt/poker-leakfinder"

echo "=== Обновляем код ==="
cd "$PROJECT_DIR"
git pull

echo "=== Python зависимости ==="
"$PROJECT_DIR/venv/bin/pip" install -r requirements.txt -q

echo "=== Пересобираем фронт ==="
npm ci --silent
npm run build

echo "=== Перезапускаем сервис ==="
systemctl restart poker-leakfinder
systemctl reload nginx

echo "=== Готово ==="
systemctl status poker-leakfinder --no-pager
