import os
import time
import json
import threading 
from datetime import datetime, timedelta # MODIFIED: Added timedelta
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit
import config 
import calendar_poller
import eso_status_poller 

# --- FLASK SETUP ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your_default_secret_key') 
socketio = SocketIO(app)

# --- GLOBAL CACHE AND RATE LIMITING ---
ESO_STATUS_CACHE = {
    "PC NA": "N/A",  
    "PC EU": "N/A",
}

# Global variable to track the last manual refresh time (initialized to a time far in the past)
LAST_MANUAL_REFRESH_TIME = datetime(1970, 1, 1)

# --- THREAD WORKERS ---

def update_eso_status_in_background():
    """
    Background thread worker function to periodically update the ESO status cache.
    """
    global ESO_STATUS_CACHE
    
    try:
        POLLING_INTERVAL_SECONDS = config.ESO_CONFIG['ESO_POLL_INTERVAL']
    except KeyError:
        POLLING_INTERVAL_SECONDS = 300 
        print("WARNING: ESO_POLL_INTERVAL not found. Defaulting to 300 seconds.")

    while True:
        try:
            latest_status = eso_status_poller.fetch_eso_status()
            ESO_STATUS_CACHE.update(latest_status)
            print("ESO Status Cache Updated:", ESO_STATUS_CACHE)
            
            # Note: This ESO thread still triggers a full update every 60s (or config value)
            socketio.emit('status_update', get_dashboard_data_from_cache_or_poller())

        except Exception as e:
            print(f"ERROR during ESO status polling: {e}")
            
        time.sleep(POLLING_INTERVAL_SECONDS)


def calendar_poller_in_background():
    """
    NEW: Dedicated thread to schedule calendar updates based on event transitions.
    This eliminates the dependency on the ESO 60-second poll interval.
    """
    MIN_SLEEP = 60 # Never sleep for less than 60 seconds (prevents excessive checks)
    DEFAULT_SLEEP = 300 # Sleep for 5 minutes if no upcoming events are found

    while True:
        try:
            # 1. Check status and get the next scheduled transition time
            # Note: We do NOT force a fetch here, we rely on the cache expiration logic inside the poller.
            _, next_change_time = calendar_poller.check_calendar_status()
            
            sleep_time = DEFAULT_SLEEP
            
            if next_change_time:
                # 2. Calculate time until the next scheduled change
                now_utc = datetime.now(next_change_time.tzinfo) # Match timezone for subtraction
                time_until_change = (next_change_time - now_utc).total_seconds()
                
                # If the change is in the past, or very soon, use MIN_SLEEP to force a quick re-check
                if time_until_change <= 0:
                    sleep_time = MIN_SLEEP
                else:
                    # Sleep until the event time, but not less than MIN_SLEEP
                    sleep_time = max(time_until_change, MIN_SLEEP)
            
            print(f"Calendar Poller scheduled for next check in {sleep_time:.1f} seconds.")
            time.sleep(sleep_time)
            
            # 3. After sleeping, force the status update and notify clients
            # We force a fetch=True here to ensure we update the status based on the passage of time
            calendar_poller.check_calendar_status(force_fetch=True) 
            print("CALENDAR WORKER: Pushing event-driven update.")
            socketio.emit('status_update', get_dashboard_data_from_cache_or_poller())

        except Exception as e:
            print(f"ERROR during Calendar Poller worker: {e}")
            # If an error occurs, wait a minute before trying again
            time.sleep(MIN_SLEEP) 


# --- DATA RETRIEVAL ---

def get_dashboard_data_from_cache_or_poller():
    """Retrieves the latest status data and prepares the final structure for client-side use."""
    
    calendar_data_tuple = calendar_poller.check_calendar_status()
    
    data = {
        "eso_status": ESO_STATUS_CACHE, 
        "calendar_statuses": calendar_data_tuple[0], 
    }
    
    data['eso_config'] = {
        'NA_DISPLAY_NAME': config.ESO_CONFIG['NA_DISPLAY_NAME'],
        'EU_DISPLAY_NAME': config.ESO_CONFIG['EU_DISPLAY_NAME'],
    }

    # --- DEBUG: CACHE DATA PAYLOAD DUMP ---
    # print("--- DEBUG: CACHE DATA PAYLOAD DUMP ---")
    # print(json.dumps(data, indent=4))
    # print("-------------------------------------")
    
    return data

# --- ROUTES ---

@app.route("/")
def main_dashboard():
    """Main dashboard route to render the HTML template."""
    cache_data = get_dashboard_data_from_cache_or_poller()
    return render_template('dashboard.html',
                           cache=cache_data,
                           calendar_configs=config.CALENDAR_CONFIGS)


@app.route("/api/status")
def api_status():
    """API endpoint for dashboard.js to fetch status updates."""
    data = get_dashboard_data_from_cache_or_poller()
    return jsonify(data)


@app.route("/api/refresh_calendar", methods=['POST'])
def api_refresh_calendar():
    """Endpoint for manual calendar refresh trigger with rate limiting."""
    global LAST_MANUAL_REFRESH_TIME
    
    current_time = datetime.now()
    
    time_since_last_refresh = (current_time - LAST_MANUAL_REFRESH_TIME).total_seconds()
    cooldown = config.CALENDAR_MIN_REFRESH_INTERVAL 
    
    if time_since_last_refresh < cooldown:
        remaining_wait = int(cooldown - time_since_last_refresh)
        message = f"Please wait {remaining_wait} more seconds before refreshing again."
        print(f"RATE LIMIT EXCEEDED: {message}")
        return jsonify({"success": False, "message": message}), 429
        
    LAST_MANUAL_REFRESH_TIME = current_time
    
    # Force the calendar poller to fetch new data from Google Calendar API
    calendar_poller.check_calendar_status(force_fetch=True)
    
    # Notify all clients to fetch the newly updated cache data
    socketio.emit('status_update', get_dashboard_data_from_cache_or_poller())
    
    return jsonify({"success": True, "message": "Refresh request accepted and data update triggered."})


# --- SOCKETIO EVENTS ---

@socketio.on('connect')
def handle_connect():
    print('Client connected:', request.sid)
    socketio.emit('status_update', get_dashboard_data_from_cache_or_poller())


# --- MAIN RUN BLOCK ---

if __name__ == '__main__':
    # 1. START THE BACKGROUND POLLER THREAD for ESO (still needed for ESO)
    eso_thread = threading.Thread(target=update_eso_status_in_background, daemon=True)
    eso_thread.start()
    
    # 2. START THE BACKGROUND POLLER THREAD for CALENDAR (NEW: event-driven updates)
    calendar_thread = threading.Thread(target=calendar_poller_in_background, daemon=True)
    calendar_thread.start()
    
    # 3. Start the web server
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)