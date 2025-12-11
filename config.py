# config.py

# --- POLLING INTERVALS ---

ESO_POLL_INTERVAL = 60
CALENDAR_MIN_REFRESH_INTERVAL = 30
CALENDAR_MAX_FETCH_INTERVAL_SECONDS = 12 * 3600  # 12 hours


# --- GOOGLE CALENDAR CONFIGURATION ---

# List of calendar IDs to check.
# STATUSES dictionary now groups class and text for each state.
CALENDAR_CONFIGS = [
    {
        'id': 'primary',
        'calendar_id': 'primary',
        'name': 'Primary Calendar',
        'pending_minutes': 15,
        'statuses': {
            'FREE':    {'class': 'status-green',  'text': 'FREE'},
            'PENDING': {'class': 'status-yellow', 'text': 'SOON'},
            'BUSY':    {'class': 'status-red',    'text': 'BUSY'},
            'ERROR':   {'class': 'status-orange', 'text': 'ERROR'},
        }
    },
    {
        'id': 'ESO',
        'calendar_id': '507igmu5ucighkk0et6je2oils@group.calendar.google.com',
        'name': 'ESO',
        'pending_minutes': 15,
        'statuses': {
            'FREE':    {'class': 'status-transparent', 'text': ''},
            'PENDING': {'class': 'status-yellow',      'text': 'ARM'},
            'BUSY':    {'class': 'status-purple',      'text': 'KILL'},
            'ERROR':   {'class': 'status-orange',      'text': 'ERROR'}
        }
    },
    {
        'id': 'medical',
        'calendar_id': 'fhu26gklo4t5jonio3sv9o1i18@group.calendar.google.com',
        'name': 'Medical Appointments',
        'pending_minutes': 30,  # The SHORT window (30 minutes)
        'prepare_minutes': 60,  # The LONG window (60 minutes)
        'statuses': {
            'FREE':    {'class': 'status-transparent',  'text': ''},
            'PREPARE': {'class': 'status-blue', 'text': 'PREP'},
            'PENDING': {'class': 'medical-go',    'text': 'LEAVE'},
            'BUSY':    {'class': 'medical-busy',  'text': 'APT'},
            'ERROR':   {'class': 'status-orange', 'text': 'ERROR'},
        }
    }
]

# --- ESO DISPLAY CONFIGURATION ---

ESO_CONFIG = {
    # These names are displayed regardless of the server status (UP/DOWN/ERROR)
    'NA_DISPLAY_NAME': 'PC-NA',
    'EU_DISPLAY_NAME': 'PC-EU',
}

# Timezone for the server's event analysis
# (UTC is recommended for server operations)
TIMEZONE = "UTC"

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']
CREDENTIALS_FILE = 'calendar_credentials.json'
TOKEN_FILE = 'token.json'
