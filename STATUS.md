# todo-sync — Status & Next Steps

## What this is

A Python CLI tool that does **one-way import** from Things 3 and Asana into Taskwarrior. Things 3 tasks are filtered through a local Ollama LLM so only computer/dev-related tasks make it into Taskwarrior (groceries, errands, etc. get skipped).

## Current state

### Done

- **Project structure** — installable Python package in `src/todo_sync/`
- **Things 3 reader** — fetches incomplete tasks via `things.py`, maps fields to Taskwarrior
- **Asana reader** — fetches "My Tasks" via official SDK with PAT auth
- **Taskwarrior integration** — UDA-based duplicate detection (`things3_uuid`, `asana_gid`), upsert logic
- **Ollama filter** — each Things 3 task gets classified by `lfm2.5-thinking` before import
- **CLI** — `todo-sync things|asana|all|setup`
- **Config** — TOML config at `~/.config/todo-sync/config.toml`
- **launchd plist** — optional 30-min auto-sync
- **Installed in `.venv/`** — ready to use

### Not yet tested end-to-end

- `todo-sync setup` (creates config + Taskwarrior UDAs)
- `todo-sync things` against real Things 3 data
- `todo-sync asana` with a real PAT
- Re-running sync to verify no duplicates are created

## How to use

```bash
# Activate the venv
source .venv/bin/activate

# First-time setup (creates config, configures Taskwarrior UDAs)
todo-sync setup

# Import from Things 3 (filtered through Ollama)
todo-sync things

# Import from Asana
todo-sync asana

# Import from both
todo-sync all

# Verify in Taskwarrior
task list
task +things3 list
task +asana list
```

## Asana PAT setup

1. Go to https://app.asana.com/0/my-apps
2. Click "Create new token", name it "todo-sync"
3. Copy the token
4. Either paste during `todo-sync setup` or edit `~/.config/todo-sync/config.toml`

## Config file

Location: `~/.config/todo-sync/config.toml`

```toml
[asana]
personal_access_token = "YOUR_TOKEN_HERE"

[things]
enabled = true

[sync]
things_tag = "things3"
asana_tag = "asana"

[ollama]
enabled = true
model = "lfm2.5-thinking"
```

## File layout

```
todo-system/
├── pyproject.toml
├── config.example.toml
├── STATUS.md               ← you are here
├── .venv/                  ← Python virtual environment
├── src/todo_sync/
│   ├── cli.py              ← Click CLI (entry point)
│   ├── config.py           ← Config loading
│   ├── things_reader.py    ← Things 3 → normalized tasks
│   ├── asana_reader.py     ← Asana → normalized tasks
│   ├── taskwarrior.py      ← Taskwarrior UDAs + upsert
│   └── ollama_filter.py    ← LLM task classifier
└── launchd/
    └── com.todo-sync.plist ← optional scheduled sync
```

## What to do next

1. **Run `todo-sync setup`** — make sure UDAs get created and config file is written
2. **Run `todo-sync things`** — test against your real Things 3 tasks, check that the Ollama filter is making sensible decisions
3. **Tweak the prompt** if the filter is too aggressive or too lenient — edit `src/todo_sync/ollama_filter.py` (`PROMPT_TEMPLATE`)
4. **Set up Asana** if you want that source too — get a PAT and add it to config
5. **Optional: install launchd** for auto-sync every 30 min:
   ```bash
   cp launchd/com.todo-sync.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.todo-sync.plist
   ```

## Possible future improvements

- Batch Ollama calls (send multiple tasks in one prompt) for speed
- Cache LLM decisions so re-syncs don't re-classify unchanged tasks
- Add `--no-filter` flag to bypass Ollama
- Apply Ollama filter to Asana tasks too
- Dry-run mode (`--dry-run`) to preview what would be imported
