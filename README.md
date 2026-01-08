# ESO & Google Calendar Dashboard

A responsive, real-time monitoring interface designed to provide a "single pane of glass" view for **Elder Scrolls Online** server status and **Google Calendar** events.

---

## ✨ Key Features

* **Real-Time Server Monitoring:** Tracks status for selected Elder Scrolls Online megaservers.
* **Intelligent Calendar Caching:** Implements a "slow-poll" strategy for Google Calendar to prevent API rate-limiting, with a user-triggered override for instant updates.
* **WebSocket Driven:** Uses WebSockets to push updates to client browsers immediately as they happen.
* **Flexible Configuration:** Uses Python lists in `config.py` for straightforward data source management.
* **Robust Security:** Supports multiple mechanisms to secure calendar credentials and passwords.

### 🖥️ Display & Hardware Optimization
* **Aspect-Ratio Aware:** The client-side UI intelligently adapts its presentation based on the display's aspect ratio.
* **Active Anti-Burn-In Engine:** Built for 24/7 "always-on" hardware. Every **30 seconds**, the UI triggers:
    * **Micro-Shifting:** Moves text within elements by small pixel offsets.
    * **Module Randomization:** Randomly redistributes and shifts the position of UI modules along the long axis to ensure uniform pixel wear across the entire panel.

---

## 🛠 Installation & Deployment

This project includes a dedicated deployment suite optimized for **Raspberry Pi (systemd-based)** environments.

1. **Automated Setup:** The `/deployment` directory contains a script that automates system requirements and service installation.
2. **Detailed Instructions:** Refer to the [Deployment README](./deployment/README.md) for environment-specific prerequisites and configuration steps.

```bash
# Navigate to deployment and review instructions
cd deployment
cat README.md
```

---

## 🖼️ Interface Gallery

The dashboard's aspect-aware logic ensures the layout remains functional and aesthetic regardless of screen orientation. 

> **Note:** Due to the anti-burn-in engine, UI elements will shift and rearrange every 30 seconds to protect your hardware.

| Landscape (Widescreen) | Portrait (Vertical Monitor/Mobile) |
| :---: | :---: |
| <img src="https://github.com/user-attachments/assets/c41f9cf6-7a87-4555-8c34-c06a36c87c84" width="500"> | <img src="https://github.com/user-attachments/assets/f5cd9f68-3442-44cc-bcf0-b16ff480c0ba" width="230"> |

---

*Developed by [ID-Rocketeer](https://github.com/ID-Rocketeer)*
