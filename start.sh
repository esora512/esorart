#!/usr/bin/env bash
# bash start.sh local       start backend + frontend for local testing (detached screens)
# bash start.sh server      start the backend on the VPS (detached screen "esorart")
# bash start.sh stop        stop everything this script started
# bash start.sh admin-link  print a link that logs you in as admin
set -euo pipefail
cd "$(dirname "$0")"
BE=$PWD/backend FE=$PWD/frontend

need() { command -v "$1" >/dev/null || { echo "Missing '$1' - install it first: sudo apt install $2"; exit 1; }; }

setup_backend() {
  need python3 python3-venv; need screen screen
  [ -d "$BE/.venv" ] || python3 -m venv "$BE/.venv"
  "$BE/.venv/bin/pip" install -q -r "$BE/requirements.txt"
}

load_env() {  # backend/.env holds the server settings; created on first `server` run
  if [ -f "$BE/.env" ]; then set -a; . "$BE/.env"; set +a
  else export SECRET=local-dev; fi
}

run() {  # run <screen name> <dir> <command...>  (restarts it if already running)
  local name=$1 dir=$2; shift 2
  screen -S "$name" -X quit >/dev/null 2>&1 || true
  (cd "$dir" && screen -dmS "$name" "$@")
}

admin_link() { (cd "$BE" && .venv/bin/python main.py admin-link); }

case "${1:-}" in
  local)
    setup_backend; need npm nodejs
    [ -d "$FE/node_modules" ] || (cd "$FE" && npm install)
    export SECRET=local-dev DB_PATH=art.db
    run esorart-api "$BE" .venv/bin/uvicorn main:app --port 8080 --reload
    run esorart-web "$FE" npm run dev
    sleep 2
    echo "Running: frontend http://localhost:5173  backend http://localhost:8080"
    echo "Logs:    screen -r esorart-api / esorart-web  (detach: Ctrl+A then D)"
    echo "Admin:   $(admin_link)"
    ;;
  server)
    setup_backend
    if [ ! -f "$BE/.env" ]; then
      sed "s|^SECRET=.*|SECRET=$(python3 -c 'import secrets;print(secrets.token_hex(32))')|" "$BE/deploy/env.example" > "$BE/.env"
      echo "Created backend/.env (add ADMIN_EMAIL / GOOGLE_CLIENT_ID there for Google sign-in)."
    fi
    load_env
    run esorart "$BE" .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8080
    command -v caddy >/dev/null || echo "Warning: Caddy isn't installed, so HTTPS won't work yet (see README)."
    echo "Backend running in screen 'esorart' (logs: screen -r esorart). First login: bash start.sh admin-link"
    ;;
  stop)
    for s in esorart esorart-api esorart-web; do screen -S "$s" -X quit >/dev/null 2>&1 && echo "stopped $s" || true; done
    ;;
  admin-link)
    load_env; echo "$(admin_link)"
    ;;
  *) sed -n '2,5p' "$0" | sed 's/^# //'; exit 1 ;;
esac
