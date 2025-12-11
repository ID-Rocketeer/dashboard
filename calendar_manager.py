import os
import threading
import pytz
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import config
from calendar_event import CalendarEvent


# --- GOOGLE AUTHENTICATION ---

def get_google_service():
    """Authenticates with Google and returns the Calendar service object."""
    creds = None

    if os.path.exists(config.TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(
            config.TOKEN_FILE, config.SCOPES)

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


class CalendarManager:
    def __init__(self, calendar_configs):
        self.configs = calendar_configs
        self._local_event_cache = {}
        self._last_cache_update = datetime(1970, 1, 1, tzinfo=pytz.utc)
        self._computed_cache = {
            'statuses': [],
            'valid_until': datetime(1970, 1, 1, tzinfo=pytz.utc)
        }
        self._lock = threading.Lock()

        # Priority for status display: BUSY > PENDING > PREPARE > FREE
        self.PRIORITY_MAP = {
            'BUSY': 3,
            'PENDING': 2,
            'PREPARE': 1,
            'FREE': 0,
            'ERROR': -1
        }

    def _fetch_from_api(self):
        try:
            service = get_google_service()
            new_cache = {}
            now_utc = datetime.now(pytz.utc)

            # Fetch events: 4h past to 48h future
            time_min = (now_utc - timedelta(hours=4)).isoformat()
            time_max = (now_utc + timedelta(hours=48)).isoformat()

            for item in self.configs:
                events_result = service.events().list(
                    calendarId=item["calendar_id"],
                    timeMin=time_min,
                    timeMax=time_max,
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()
                new_cache[item["id"]] = events_result.get('items', [])

            with self._lock:
                self._local_event_cache = new_cache
                self._last_cache_update = now_utc
                # Invalidate computation cache
                self._computed_cache['valid_until'] = datetime(
                    1970, 1, 1, tzinfo=pytz.utc)

            print("API Fetch successful. Cache updated.")

        except Exception as e:
            print(f"FATAL ERROR during Google Calendar API fetch: {e}")

    def _resolve_status_for_calendar(
        self, calendar_id, events, config_item, now_utc
    ):
        current_calendar_status = "FREE"
        current_max_priority = 0
        next_change_time = None

        status_map = config_item['statuses']
        pending_delta = timedelta(
            minutes=config_item.get('pending_minutes', 15))

        prepare_delta = pending_delta
        if 'PREPARE' in status_map:
            prepare_minutes = config_item.get('prepare_minutes', 60)
            prepare_delta = timedelta(minutes=prepare_minutes)

        has_prepare_status = 'PREPARE' in status_map

        for event_data in events:
            event = CalendarEvent(
                event_data, comparison_timezone=now_utc.tzinfo)
            if not event.is_valid:
                continue

            status, transition_time = event.get_status(
                now_utc, pending_delta, prepare_delta, has_prepare_status
            )

            priority = self.PRIORITY_MAP.get(status, -1)
            if priority > current_max_priority:
                current_max_priority = priority
                current_calendar_status = status

            if transition_time and transition_time > now_utc:
                if (next_change_time is None or
                        transition_time < next_change_time):
                    next_change_time = transition_time

        return current_calendar_status, next_change_time, status_map

    def check_status(self, force_fetch=False):
        now_utc = datetime.now(pytz.utc)
        max_interval = config.CALENDAR_MAX_FETCH_INTERVAL_SECONDS

        # Check if we need API fetch
        time_since_last = (now_utc - self._last_cache_update).total_seconds()
        if force_fetch or time_since_last > max_interval:
            self._fetch_from_api()

        # Check computation cache
        with self._lock:
            if now_utc < self._computed_cache['valid_until']:
                return (
                    self._computed_cache['statuses'],
                    self._computed_cache['valid_until']
                )
            else:
                print(f"DEBUG: CACHE MISS. Now: {now_utc} "
                      f"vs Valid Until: {self._computed_cache['valid_until']}")

        # Re-compute status
        current_statuses = []
        global_next_change_time = None

        with self._lock:
            for item in self.configs:
                cal_id = item["id"]
                events = self._local_event_cache.get(cal_id, [])

                cal_status, cal_next_change, status_map = (
                    self._resolve_status_for_calendar(
                        cal_id, events, item, now_utc
                    )
                )

                if cal_next_change:
                    if global_next_change_time is None:
                        global_next_change_time = cal_next_change
                    elif cal_next_change < global_next_change_time:
                        global_next_change_time = cal_next_change

                status_details = status_map.get(
                    cal_status, status_map.get('ERROR', {}))
                if not status_details:
                    status_details = {'class': '', 'text': ''}

                current_statuses.append({
                    "id": cal_id,
                    "name": item["name"],
                    "status": cal_status,
                    "css_class": status_details.get('class', ''),
                    "display_text": status_details.get('text', ''),
                })

            # Update cache
            if global_next_change_time:
                valid_until = global_next_change_time
            else:
                valid_until = now_utc + timedelta(days=365)

            self._computed_cache['statuses'] = current_statuses
            self._computed_cache['valid_until'] = valid_until

        return current_statuses, global_next_change_time
