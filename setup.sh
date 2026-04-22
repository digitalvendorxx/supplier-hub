#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== Supplier Hub kurulum ==="
OS="$(uname -s)"

need() { command -v "$1" >/dev/null 2>&1; }
die() { echo "ERROR: $*" >&2; exit 1; }

install_brew() {
  if ! need brew; then
    echo ">> Homebrew kuruluyor..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
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
    MINGW*|MSYS*|CYGWIN*) die "Windows: Node 22 LTS kur (https://nodejs.org/) veya 'winget install OpenJS.NodeJS.LTS'" ;;
    *) die "Bilinmeyen OS, Node 22+ elle kur" ;;
  esac
fi
echo "   Node: $(node -v)"

# 3. Deps
if [ ! -d node_modules ]; then
  echo ">> npm install..."
  npm install
fi
echo "   node_modules OK"

# 4. .env + auto SESSION_SECRET
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

# 5. Data dir + seed
mkdir -p data
echo ">> seed: users + catalog + mock..."
npm run seed:users || true
npm run seed:catalog || true
npm run seed || true

cat <<EOF

Kurulum tamam.

Test kullanicilari:
  admin@hub.local    / admin123
  owner@hub.local    / owner123
  supplier@hub.local / supplier123

Baslat:
  npm start
  -> http://localhost:3100

Gercek Easyship baglantisi icin:
  .env -> DATA_SOURCE=easyship + EASYSHIP_API_TOKEN doldur
EOF
