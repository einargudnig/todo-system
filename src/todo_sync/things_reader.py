"""Read tasks from Things 3 via the things.py library."""

from __future__ import annotations

from datetime import datetime

from todo_sync.taskwarrior import build_task_data


def fetch_things_tasks(config: dict) -> list[dict]:
    """Fetch incomplete tasks from Things 3 and return normalized task dicts."""
    import things

    things_cfg = config.get("things", {})
    sync_cfg = config.get("sync", {})
    source_tag = sync_cfg.get("things_tag", "things3")
    area_filter = things_cfg.get("areas", [])

    raw_tasks = things.todos()

    # If area filter is set, look up area titles and filter
    if area_filter:
        areas = {a["uuid"]: a["title"] for a in things.areas()}
        raw_tasks = [
            t for t in raw_tasks
            if t.get("area") and areas.get(t["area"]) in area_filter
        ]

    # Look up area and project titles for mapping
    areas = {a["uuid"]: a["title"] for a in things.areas()}
    projects = {p["uuid"]: p["title"] for p in things.projects()}

    result = []
    for t in raw_tasks:
        # Resolve project name
        project_name = None
        if t.get("project"):
            project_name = projects.get(t["project"])
        elif t.get("area"):
            # Use area as project if no project is set
            project_name = areas.get(t["area"])

        # Parse deadline
        due = None
        if t.get("deadline"):
            try:
                due = datetime.strptime(t["deadline"], "%Y-%m-%d")
            except (ValueError, TypeError):
                pass

        # Collect tags
        tags = list(t.get("tags", []) or [])

        # Build annotations from notes
        annotations = []
        if t.get("notes"):
            annotations.append(t["notes"])

        task_data = build_task_data(
            description=t["title"],
            external_id_field="things3_uuid",
            external_id=t["uuid"],
            source="things3",
            source_tag=source_tag,
            project=project_name,
            due=due,
            tags=tags,
            annotations=annotations,
        )
        result.append(task_data)

    return result
