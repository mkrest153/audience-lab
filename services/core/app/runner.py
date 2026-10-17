"""Worker threads that run queued jobs for one engine."""
from __future__ import annotations

import logging
import threading

log = logging.getLogger("audience_lab.runner")


class Runner:
    def __init__(self, engine, workers: int = 2, name: str = "main"):
        self.engine = engine
        self.workers = max(1, workers)
        self.name = name
        self.wake_event = threading.Event()
        self.stop_event = threading.Event()
        self.threads: list[threading.Thread] = []
        engine.on_enqueue = self.wake

    def wake(self):
        self.wake_event.set()

    def start(self):
        self.engine.recover_jobs()
        for i in range(self.workers):
            t = threading.Thread(target=self._loop, name=f"jobs-{self.name}-{i}", daemon=True)
            t.start()
            self.threads.append(t)
        self.wake()

    def stop(self):
        self.stop_event.set()
        self.wake()

    def _loop(self):
        while not self.stop_event.is_set():
            try:
                job = self.engine.claim_next_job()
            except Exception:  # noqa: BLE001
                log.exception("claim failed")
                job = None
            if job:
                self.engine.run_job(job)
                self.wake_event.set()   # let a sibling look for the next one
                continue
            self.wake_event.wait(timeout=3.0)
            self.wake_event.clear()
