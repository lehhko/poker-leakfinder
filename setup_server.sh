#!/bin/bash
# Первичная установка на Ubuntu VPS.
# Запускать от root: bash setup_server.sh
set -e

PROJECT_DIR="/opt/poker-leakfinder"

echo "=== 1. Системные пакеты ==="
apt-get update -q
apt-get install -y python3 python3-venv python3-pip nginx nodejs npm git

echo "=== 2. Пользователь poker ==="
id -u poker &>/dev/null || useradd -r -s /bin/false poker

echo "=== 3. Клонируем репозиторий ==="
# Замени URL на свой репозиторий
git clone https://github.com/YOUR_USER/poker-leakfinder.git "$PROJECT_DIR"
chown -R poker:poker "$PROJECT_DIR"

echo "=== 4. Python venv ==="
python3 -m venv "$PROJECT_DIR/venv"
"$PROJECT_DIR/venv/bin/pip" install --upgrade pip -q
"$PROJECT_DIR/venv/bin/pip" install -r "$PROJECT_DIR/requirements.txt" -q

echo "=== 5. Frontend build ==="
cd "$PROJECT_DIR"
npm ci --silent
npm run build

echo "=== 6. .env на сервере ==="
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cat > "$PROJECT_DIR/.env" <<EOF
ANTHROPIC_API_KEY=sk-ant-ЗАМЕНИ_НА_РЕАЛЬНЫЙ_КЛЮЧ
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
DATABASE_URL=sqlite:///./poker.db
EOF
  echo "  Создан .env — вставь реальный ANTHROPIC_API_KEY в $PROJECT_DIR/.env"
fi

echo "=== 7. Nginx ==="
cp "$PROJECT_DIR/nginx.conf" /etc/nginx/sites-available/poker-leakfinder
ln -sf /etc/nginx/sites-available/poker-leakfinder /etc/nginx/sites-enabled/poker-leakfinder
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== 8. Systemd сервис ==="
cp "$PROJECT_DIR/poker-leakfinder.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable poker-leakfinder
systemctl start poker-leakfinder

echo ""
echo "=== Готово! ==="
systemctl status poker-leakfinder --no-pager
echo ""
echo "Открой в браузере: http://$(curl -s ifconfig.me)"
