# Deployment Guide for Raspberry Pi Dashboard

This guide will help you deploy your personal dashboard to a Raspberry Pi and configure it to start automatically on boot.

## Prerequisites

- Raspberry Pi with Raspberry Pi OS installed
- SSH access to your Raspberry Pi
- Python 3 installed (comes with Raspberry Pi OS)

## Step 1: Transfer Files to Raspberry Pi

Transfer your dashboard project to your Raspberry Pi. You can use `scp`, `rsync`, or git clone:

```bash
# Option A: Using git (recommended if you have a repository)
ssh pi@raspberrypi.local
cd ~
git clone <your-repository-url> dashboard_project

# Option B: Using scp from your development machine
scp -r /path/to/dashboard_project pi@raspberrypi.local:~/dashboard_project
```

## Step 2: Set Up Virtual Environment

SSH into your Raspberry Pi and set up the Python virtual environment:

```bash
ssh pi@raspberrypi.local

# Navigate to the project directory
cd ~/dashboard_project

# Install python3-venv if not already installed
sudo apt update
sudo apt install python3-venv python3-full -y

# Create the virtual environment
python3 -m venv venv

# Activate the virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt --upgrade

# Deactivate when done
deactivate
```

## Step 3: Configure Calendar Credentials

Ensure your Google Calendar credentials are properly set up:

1. Make sure `calendar_credentials.json` is in the project directory
2. On first run, you may need to authenticate (this creates `token.json`)
3. If running headless, you may need to do the initial OAuth flow on a machine with a browser, then copy `token.json` to the Pi

## Step 4: Test Manual Startup

Before setting up auto-start, test that the dashboard runs correctly:

```bash
cd ~/dashboard_project
source venv/bin/activate
python dashboard_server.py
```

Visit `http://raspberrypi.local:5000` (or your Pi's IP address) in a browser to verify it works.

Press `Ctrl+C` to stop the server.

## Step 5: Set Up Systemd Service (Auto-start on Boot)

Install the systemd service to start the dashboard automatically:

```bash
# Copy the service file from the deployment directory to systemd
sudo cp ~/dashboard_project/deployment/dashboard.service /etc/systemd/system/

# Edit the service file if your username or paths are different
sudo nano /etc/systemd/system/dashboard.service

# Reload systemd to recognize the new service
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable dashboard.service

# Start the service now
sudo systemctl start dashboard.service

# Check the status
sudo systemctl status dashboard.service
```

## Step 6: Manage the Service

### View Service Status
```bash
sudo systemctl status dashboard.service
```

### View Logs
```bash
# View recent logs
sudo journalctl -u dashboard.service -n 50

# Follow logs in real-time
sudo journalctl -u dashboard.service -f
```

### Start/Stop/Restart Service
```bash
sudo systemctl start dashboard.service
sudo systemctl stop dashboard.service
sudo systemctl restart dashboard.service
```

### Disable Auto-start
```bash
sudo systemctl disable dashboard.service
```

## Updating the Dashboard

When you make changes to your code:

```bash
# SSH into the Pi
ssh pi@raspberrypi.local

# Navigate to project directory
cd ~/dashboard_project

# Pull latest changes (if using git)
git pull

# Activate virtual environment
source venv/bin/activate

# Update dependencies if requirements.txt changed
pip install -r requirements.txt --upgrade

# Deactivate
deactivate

# Restart the service
sudo systemctl restart dashboard.service
```

## Troubleshooting

### Service won't start
- Check logs: `sudo journalctl -u dashboard.service -n 50`
- Verify paths in `/etc/systemd/system/dashboard.service` are correct
- Ensure virtual environment was created successfully
- Check file permissions

### Calendar not updating
- Verify `calendar_credentials.json` and `token.json` exist
- Check that the Pi has internet connectivity
- Review logs for API errors

### Can't access dashboard from browser
- Verify the service is running: `sudo systemctl status dashboard.service`
- Check firewall settings: `sudo ufw status` (allow port 5000 if needed)
- Try accessing via IP address instead of hostname
- Ensure you're on the same network as the Raspberry Pi

## Network Access

By default, the dashboard runs on `0.0.0.0:5000`, making it accessible from any device on your local network.

Access it via:
- `http://raspberrypi.local:5000` (if mDNS is working)
- `http://<raspberry-pi-ip-address>:5000`

To find your Pi's IP address:
```bash
hostname -I
```

## Security Notes

> [!WARNING]
> This setup is designed for **local network use only**. Do not expose this directly to the internet without:
> - Adding authentication
> - Setting up HTTPS
> - Implementing proper security measures
> - Using a reverse proxy (like nginx)
