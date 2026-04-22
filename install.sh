#!/usr/bin/env bash
# Supplier Hub - macOS/Linux one-shot installer
# Kullanim:
#   curl -fsSL https://raw.githubusercontent.com/digitalvendorxx/supplier-hub/main/install.sh | bash

set -e

REPO_URL="https://github.com/digitalvendorxx/supplier-hub.git"
TARGET_DIR="${SUPPLIER_HUB_DIR:-$HOME/supplier-hub}"

echo "=== Supplier Hub installer ==="
OS="$(uname -s)"

need() { command -v "$1" >/dev/null 2>&1; }
die()  { echo "ERROR: $*" >&2; exit 1; }

install_brew() {
  if ! need brew; then
    echo ">> Homebrew kuruluyor..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"
  fi
}
install_node_mac()   { install_brew; brew install node@22 && brew link --overwrite --force node@22; }
install_node_linux() {
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
}
install_git_mac()    { install_brew; brew install git; }
install_git_linux()  { sudo apt-get update && sudo apt-get install -y git; }

# 1. Git
if ! need git; then
  case "$OS" in
    Darwin) install_git_mac ;;
    Linux)  install_git_linux ;;
    *) die "Git yok, elle kur: https://git-scm.com" ;;
  esac
fi
echo "   Git: $(git --version)"

# 2. Node 22+ (node:sqlite gerekli)
install_node=0
if ! need node; then
  install_node=1
else
  MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  [ "$MAJOR" -lt 22 ] && install_node=1
fi
if [ "$install_node" = "1" ]; then
  case "$OS" in
    Darwin) install_node_mac ;;
    Linux)  install_node_linux ;;
    *) die "Bilinmeyen OS, Node 22+ elle kur" ;;
  esac
fi
echo "   Node: $(node -v)"

# 3. Clone / pull
if [ -d "$TARGET_DIR/.git" ]; then
  echo ">> Repo mevcut, guncelleniyor: $TARGET_DIR"
  git -C "$TARGET_DIR" pull --ff-only
else
  echo ">> Repo klonlaniyor: $TARGET_DIR"
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

# 4. npm install
if [ ! -d node_modules ]; then
  echo ">> npm install..."
  npm install
fi
echo "   node_modules OK"

# 5. .env + SESSION_SECRET auto
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  if [ "$OS" = "Darwin" ]; then
    sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
  else
    sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
  fi
  echo "   .env olusturuldu (SESSION_SECRET otomatik)"
else
  echo "   .env mevcut, dokunulmadi"
fi

# 6. Data dir + seed
mkdir -p data
echo ">> seed: users + catalog + mock..."
npm run seed:users   || true
npm run seed:catalog || true
npm run seed         || true

PORT=3100
URL="http://localhost:$PORT"

# Onceki instance varsa oldur
if need lsof; then
  OLD_PID=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  [ -n "$OLD_PID" ] && kill -9 $OLD_PID 2>/dev/null || true
fi

echo ">> Server baslatiliyor (detached)..."
nohup node server.js > "$TARGET_DIR/server.log" 2>&1 &
SERVER_PID=$!
disown $SERVER_PID 2>/dev/null || true
echo $SERVER_PID > "$TARGET_DIR/server.pid"

# Port bind bekle (max 15 sn)
READY=0
for i in $(seq 1 30); do
  sleep 0.5
  if (echo > /dev/tcp/127.0.0.1/$PORT) >/dev/null 2>&1; then
    READY=1; break
  fi
done

if [ "$READY" = "1" ]; then
  echo "   Server ayakta (PID $SERVER_PID) -> $URL"
  case "$OS" in
    Darwin) open "$URL" 2>/dev/null || true ;;
    Linux)  (need xdg-open && xdg-open "$URL" >/dev/null 2>&1) || true ;;
  esac
else
  echo "   UYARI: Server ayaga kalkmadi. Log: $TARGET_DIR/server.log"
fi

cat <<EOF

Kurulum tamam.

Dizin: $TARGET_DIR

Test kullanicilari:
  admin@hub.local    / admin123
  owner@hub.local    / owner123
  supplier@hub.local / supplier123

URL: $URL

Durdurmak icin:  kill \$(cat "$TARGET_DIR/server.pid")
Tekrar baslat:   cd "$TARGET_DIR" && npm start
Log:             tail -f "$TARGET_DIR/server.log"

Gercek Easyship: .env -> DATA_SOURCE=easyship + EASYSHIP_API_TOKEN
EOF
