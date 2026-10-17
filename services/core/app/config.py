"""Settings from the environment. No key or model name is hard-wired elsewhere."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name, default):
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _list(name, default):
    v = os.environ.get(name)
    if not v:
        return list(default)
    return [x.strip().lower() for x in v.split(",") if x.strip()]


# Public bodies whose works are free to use under Article 24-2 of the Korean
# Copyright Act (national and local government) and the government's own
# portals. Only these are fetched and stored as full text (rights OPEN).
DEFAULT_OPEN_DOMAINS = ["go.kr", "korea.kr", "kosis.kr"]


@dataclass
class Settings:
    data_dir: str = field(default_factory=lambda: os.environ.get("DATA_DIR", "./data"))
    web_dist: str = field(default_factory=lambda: os.environ.get("WEB_DIST", ""))
    seed_demo: bool = field(default_factory=lambda: _bool("SEED_DEMO", True))
    # the public demo workspace starts over at every boot, so visitors always see the worked case
    demo_reset: bool = field(default_factory=lambda: _bool("DEMO_RESET_ON_BOOT", True))
    demo_accounts: bool = field(default_factory=lambda: _bool("DEMO_ACCOUNTS", True))
    demo_password: str = field(default_factory=lambda: os.environ.get("DEMO_PASSWORD", "demo1234"))
    demo_stage_delay: float = field(default_factory=lambda: float(os.environ.get("DEMO_STAGE_DELAY", "0.7")))
    admin_email: str = field(default_factory=lambda: os.environ.get("ADMIN_EMAIL", "").strip().lower())
    admin_password: str = field(default_factory=lambda: os.environ.get("ADMIN_PASSWORD", ""))
    admin_name: str = field(default_factory=lambda: os.environ.get("ADMIN_NAME", "관리자"))
    openai_api_key: str = field(default_factory=lambda: os.environ.get("OPENAI_API_KEY", "").strip())
    openai_model: str = field(default_factory=lambda: os.environ.get("OPENAI_MODEL", "gpt-5.4-mini"))
    openai_search_model: str = field(default_factory=lambda: os.environ.get("OPENAI_SEARCH_MODEL", "") or os.environ.get("OPENAI_MODEL", "gpt-5.4-mini"))
    openai_reasoning: str = field(default_factory=lambda: os.environ.get("OPENAI_REASONING_EFFORT", "low"))
    openai_timeout: int = field(default_factory=lambda: _int("OPENAI_TIMEOUT", 180))
    daily_model_calls: int = field(default_factory=lambda: _int("DAILY_MODEL_CALL_LIMIT", 600))
    daily_search_calls: int = field(default_factory=lambda: _int("DAILY_SEARCH_CALL_LIMIT", 150))
    open_domains: list = field(default_factory=lambda: _list("OPEN_DOMAINS", DEFAULT_OPEN_DOMAINS))
    related_search: bool = field(default_factory=lambda: _bool("RELATED_NEWS_LINKS", True))
    workers: int = field(default_factory=lambda: _int("JOB_WORKERS", 2))
    cors_origins: list = field(default_factory=lambda: _list("CORS_ORIGINS", []))
    writes_per_minute: int = field(default_factory=lambda: _int("WRITES_PER_MINUTE", 30))

    @property
    def llm_configured(self) -> bool:
        k = self.openai_api_key
        return bool(k) and "xxxx" not in k


settings = Settings()
