from datetime import datetime, timedelta
import pytz


class CalendarEvent:
    def __init__(self, api_data, comparison_timezone=pytz.utc):
        self._data = api_data
        self.tz = comparison_timezone
        self._parse_times()

    def _parse_times(self):
        try:
            start_str = self._data['start'].get('dateTime')
            end_str = self._data['end'].get('dateTime')

            if start_str and end_str:
                self.start = datetime.fromisoformat(
                    start_str).astimezone(self.tz)
                self.end = datetime.fromisoformat(end_str).astimezone(self.tz)
            else:
                self.start = None
                self.end = None
        except Exception:
            self.start = None
            self.end = None

    @property
    def is_valid(self):
        return self.start is not None and self.end is not None

    def get_status(
        self, now_utc, pending_delta, prepare_delta, has_prepare_status
    ):
        """
        Determines the status of a single event relative to the current time.
        Returns: (status_string, transition_time_datetime_or_None)
        """
        if not self.is_valid:
            return "FREE", None

        # 1. Active: BUSY
        if self.start <= now_utc < self.end:
            return "BUSY", self.end + timedelta(microseconds=1)

        # 2. Upcoming: PENDING (Short window)
        if self.start - pending_delta <= now_utc < self.start:
            return "PENDING", self.start

        # 3. Upcoming: PREPARE (Long window, optional)
        if has_prepare_status and prepare_delta > pending_delta:
            if (self.start - prepare_delta <= now_utc <
                    self.start - pending_delta):
                return "PREPARE", self.start - pending_delta
            elif self.start > now_utc:
                # Future event, waiting for PREPARE start
                return "FREE", self.start - prepare_delta

        # 4. Future event (waiting for PENDING start, if no PREPARE or
        # before PREPARE)
        if self.start > now_utc:
            return "FREE", self.start - pending_delta

        # Fallback
        return "FREE", None
