import unittest
from datetime import datetime, timedelta
import sys
import os
import pytz

# Add parent directory to path to import calendar_poller
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from calendar_event import CalendarEvent  # noqa: E402
from calendar_manager import CalendarManager  # noqa: E402


class TestCalendarPollerOOP(unittest.TestCase):

    def setUp(self):
        self.utc = pytz.utc
        # Reference time: 20:00 UTC
        self.now_utc = datetime(2023, 10, 27, 20, 0, 0, tzinfo=self.utc)
        self.pending_delta = timedelta(minutes=15)
        self.prepare_delta = timedelta(minutes=60)

        # Helper to create an event dict
        self.create_event_data = lambda start, end: {
            'start': {'dateTime': start.isoformat()},
            'end': {'dateTime': end.isoformat()}
        }

    # --- CalendarEvent Tests ---

    def test_event_validity(self):
        # Good event
        data = self.create_event_data(
            self.now_utc, self.now_utc + timedelta(hours=1))
        event = CalendarEvent(data, self.utc)
        self.assertTrue(event.is_valid)
        self.assertEqual(event.start, self.now_utc)

        # Bad event
        event = CalendarEvent({}, self.utc)
        self.assertFalse(event.is_valid)

    def test_status_busy(self):
        # Event: 19:30 - 20:30 (Contains 20:00)
        start = self.now_utc - timedelta(minutes=30)
        end = self.now_utc + timedelta(minutes=30)

        event = CalendarEvent(self.create_event_data(start, end), self.utc)
        status, transition = event.get_status(
            self.now_utc, self.pending_delta, self.prepare_delta,
            has_prepare_status=True
        )
        self.assertEqual(status, "BUSY")
        self.assertEqual(transition, end + timedelta(microseconds=1))

    def test_status_pending(self):
        # Event starts at 20:10 (10 mins from now).
        # Pending window 15m (Starts 19:45).
        start = self.now_utc + timedelta(minutes=10)
        end = self.now_utc + timedelta(minutes=70)

        event = CalendarEvent(self.create_event_data(start, end), self.utc)
        status, transition = event.get_status(
            self.now_utc, self.pending_delta, self.prepare_delta,
            has_prepare_status=True
        )
        self.assertEqual(status, "PENDING")
        self.assertEqual(transition, start)

    def test_status_prepare(self):
        # Event starts at 20:45. Prepare window 60m (Starts 19:45).
        # Now is 20:00.
        start = self.now_utc + timedelta(minutes=45)
        end = self.now_utc + timedelta(hours=2)

        event = CalendarEvent(self.create_event_data(start, end), self.utc)
        status, transition = event.get_status(
            self.now_utc, self.pending_delta, self.prepare_delta,
            has_prepare_status=True
        )
        self.assertEqual(status, "PREPARE")
        self.assertEqual(transition, start - self.pending_delta)

    # --- CalendarManager Tests ---

    def test_manager_resolve_status_priority_busy_overrides_pending(self):
        # Mocking a manager instance partly
        # No config needed for _resolve_status_for_calendar logic check
        manager = CalendarManager([])

        # Config item
        config_item = {
            'statuses': {'BUSY': {}, 'PENDING': {}, 'PREPARE': {}},
            'pending_minutes': 15,
            'prepare_minutes': 60
        }

        # Events
        events = [
            # BUSY
            self.create_event_data(
                self.now_utc - timedelta(minutes=30),
                self.now_utc + timedelta(minutes=30)
            ),
            # PENDING
            self.create_event_data(
                self.now_utc + timedelta(minutes=10),
                self.now_utc + timedelta(minutes=70)
            )
        ]

        cal_status, next_change, _ = manager._resolve_status_for_calendar(
            "test_cal", events, config_item, self.now_utc
        )

        self.assertEqual(cal_status, "BUSY")

        # Next change should be the EARLIEST transition
        # BUSY ends 20:30.
        # PENDING starts (actually, transitions to BUSY) at 20:10.
        # So next change is 20:10.
        expected_change = self.now_utc + timedelta(minutes=10)
        self.assertEqual(next_change, expected_change)

    def test_manager_resolve_status_prepare_vs_free(self):
        manager = CalendarManager([])
        config_item = {
            'statuses': {'BUSY': {}, 'PENDING': {}, 'PREPARE': {}},
            'pending_minutes': 15,
            'prepare_minutes': 60
        }

        # Event is Prepare (Starts 20:45)
        events = [
            self.create_event_data(
                self.now_utc + timedelta(minutes=45),
                self.now_utc + timedelta(hours=2)
            )
        ]

        cal_status, next_change, _ = manager._resolve_status_for_calendar(
            "test_cal", events, config_item, self.now_utc
        )

        self.assertEqual(cal_status, "PREPARE")

        # Next change is when PREPARE ends/PENDING starts: Start - 15m = 20:30
        expected_change = self.now_utc + timedelta(minutes=30)
        self.assertEqual(next_change, expected_change)


if __name__ == '__main__':
    unittest.main()
