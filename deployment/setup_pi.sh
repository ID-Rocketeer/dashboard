#!/bin/bash
# setup_pi.sh - Automated setup script for Raspberry Pi Dashboard
# Run this script on your Raspberry Pi after transferring the project files

set -e  # Exit on any error

echo "======================================"
echo "Dashboard Setup Script for Raspberry Pi"
echo "======================================"
echo ""

# Get the directory where this script is located (deployment directory)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Project root is the parent directory
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$PROJECT_DIR"

echo "Project directory: $PROJECT_DIR"
echo ""

# Check if running on Raspberry Pi (optional check)
if [ -f /proc/device-tree/model ]; then
    PI_MODEL=$(cat /proc/device-tree/model)
    echo "Detected: $PI_MODEL"
    echo ""
fi

# Step 1: Install system dependencies
echo "[1/5] Installing system dependencies..."
sudo apt update
sudo apt install -y python3-venv python3-full python3-pip

# Step 2: Create virtual environment
echo "[2/5] Creating virtual environment..."
if [ -d "venv" ]; then
    echo "Virtual environment already exists. Skipping creation."
else
    python3 -m venv venv
    echo "Virtual environment created."
fi

# Step 3: Install Python dependencies
echo "[3/5] Installing Python dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt --upgrade
deactivate
echo "Dependencies installed."

# Step 4: Check for credentials
echo "[4/5] Checking for calendar credentials..."
if [ ! -f "calendar_credentials.json" ]; then
    echo "WARNING: calendar_credentials.json not found!"
    echo "You will need to add this file before the dashboard can access Google Calendar."
else
    echo "calendar_credentials.json found."
fi

# Step 5: Install systemd service
echo "[5/5] Installing systemd service..."

# The service file is in the same directory as this script
SERVICE_FILE="$SCRIPT_DIR/dashboard.service"

if [ -f "$SERVICE_FILE" ]; then
    # Update the service file with the project directory
    sed "s|/home/pi/dashboard_project|$PROJECT_DIR|g" "$SERVICE_FILE" > /tmp/dashboard.service
    
    # Update the user if not 'pi'
    CURRENT_USER=$(whoami)
    sed -i "s|User=pi|User=$CURRENT_USER|g" /tmp/dashboard.service
    
    sudo cp /tmp/dashboard.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable dashboard.service
    
    echo "Systemd service installed and enabled."
    echo ""
    echo "To start the service now, run:"
    echo "  sudo systemctl start dashboard.service"
    echo ""
    echo "To view service status, run:"
    echo "  sudo systemctl status dashboard.service"
else
    echo "WARNING: dashboard.service file not found. Skipping service installation."
fi

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "  1. Ensure calendar_credentials.json is in place"
echo "  2. Start the service: sudo systemctl start dashboard.service"
echo "  3. Check status: sudo systemctl status dashboard.service"
echo "  4. View logs: sudo journalctl -u dashboard.service -f"
echo ""
echo "Access your dashboard at:"
echo "  http://$(hostname -I | awk '{print $1}'):5000"
echo ""
