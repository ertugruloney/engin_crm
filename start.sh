#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NGROK_HOST="${NGROK_HOST:-}"
export NGROK_HOST

if [[ "$NGROK_HOST" == *"://"* || "$NGROK_HOST" == */* ]]; then
    echo "NGROK_HOST must be a hostname only (for example: example.ngrok-free.app)." >&2
    exit 1
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo "Shutting down frontend and backend..."
    for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
        if [[ -n "$pid" ]]; then
            wait "$pid" 2>/dev/null || true
        fi
    done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting Arsa Sales CRM..."
if [[ -n "$NGROK_HOST" ]]; then
    echo "Using ngrok host: $NGROK_HOST"
else
    echo "Ngrok free-domain hosts (*.ngrok-free.app) are allowed automatically."
fi

cd "$ROOT_DIR/backend"
if [ ! -d "venv" ]; then
    echo "Creating backend virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000 --noreload &
BACKEND_PID=$!

cd "$ROOT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
npm run dev &
FRONTEND_PID=$!

echo "Both servers are running!"
echo "Frontend is at http://localhost:5173"
if [[ -n "$NGROK_HOST" ]]; then
    echo "Open your ngrok URL: https://$NGROK_HOST"
else
    echo "To use a custom ngrok domain, set NGROK_HOST before starting this script."
fi
echo "Press CTRL+C to stop both servers."
wait "$BACKEND_PID" "$FRONTEND_PID"
