"""Logging handler that streams records into an asyncio.Queue for the Gradio GUI."""
from __future__ import annotations

import asyncio
import logging
from typing import Optional


class QueueLogHandler(logging.Handler):
    """Pushes formatted log records onto an asyncio.Queue.

    The queue and event loop are reassigned per run via `attach`.
    Thread-safe: uses loop.call_soon_threadsafe so background workers can log.
    """

    def __init__(self) -> None:
        super().__init__()
        self.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        self._queue: Optional[asyncio.Queue[str]] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def attach(self, queue: asyncio.Queue[str], loop: asyncio.AbstractEventLoop) -> None:
        self._queue = queue
        self._loop = loop

    def detach(self) -> None:
        self._queue = None
        self._loop = None

    def emit(self, record: logging.LogRecord) -> None:
        queue = self._queue
        loop = self._loop
        if queue is None or loop is None:
            return
        try:
            msg = self.format(record)
        except Exception:
            self.handleError(record)
            return
        try:
            loop.call_soon_threadsafe(queue.put_nowait, msg)
        except RuntimeError:
            pass


_handler: Optional[QueueLogHandler] = None


def install_once() -> QueueLogHandler:
    """Install the handler on the root logger (idempotent) and return it."""
    global _handler
    if _handler is None:
        _handler = QueueLogHandler()
        root = logging.getLogger()
        if root.level > logging.INFO or root.level == logging.NOTSET:
            root.setLevel(logging.INFO)
        root.addHandler(_handler)
    return _handler
