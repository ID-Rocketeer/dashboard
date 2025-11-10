# calendar_poller.py
import os
import threading
import json
import pytz
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import config 

# --- CACHE AND LOCK ---

LOCAL_EVENT_CACHE = {} 
LAST_CACHE_UPDATE = datetime(1970, 1, 1, tzinfo=pytz.utc) 
CACHE_LOCK = threading.Lock() 


# --- GOOGLE AUTHENTICATION ---

def get_google_service():
    """Authenticates with Google and returns the Calendar service object."""
    creds = None
    
    if os.path.exists(config.TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(config.TOKEN_FILE, config.SCOPES)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(config.CREDENTIALS_FILE):
                raise FileNotFoundError(
                    f"Credentials file '{config.CREDENTIALS_FILE}' not found. "
                    f"Please download the OAuth client JSON and rename it."
                )
                
            flow = InstalledAppFlow.from_client_secrets_file(
                config.CREDENTIALS_FILE, config.SCOPES)
            creds = flow.run_local_server(port=0)
            
        with open(config.TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())

    return build('calendar', 'v3', credentials=creds)


# --- CORE POLLING AND STATUS LOGIC ---

def fetch_events_for_calendar(service, calendar_id):
    """Fetches upcoming events for a single calendar ID."""
    now_utc = datetime.now(pytz.utc)
    
    # Fetch events from 4 hours in the past up to 48 hours in the future
    time_min = (now_utc - timedelta(hours=4)).isoformat()
    time_max = (now_utc + timedelta(hours=48)).isoformat() 
    
    events_result = service.events().list(calendarId=calendar_id, 
                                          timeMin=time_min,
                                          timeMax=time_max,
                                          singleEvents=True,
                                          orderBy='startTime').execute()
    return events_result.get('items', [])


def check_calendar_status(force_fetch=False):
    """
    Checks the local cache or fetches new data from the API, determines status, 
    and returns the next time a status change is expected.
    """
    global LOCAL_EVENT_CACHE, LAST_CACHE_UPDATE
    
    # now_utc is used as the current reference time for all comparisons
    now_utc = datetime.now(pytz.utc)
    
    time_since_last_fetch = (now_utc - LAST_CACHE_UPDATE).total_seconds()
    needs_api_fetch = (time_since_last_fetch > config.CALENDAR_MAX_FETCH_INTERVAL_SECONDS)

    if force_fetch or needs_api_fetch:
        try:
            service = get_google_service()
            new_cache = {}
            for item in config.CALENDAR_CONFIGS: 
                events = fetch_events_for_calendar(service, item["calendar_id"])
                new_cache[item["id"]] = events
                
            with CACHE_LOCK:
                LOCAL_EVENT_CACHE = new_cache
                LAST_CACHE_UPDATE = now_utc # Update timestamp on successful fetch
            
            print(f"API Fetch successful. Cache updated.") 

        except Exception as e:
            print(f"FATAL ERROR during Google Calendar API fetch: {e}")
    
    
    # --- STATUS ANALYSIS AND NEXT CHANGE TIME CALCULATION ---
    
    current_statuses = []
    next_change_time = None
    
    # Define the comparison timezone as UTC to match now_utc
    comparison_timezone = pytz.utc
    
    with CACHE_LOCK:
        for item in config.CALENDAR_CONFIGS:
            cal_id = item["id"]
            events = LOCAL_EVENT_CACHE.get(cal_id, [])
            
            # 1. Initialize to default FREE state
            status = "FREE"
            
            # Retrieve status map
            status_map = item['statuses']
            
            # Get pending/prepare windows from config
            pending_delta = timedelta(minutes=item.get('pending_minutes', 15))
            prepare_delta = pending_delta
            
            if 'PREPARE' in status_map:
                prepare_minutes = item.get('prepare_minutes', 60)
                prepare_delta = timedelta(minutes=prepare_minutes)

            # Check events in order. The first event that matches an active status wins (BUSY > PENDING > PREPARE)
            for event in events:
                try:
                    event_start_str = event['start'].get('dateTime')
                    event_end_str = event['end'].get('dateTime')
                    
                    # CRITICAL FIX: Skip all-day events (they don't have 'dateTime' in the start/end dicts)
                    if not event_start_str or not event_end_str:
                        continue 
                    
                    # --- Time-Specific Event ---
                    # Parse with existing timezone info and convert to UTC for consistent comparison
                    event_start = datetime.fromisoformat(event_start_str).astimezone(comparison_timezone)
                    event_end = datetime.fromisoformat(event_end_str).astimezone(comparison_timezone)

                    
                    # 1. Check for current BUSY status (Highest Priority)
                    # The event is ongoing if the current time is >= start AND < end
                    if event_start <= now_utc < event_end:
                        status = "BUSY"
                        
                        # The next change time is when the event ends (plus a microsecond to ensure transition)
                        transition_time = event_end + timedelta(microseconds=1)
                        if next_change_time is None or transition_time < next_change_time:
                            next_change_time = transition_time
                        
                        break # Found active event, stop checking others for this calendar
                        
                    # 2. Check for PENDING status 
                    # The current time is within the short pre-window
                    elif event_start - pending_delta <= now_utc < event_start:
                        status = "PENDING"
                        
                        # The next change time is the exact start of the event
                        if next_change_time is None or event_start < next_change_time:
                            next_change_time = event_start
                        
                        break # Found active pre-window, stop checking
                        
                    # 3. Check for PREPARE status 
                    # The current time is within the long pre-window, but outside the short window
                    elif 'PREPARE' in status_map and prepare_delta > pending_delta:
                        if event_start - prepare_delta <= now_utc < event_start - pending_delta:
                            status = "PREPARE"
                            
                            # The next change time is when the status transitions from PREPARE to PENDING
                            transition_time = event_start - pending_delta
                            if next_change_time is None or transition_time < next_change_time:
                                next_change_time = transition_time
                            
                            break
                        
                    # 4. Find the next status change time (for FREE state)
                    # For all future events, calculate the soonest transition time (PREPARE or PENDING start)
                    elif event_start > now_utc:
                        if 'PREPARE' in status_map and prepare_delta > pending_delta:
                            transition_time = event_start - prepare_delta
                        else:
                            transition_time = event_start - pending_delta
                        
                        # Track the earliest upcoming transition time
                        if next_change_time is None or transition_time < next_change_time:
                            next_change_time = transition_time
                            
                except Exception as e:
                    print(f"Error parsing event for calendar {cal_id}: {e}. Status set to ERROR.")
                    status = "ERROR"
            
            # --- FINAL OUTPUT GENERATION ---
            
            # Get the final status details (Class and Text)
            status_details = status_map.get(status, status_map['ERROR']) 
            
            current_statuses.append({
                "id": cal_id,
                "name": item["name"],
                "status": status,
                "css_class": status_details['class'],
                "display_text": status_details['text'], 
            })

    return current_statuses, next_change_time