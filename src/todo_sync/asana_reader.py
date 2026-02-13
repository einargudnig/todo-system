"""Read tasks from Asana via the official Python SDK."""

from __future__ import annotations

from datetime import datetime

import asana
from asana.rest import ApiException

from todo_sync.taskwarrior import build_task_data

# Fields to request from the Asana API
OPT_FIELDS = "gid,name,completed,due_on,tags,tags.name,projects,projects.name,notes"


def _get_workspace_gid(api_client: asana.ApiClient, configured: str) -> str:
    """Resolve workspace GID: use configured value or auto-detect."""
    if configured:
        return configured

    workspaces_api = asana.WorkspacesApi(api_client)
    workspaces = list(workspaces_api.get_workspaces(opts={"limit": 10}))

    if not workspaces:
        raise RuntimeError("No Asana workspaces found for this account.")
    if len(workspaces) > 1:
        names = ", ".join(w.name for w in workspaces)
        raise RuntimeError(
            f"Multiple workspaces found ({names}). "
            "Set 'workspace' in your config to pick one."
        )
    return workspaces[0].gid


def fetch_asana_tasks(config: dict) -> list[dict]:
    """Fetch incomplete tasks from Asana and return normalized task dicts."""
    asana_cfg = config.get("asana", {})
    sync_cfg = config.get("sync", {})
    source_tag = sync_cfg.get("asana_tag", "asana")

    token = asana_cfg.get("personal_access_token", "")
    if not token or token == "YOUR_TOKEN_HERE":
        raise RuntimeError(
            "Asana personal access token not configured. "
            "Run 'todo-sync setup' or edit ~/.config/todo-sync/config.toml"
        )

    configuration = asana.Configuration()
    configuration.access_token = token
    api_client = asana.ApiClient(configuration)

    workspace_gid = _get_workspace_gid(api_client, asana_cfg.get("workspace", ""))

    # Get user's task list
    user_task_lists_api = asana.UserTaskListsApi(api_client)
    user_task_list = user_task_lists_api.get_user_task_list_for_user(
        user_gid="me",
        workspace=workspace_gid,
        opts={},
    )

    # Fetch tasks from the user's task list
    tasks_api = asana.TasksApi(api_client)
    raw_tasks = tasks_api.get_tasks_for_user_task_list(
        user_task_list_gid=user_task_list.gid,
        opts={"opt_fields": OPT_FIELDS},
    )

    result = []
    for t in raw_tasks:
        # Skip completed tasks
        if t.completed:
            continue

        # Parse due date
        due = None
        if t.due_on:
            try:
                due = datetime.strptime(t.due_on, "%Y-%m-%d")
            except (ValueError, TypeError):
                pass

        # Collect tag names
        tags = []
        if t.tags:
            tags = [tag.name for tag in t.tags if hasattr(tag, "name")]

        # Get first project name
        project_name = None
        if t.projects:
            for p in t.projects:
                if hasattr(p, "name") and p.name:
                    project_name = p.name
                    break

        # Build annotations from notes
        annotations = []
        if t.notes:
            annotations.append(t.notes)

        task_data = build_task_data(
            description=t.name,
            external_id_field="asana_gid",
            external_id=t.gid,
            source="asana",
            source_tag=source_tag,
            project=project_name,
            due=due,
            tags=tags,
            annotations=annotations,
        )
        result.append(task_data)

    return result
