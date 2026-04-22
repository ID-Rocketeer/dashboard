import os
import time
import threading
from datetime import datetime
from flask import Flask, render_template, jsonify, request, make_response, redirect, url_for
from flask_socketio import SocketIO, join_room
import config
from calendar_manager import CalendarManager
import eso_status_poller


# --- FLASK SETUP ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get(
    'SECRET_KEY', 'your_default_secret_key')
socketio = SocketIO(app)

# --- GLOBAL SINGLETONS ---
CALENDAR_MANAGER = CalendarManager(config.CALENDAR_CONFIGS)

# --- GLOBAL CACHE AND RATE LIMITING ---
ESO_STATUS_CACHE = {
    "NA": "N/A",
    "EU": "N/A",
}

# Global variable to track the last manual refresh time
# (initialized to a time far in the past)
LAST_MANUAL_REFRESH_TIME = datetime(1970, 1, 1)
CALENDAR_WAKE_EVENT = threading.Event()

# --- THREAD WORKERS ---


def update_eso_status_in_background():
    """
    Background thread worker function to periodically update the ESO
    status cache.
    """

    try:
        POLLING_INTERVAL_SECONDS = config.ESO_POLL_INTERVAL
    except AttributeError:
        POLLING_INTERVAL_SECONDS = 300
        print(
            "WARNING: ESO_POLL_INTERVAL not found in config. "
            "Defaulting to 300 seconds."
        )

    while True:
        try:
            latest_status = eso_status_poller.fetch_eso_status()
            ESO_STATUS_CACHE.update(latest_status)
            print("ESO Status Cache Updated:", ESO_STATUS_CACHE)

            # Note: This ESO thread still triggers a full update every 60s
            broadcast_status_update()

        except Exception as e:
            print(f"ERROR during ESO status polling: {e}")

        time.sleep(POLLING_INTERVAL_SECONDS)


def calendar_poller_in_background():
    """
    Dedicated thread to schedule calendar updates based on event
    transitions.
    Eliminates the dependency on the ESO 60-second poll interval.
    Uses a threading Event to wake up immediately on manual refresh.
    """
    MIN_SLEEP = 1  # Check every second for transitions
    DEFAULT_SLEEP = 60  # Check every minute if nothing is scheduled

    while True:
        try:
            # 1. Check status and get the next scheduled transition time
            # Note: We rely on the cache expiration logic inside the poller.
            _, next_change_time = CALENDAR_MANAGER.check_status()

            sleep_time = DEFAULT_SLEEP

            if next_change_time:
                # 2. Calculate time until the next scheduled change
                now_utc = datetime.now(next_change_time.tzinfo)
                time_until_change = (
                    next_change_time - now_utc).total_seconds()

                # If the change is in the past, or very soon, use MIN_SLEEP
                if time_until_change <= 0:
                    sleep_time = MIN_SLEEP
                else:
                    # Sleep until the event time, but not less than MIN_SLEEP
                    # Add small buffer to wake up after target time?
                    # Actually, waking up exactly on time or slightly before is
                    # fine because we re-check.
                    sleep_time = max(time_until_change, MIN_SLEEP)

            # Cap the sleep time to ensure we occasionally check for issues
            # or very stale states
            sleep_time = min(sleep_time, 3600)

            print(f"Calendar Poller scheduled for next check in "
                  f"{sleep_time:.1f} s.")

            # Wait for the calculated time OR until a manual wake-up event
            # is triggered
            woken_by_event = CALENDAR_WAKE_EVENT.wait(timeout=sleep_time)

            if woken_by_event:
                print("CALENDAR WORKER: Woken by manual refresh event!")
                CALENDAR_WAKE_EVENT.clear()  # Reset the event

            # 3. After sleeping (or waking), re-evaluate status.
            # IMPORTANT: We use force_fetch=False. We trust the cache (which
            # manual refresh updates).
            # We only want to trigger a client update if the status *logic*
            # dictates it (e.g. time passed).
            # However, if we were woken by event, the cache is ALREADY updated
            # by the finding thread.
            # We just need to emit the status.

            # If we just timed out naturally, we might need to emit a state
            # change (e.g. pending -> busy).
            # check_calendar_status returns current statuses.
            # Effectively, every loop iteration pushes the current state to
            # clients.

            # NOTE: check_status(force_fetch=False) will only hit API if
            # 12h expired.
            CALENDAR_MANAGER.check_status(force_fetch=False)

            print("CALENDAR WORKER: Pushing update.")
            broadcast_status_update()

        except Exception as e:
            print(f"ERROR during Calendar Poller worker: {e}")
            # If an error occurs, wait a minute before trying again
            time.sleep(60)


# --- DATA RETRIEVAL ---


def broadcast_status_update():
    """Helper to emit stripped down data to tunnel clients and full data to local clients."""
    local_data = get_dashboard_data_from_cache_or_poller(is_tunnel=False)
    socketio.emit('status_update', local_data, to='local_clients')
    
    tunnel_data = get_dashboard_data_from_cache_or_poller(is_tunnel=True)
    socketio.emit('status_update', tunnel_data, to='tunnel_clients')


def get_dashboard_data_from_cache_or_poller(is_tunnel=False):
    """
    Retrieves the latest status data and prepares the final structure
    for client-side use. Filters out non-public calendars if is_tunnel=True.
    """

    calendar_data_tuple = CALENDAR_MANAGER.check_status()
    calendar_statuses = calendar_data_tuple[0]

    if is_tunnel:
        public_ids = [c['id'] for c in config.CALENDAR_CONFIGS if c.get('public') == True]
        calendar_statuses = [s for s in calendar_statuses if s['id'] in public_ids]

    # Collect all possible text labels from config to help client scale fonts
    all_possible_texts = set()
    for cal_config in config.CALENDAR_CONFIGS:
        for status_info in cal_config.get('statuses', {}).values():
            text = status_info.get('text', '')
            if text:
                all_possible_texts.add(text)
    
    # Add ESO names too
    all_possible_texts.add(config.ESO_CONFIG.get('NA_DISPLAY_NAME', 'PC-NA'))
    all_possible_texts.add(config.ESO_CONFIG.get('EU_DISPLAY_NAME', 'PC-EU'))

    data = {
        "eso_status": ESO_STATUS_CACHE,
        "calendar_statuses": calendar_statuses,
        "all_possible_texts": list(all_possible_texts)
    }

    data['eso_config'] = {
        'NA_DISPLAY_NAME': config.ESO_CONFIG['NA_DISPLAY_NAME'],
        'EU_DISPLAY_NAME': config.ESO_CONFIG['EU_DISPLAY_NAME'],
    }

    return data


def is_restricted_tunnel():
    """Returns True if the connection is coming through the Cloudflare tunnel 
       AND does NOT possess a valid device authorization cookie."""
    if 'CF-Ray' not in request.headers:
        return False  # Direct local network connection
        
    cookie_token = request.cookies.get('device_auth')
    expected_token = os.environ.get('DEVICE_TOKEN')
    if cookie_token and expected_token and cookie_token == expected_token:
        return False  # Authorized personal device connecting via tunnel!
        
    return True # Unrecognized stranger on the tunnel connection


# --- ROUTES ---


@app.before_request
def log_tunnel_requests():
    """Logs incoming requests via Cloudflare Tunnel to the system journal."""
    if 'CF-Ray' in request.headers:
        client_ip = request.headers.get('CF-Connecting-IP', request.remote_addr)
        print(f"[TUNNEL] {request.method} {request.path} - Origin IP: {client_ip}", flush=True)


@app.route("/auth")
def authenticate_device():
    provided_token = request.args.get('token')
    expected_token = os.environ.get('DEVICE_TOKEN')
    
    if expected_token and provided_token == expected_token:
        response = make_response(redirect(url_for('main_dashboard')))
        # Set a 10-year persistent HTTP cookie securely
        response.set_cookie('device_auth', provided_token, max_age=315360000, httponly=True)
        return response
        
    return "Invalid or missing token", 403


@app.route("/")
def main_dashboard():
    """Main dashboard route to render the HTML template."""
    is_tunnel = is_restricted_tunnel()
    cache_data = get_dashboard_data_from_cache_or_poller(is_tunnel=is_tunnel)
    return render_template('dashboard.html',
                           cache=cache_data,
                           calendar_configs=config.CALENDAR_CONFIGS,
                           is_tunnel=is_tunnel)


@app.route("/api/status")
def api_status():
    """API endpoint for dashboard.js to fetch status updates."""
    is_tunnel = is_restricted_tunnel()
    data = get_dashboard_data_from_cache_or_poller(is_tunnel=is_tunnel)
    return jsonify(data)


@app.route("/api/refresh_calendar", methods=['POST'])
def api_refresh_calendar():
    """Endpoint for manual calendar refresh trigger with rate limiting."""
    global LAST_MANUAL_REFRESH_TIME

    current_time = datetime.now()

    time_since_last_refresh = (
        current_time - LAST_MANUAL_REFRESH_TIME).total_seconds()
    cooldown = config.CALENDAR_MIN_REFRESH_INTERVAL

    if time_since_last_refresh < cooldown:
        remaining_wait = int(cooldown - time_since_last_refresh)
        message = (
            f"Please wait {remaining_wait} more seconds before "
            "refreshing again."
        )
        print(f"RATE LIMIT EXCEEDED: {message}")
        return jsonify({"success": False, "message": message}), 429

    LAST_MANUAL_REFRESH_TIME = current_time

    # Force the calendar poller to fetch new data from Google Calendar API
    CALENDAR_MANAGER.check_status(force_fetch=True)

    # Notify all clients to fetch the newly updated cache data
    broadcast_status_update()

    # Wake up the background thread so it can immediately re-schedule based
    # on new data
    CALENDAR_WAKE_EVENT.set()

    return jsonify({
        "success": True,
        "message": "Refresh request accepted and data update triggered."
    })


# --- SOCKETIO EVENTS ---


@socketio.on('connect')
def handle_connect():
    is_tunnel = is_restricted_tunnel()
    room = 'tunnel_clients' if is_tunnel else 'local_clients'
    join_room(room)
    
    if 'CF-Ray' in request.headers:
        client_ip = request.headers.get('CF-Connecting-IP', request.remote_addr)
        auth_status = "Unauthorized" if is_tunnel else "Authorized"
        print(f'[TUNNEL] WebSocket Connected ({auth_status}) - Origin IP: {client_ip}', flush=True)
    else:
        print(f'Client locally connected: {request.sid}', flush=True)

    socketio.emit('status_update', get_dashboard_data_from_cache_or_poller(is_tunnel=is_tunnel), to=request.sid)


# --- MAIN RUN BLOCK ---


if __name__ == '__main__':
    # 1. START THE BACKGROUND POLLER THREAD for ESO (still needed for ESO)
    eso_thread = threading.Thread(
        target=update_eso_status_in_background, daemon=True)
    eso_thread.start()

    # 2. START THE BACKGROUND POLLER THREAD for CALENDAR
    calendar_thread = threading.Thread(
        target=calendar_poller_in_background, daemon=True)
    calendar_thread.start()

    # 3. Start the web server
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True, host='0.0.0.0', port=5000)
