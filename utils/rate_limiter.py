import asyncio
import time
from typing import Optional


class RateLimiter:
    """
    Rate limiter to control API request frequency.

    Ensures that no more than max_requests_per_minute requests are made per minute
    and no more than max_requests_per_day requests are made per day.
    """

    def __init__(
        self,
        max_requests_per_minute: Optional[int] = None,
        max_requests_per_day: Optional[int] = None
    ):
        """
        Initialize the rate limiter.

        Args:
            max_requests_per_minute: Maximum number of requests allowed per minute.
                                     If None, no per-minute limit is enforced.
            max_requests_per_day: Maximum number of requests allowed per day.
                                  If None, no per-day limit is enforced.
        """
        self.max_requests_per_minute = max_requests_per_minute
        self.max_requests_per_day = max_requests_per_day
        self.request_times = []
        self.lock = asyncio.Lock()

        # If per-minute rate limiting is enabled, calculate the minimum delay between requests
        if max_requests_per_minute and max_requests_per_minute > 0:
            self.min_delay = 60.0 / max_requests_per_minute
        else:
            self.min_delay = 0

    async def acquire(self):
        """
        Acquire permission to make a request.

        This method will block until it's safe to make a request according to the rate limits.

        The lock is only held while checking and recording, never while sleeping:
        a caller waiting out a window (up to 24h for the daily limit) must not
        block every other caller's check. After each sleep the limits are
        re-checked, since another caller may have taken the freed slot.
        """
        if not self.max_requests_per_minute and not self.max_requests_per_day:
            # Rate limiting is disabled
            return

        while True:
            message = None
            async with self.lock:
                current_time = time.time()

                # Clean up old request times (keep requests from last 24 hours for daily limit)
                if self.max_requests_per_day:
                    self.request_times = [t for t in self.request_times if current_time - t < 86400]
                elif self.max_requests_per_minute:
                    self.request_times = [t for t in self.request_times if current_time - t < 60]

                wait_time = 0.0

                # Check daily limit first
                if self.max_requests_per_day and self.max_requests_per_day > 0:
                    daily_requests = [t for t in self.request_times if current_time - t < 86400]
                    if len(daily_requests) >= self.max_requests_per_day:
                        wait_time = 86400 - (current_time - daily_requests[0])
                        hours = wait_time / 3600
                        message = f"Daily rate limit reached ({self.max_requests_per_day} requests/day). Waiting {hours:.1f} hours..."

                # Check per-minute limit
                if wait_time <= 0 and self.max_requests_per_minute and self.max_requests_per_minute > 0:
                    minute_requests = [t for t in self.request_times if current_time - t < 60]
                    if len(minute_requests) >= self.max_requests_per_minute:
                        wait_time = 60 - (current_time - minute_requests[0])
                        message = f"Rate limit reached ({self.max_requests_per_minute} requests/min). Waiting {wait_time:.1f}s..."
                    elif self.request_times and self.min_delay > 0:
                        # Also ensure minimum delay between consecutive requests
                        time_since_last = current_time - self.request_times[-1]
                        if time_since_last < self.min_delay:
                            wait_time = self.min_delay - time_since_last

                if wait_time <= 0:
                    # Record this request
                    self.request_times.append(current_time)
                    return

            if message:
                print(message)
            await asyncio.sleep(wait_time)
