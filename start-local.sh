#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# LOCAL DEMO SETUP — No AWS account required
# Uses a local Mosquitto MQTT broker instead of AWS IoT Core
# ─────────────────────────────────────────────────────────────────────────────

set -e
echo "🌊 Starting Water Leak Detection System (Local Demo)"
echo "════════════════════════════════════════════════════"

# ─── Install Mosquitto (local MQTT broker) ────────────────────────────────────
if ! command -v mosquitto &> /dev/null; then
  echo "📦 Installing Mosquitto MQTT broker..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install mosquitto
  elif [[ "$OSTYPE" == "linux"* ]]; then
    sudo apt-get update && sudo apt-get install -y mosquitto mosquitto-clients
  fi
fi

# Start Mosquitto in background
echo "🔌 Starting Mosquitto broker on port 1883..."
mosquitto -p 1883 -d 2>/dev/null || true
sleep 1

# ─── Backend ──────────────────────────────────────────────────────────────────
echo "📡 Starting Backend API..."
cd backend
cp .env.example .env 2>/dev/null || true
npm install --silent
node server.js &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID (port 4000)"
cd ..
sleep 2

# ─── Frontend ─────────────────────────────────────────────────────────────────
echo "🌐 Starting Frontend..."
cd frontend
cp .env.example .env 2>/dev/null || true
npm install --silent
npm run dev &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID (port 5173)"
cd ..
sleep 2

# ─── IoT Simulator ───────────────────────────────────────────────────────────
echo "🤖 Starting IoT Simulator (local mode)..."
cd iot-simulator
pip install -r requirements.txt -q
python simulator.py --local --host localhost --port 1883 --interval 3 &
SIM_PID=$!
echo "  Simulator PID: $SIM_PID"
cd ..

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "✅ System Running!"
echo ""
echo "  Dashboard   → http://localhost:5173"
echo "  Backend API → http://localhost:4000"
echo "  API Health  → http://localhost:4000/api/health"
echo "  WebSocket   → ws://localhost:4000/ws"
echo ""
echo "Press Ctrl+C to stop all services"
echo "════════════════════════════════════════════════════"

# Wait and cleanup on Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID $SIM_PID 2>/dev/null; echo '⛔ All stopped'; exit 0" INT
wait
