# Deployment Files

This directory contains all files needed to deploy the dashboard to a Raspberry Pi.

## Files

- **`dashboard.service`** - Systemd service file for auto-starting the dashboard on boot
- **`DEPLOYMENT.md`** - Comprehensive deployment guide with manual setup instructions
- **`setup_pi.sh`** - Automated setup script for quick deployment

## Quick Start

For automated deployment, run:

```bash
cd ~/dashboard_project/deployment
chmod +x setup_pi.sh
./setup_pi.sh
```

For manual deployment, follow the instructions in **DEPLOYMENT.md**.
