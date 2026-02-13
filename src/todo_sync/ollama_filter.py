"""Filter tasks through a local Ollama LLM to decide what belongs in Taskwarrior."""

from __future__ import annotations

import json
import urllib.request
import urllib.error

PROMPT_TEMPLATE = """\
You are a strict task classifier. You decide if a task belongs in a software \
developer's terminal-based task manager (Taskwarrior).

ONLY answer "yes" for tasks that are done ON A COMPUTER:
- Coding, debugging, code review, pull requests
- Writing documents, emails, spreadsheets
- System admin, deployments, server work
- Digital design, technical research, online learning

Answer "no" for ANYTHING physical or away from a computer:
- Shopping, groceries, buying things in stores
- Chores: cleaning, laundry, cooking, dishes
- Appointments: doctor, dentist, haircut, mechanic
- Exercise, sports, outdoor activities
- Errands: post office, bank, picking things up
- Social: parties, dinners, meetups

When in doubt, answer "no".

Answer with ONLY "yes" or "no".

Task: {title}
{notes_section}\
"""


def classify_task(
    title: str,
    notes: str = "",
    *,
    model: str = "lfm2.5-thinking",
    base_url: str = "http://localhost:11434",
) -> bool:
    """Ask Ollama whether a task belongs in Taskwarrior. Returns True to include."""
    notes_section = f"Notes: {notes}\n" if notes else ""
    prompt = PROMPT_TEMPLATE.format(title=title, notes_section=notes_section)

    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.0},
    }).encode()

    req = urllib.request.Request(
        f"{base_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError) as e:
        raise RuntimeError(f"Cannot reach Ollama at {base_url}: {e}") from e

    answer = body.get("response", "").strip().lower()
    # Strip any thinking tags the model might produce
    if "</think>" in answer:
        answer = answer.split("</think>")[-1].strip()
    return answer.startswith("yes")


def filter_tasks(
    tasks: list[dict],
    *,
    model: str = "lfm2.5-thinking",
    base_url: str = "http://localhost:11434",
) -> tuple[list[dict], list[dict]]:
    """Filter a list of task dicts through Ollama.

    Returns (included, excluded) task lists.
    """
    included = []
    excluded = []

    for task in tasks:
        title = task.get("description", "")
        # Notes are stored in annotations
        annotations = task.get("annotations", [])
        notes = annotations[0] if annotations else ""

        if classify_task(title, notes, model=model, base_url=base_url):
            included.append(task)
        else:
            excluded.append(task)

    return included, excluded
