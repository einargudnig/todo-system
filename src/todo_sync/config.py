"""Load and manage configuration from ~/.config/todo-sync/config.toml."""

from __future__ import annotations

import sys
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib


CONFIG_DIR = Path.home() / ".config" / "todo-sync"
CONFIG_PATH = CONFIG_DIR / "config.toml"


def load_config() -> dict:
    """Load config from disk. Returns empty sections if file doesn't exist."""
    defaults = {
        "asana": {"personal_access_token": "", "workspace": ""},
        "things": {"enabled": True, "areas": []},
        "sync": {"things_tag": "things3", "asana_tag": "asana"},
        "ollama": {"enabled": True, "model": "lfm2.5-thinking", "base_url": "http://localhost:11434"},
    }
    if not CONFIG_PATH.exists():
        return defaults

    with open(CONFIG_PATH, "rb") as f:
        user_cfg = tomllib.load(f)

    for section, vals in defaults.items():
        if section in user_cfg:
            vals.update(user_cfg[section])
        defaults[section] = vals

    return defaults


def config_exists() -> bool:
    return CONFIG_PATH.exists()


def create_default_config(asana_token: str = "") -> Path:
    """Write a starter config file and return its path."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    content = f"""\
[asana]
personal_access_token = "{asana_token}"
# workspace = ""

[things]
enabled = true
# areas = []

[sync]
things_tag = "things3"
asana_tag = "asana"

[ollama]
enabled = true
model = "lfm2.5-thinking"
# base_url = "http://localhost:11434"
"""
    CONFIG_PATH.write_text(content)
    return CONFIG_PATH
