"""Taskwarrior integration: UDA setup, task upsert, and duplicate detection."""

from __future__ import annotations

import subprocess
from datetime import datetime

from tasklib import Task, TaskWarrior

# UDAs that must exist in Taskwarrior config for sync to work
REQUIRED_UDAS = {
    "things3_uuid": {"type": "string", "label": "Things 3 UUID"},
    "asana_gid": {"type": "string", "label": "Asana GID"},
    "source": {"type": "string", "label": "Sync source"},
}


def _run_task_config(key: str, value: str) -> None:
    """Set a Taskwarrior config value (creates if missing)."""
    subprocess.run(
        ["task", "rc.confirmation=off", "config", key, value],
        capture_output=True,
        check=True,
    )


def ensure_udas() -> list[str]:
    """Configure required UDAs in Taskwarrior. Returns list of UDAs created."""
    # Read current config to check what already exists
    result = subprocess.run(
        ["task", "rc.confirmation=off", "show"],
        capture_output=True,
        text=True,
    )
    existing = result.stdout

    created = []
    for name, attrs in REQUIRED_UDAS.items():
        # Check if UDA already configured
        if f"uda.{name}.type" in existing:
            continue
        _run_task_config(f"uda.{name}.type", attrs["type"])
        _run_task_config(f"uda.{name}.label", attrs["label"])
        created.append(name)

    return created


def get_tw() -> TaskWarrior:
    """Get a TaskWarrior instance."""
    return TaskWarrior(create=True)


def find_by_external_id(tw: TaskWarrior, uda_name: str, value: str) -> Task | None:
    """Find a pending or waiting task by its external ID UDA."""
    # Search pending tasks
    tasks = tw.tasks.filter(status="pending", **{uda_name: value})
    if tasks:
        return tasks[0]

    # Also check waiting tasks
    tasks = tw.tasks.filter(status="waiting", **{uda_name: value})
    if tasks:
        return tasks[0]

    return None


def upsert_task(
    tw: TaskWarrior,
    external_id_field: str,
    external_id: str,
    task_data: dict,
) -> tuple[str, Task]:
    """Create or update a Taskwarrior task.

    Returns ("created" | "updated" | "skipped", task).
    """
    existing = find_by_external_id(tw, external_id_field, external_id)

    # Fields that map directly
    annotations = task_data.pop("annotations", [])

    if existing is not None:
        changed = False
        for key, val in task_data.items():
            if val is None:
                continue
            current = existing[key] if key in existing else None
            if current != val:
                existing[key] = val
                changed = True

        if changed:
            existing.save()
            return "updated", existing
        return "skipped", existing

    # Create new task
    clean_data = {k: v for k, v in task_data.items() if v is not None}
    task = Task(tw, **clean_data)
    task.save()

    # Add annotations after save
    for note in annotations:
        if note and note.strip():
            task.add_annotation(note.strip()[:1000])

    return "created", task


def build_task_data(
    *,
    description: str,
    external_id_field: str,
    external_id: str,
    source: str,
    source_tag: str,
    project: str | None = None,
    due: datetime | None = None,
    tags: list[str] | None = None,
    priority: str | None = None,
    annotations: list[str] | None = None,
) -> dict:
    """Build a normalized task data dict ready for upsert_task."""
    task_tags = list(tags) if tags else []
    if source_tag not in task_tags:
        task_tags.append(source_tag)

    data = {
        "description": description,
        external_id_field: external_id,
        "source": source,
        "tags": task_tags,
    }

    if project:
        data["project"] = project
    if due:
        data["due"] = due
    if priority and priority in ("H", "M", "L"):
        data["priority"] = priority
    if annotations:
        data["annotations"] = annotations

    return data
