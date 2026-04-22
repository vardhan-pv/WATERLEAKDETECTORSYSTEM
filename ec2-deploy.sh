#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# AQUAWATCH PRO — EC2 BACKEND DEPLOYMENT SCRIPT
# Run this on your Ubuntu EC2 instance
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "🌊 Starting AquaWatch Pro Backend Setup..."

# 1. Update and install dependencies
echo "[*] Updating system..."
sudo apt-get update -y
sudo apt-get install -y git unzip
# nodejs and npm are usually already installed via Nodesource on EC2, 
# trying to install them again via apt can cause dependency conflicts.

# 2. Clone repository (or part of it)
# Assuming you have git access or will upload the backend folder
echo "[*] Preparing backend directory..."
# mkdir -p ~/water-leak-system
# cd ~/water-leak-system

# 3. Install PM2 for process management
echo "[*] Installing PM2..."
sudo npm install -g pm2

# 4. Build frontend
echo "[*] Building frontend..."
cd frontend
# Remove existing node_modules to ensure a clean, OS-compatible install
rm -rf node_modules package-lock.json
npm install
npm run build
cd ..

# 5. Install backend dependencies
echo "[*] Installing backend dependencies..."
cd backend
rm -rf node_modules package-lock.json
npm install

# 5. Setup environment variables
echo "[*] Configuring .env..."
cat > .env << EOF
PORT=4000
MQTT_BROKER=mqtts://a16525rk34u76s-ats.iot.us-east-1.amazonaws.com
AWS_REGION=us-east-1
SENSOR_TABLE=WaterSensorReadings
LEAK_TABLE=LeakEvents
EOF

# 6. Start the server
echo "[*] Starting server with PM2..."
pm2 start server.js --name "water-leak-backend"

# 7. Setup PM2 to start on boot
pm2 startup
pm2 save

echo "✅ Backend is now running on port 4000!"
echo "📡 Make sure to open port 4000 (TCP) in your EC2 Security Group."
echo "🔗 Also open port 1883/8883 for MQTT if needed (though AWS IoT handles this)."
