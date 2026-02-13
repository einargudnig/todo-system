"""CLI entry point for todo-sync."""

from __future__ import annotations

import click

from todo_sync.config import config_exists, create_default_config, load_config
from todo_sync.taskwarrior import ensure_udas, get_tw, upsert_task


@click.group()
def main():
    """One-way sync from Things 3 and Asana into Taskwarrior."""


@main.command()
def setup():
    """Interactive first-time setup: create config and configure UDAs."""
    click.echo("=== todo-sync setup ===\n")

    # Configure UDAs
    click.echo("Configuring Taskwarrior UDAs...")
    created = ensure_udas()
    if created:
        click.echo(f"  Created UDAs: {', '.join(created)}")
    else:
        click.echo("  UDAs already configured.")

    # Create config file
    if config_exists():
        click.echo(f"\nConfig file already exists. Edit it at:")
        click.echo(f"  ~/.config/todo-sync/config.toml")
    else:
        click.echo("\n--- Asana Setup ---")
        click.echo("To get a Personal Access Token:")
        click.echo("  1. Go to https://app.asana.com/0/my-apps")
        click.echo('  2. Click "Create new token"')
        click.echo('  3. Name it "todo-sync" and copy the token\n')

        token = click.prompt(
            "Paste your Asana PAT (or press Enter to skip)",
            default="",
            show_default=False,
        )
        path = create_default_config(asana_token=token)
        click.echo(f"\nConfig created at: {path}")

    click.echo("\nSetup complete! Try running:")
    click.echo("  todo-sync things   # import from Things 3")
    click.echo("  todo-sync asana    # import from Asana")
    click.echo("  todo-sync all      # import from both")


def _sync_source(
    name: str,
    fetch_fn,
    external_id_field: str,
    config: dict,
    *,
    use_ollama: bool = False,
) -> None:
    """Run a sync for a single source and print results."""
    click.echo(f"Syncing from {name}...")

    try:
        tasks = fetch_fn(config)
    except Exception as e:
        click.echo(f"  Error reading {name}: {e}", err=True)
        return

    click.echo(f"  Fetched {len(tasks)} tasks from {name}")

    # Optionally filter through Ollama
    filtered_out = 0
    if use_ollama:
        ollama_cfg = config.get("ollama", {})
        if ollama_cfg.get("enabled", True):
            from todo_sync.ollama_filter import filter_tasks

            model = ollama_cfg.get("model", "lfm2.5-thinking")
            base_url = ollama_cfg.get("base_url", "http://localhost:11434")

            click.echo(f"  Filtering through Ollama ({model})...")
            try:
                tasks, excluded = filter_tasks(
                    tasks, model=model, base_url=base_url
                )
                filtered_out = len(excluded)
                for t in excluded:
                    click.echo(f"    skip: {t['description']}")
            except RuntimeError as e:
                click.echo(f"  Ollama error: {e}", err=True)
                click.echo("  Importing all tasks without filtering.")

    tw = get_tw()
    counts = {"created": 0, "updated": 0, "skipped": 0}

    for task_data in tasks:
        external_id = task_data[external_id_field]
        action, _ = upsert_task(tw, external_id_field, external_id, task_data)
        counts[action] += 1

    click.echo(
        f"  {name}: {counts['created']} new, "
        f"{counts['updated']} updated, "
        f"{counts['skipped']} unchanged"
        + (f", {filtered_out} filtered out by LLM" if filtered_out else "")
    )


@main.command()
def things():
    """Import tasks from Things 3."""
    from todo_sync.things_reader import fetch_things_tasks

    config = load_config()
    things_cfg = config.get("things", {})
    if not things_cfg.get("enabled", True):
        click.echo("Things 3 sync is disabled in config.")
        return

    _sync_source("Things 3", fetch_things_tasks, "things3_uuid", config, use_ollama=True)


@main.command()
def asana():
    """Import tasks from Asana."""
    from todo_sync.asana_reader import fetch_asana_tasks

    config = load_config()
    _sync_source("Asana", fetch_asana_tasks, "asana_gid", config)


@main.command(name="all")
def sync_all():
    """Import tasks from both Things 3 and Asana."""
    config = load_config()

    things_cfg = config.get("things", {})
    if things_cfg.get("enabled", True):
        from todo_sync.things_reader import fetch_things_tasks

        _sync_source("Things 3", fetch_things_tasks, "things3_uuid", config, use_ollama=True)
    else:
        click.echo("Things 3 sync is disabled in config, skipping.")

    asana_cfg = config.get("asana", {})
    token = asana_cfg.get("personal_access_token", "")
    if token and token != "YOUR_TOKEN_HERE":
        from todo_sync.asana_reader import fetch_asana_tasks

        _sync_source("Asana", fetch_asana_tasks, "asana_gid", config)
    else:
        click.echo("Asana not configured, skipping.")
