# todo-sync — Status & Next Steps

## What this is

A TypeScript CLI tool that does **bidirectional sync** between Things 3, Asana, and Taskwarrior. Things 3 tasks are filtered through a local Ollama LLM so only computer/dev-related tasks make it into Taskwarrior (groceries, errands, etc. get skipped). Completed tasks in Taskwarrior are pushed back to their source.

## Current state

### Done

- **Things 3 reader** — fetches incomplete tasks via direct SQLite access
- **Asana reader** — fetches "My Tasks" via official SDK with PAT auth
- **Taskwarrior integration** — UDA-based duplicate detection (`things3_uuid`, `asana_gid`), upsert logic
- **Ollama filter** — each Things 3 task gets classified by `lfm2.5-thinking` before import
- **Bidirectional sync** — push completions back to Things 3 (URL scheme) and Asana (API)
- **Taskwarrior hooks** — auto-sync on task completion via on-exit hook
- **CLI** — `todo-sync-ts setup|things|asana|all|push|sync|install-hook|uninstall-hook`
- **Config** — TOML config at `~/.config/todo-sync/config.toml`
- **launchd plist** — optional 30-min auto-sync

### Not yet tested end-to-end

- `todo-sync-ts setup` (creates config + Taskwarrior UDAs)
- `todo-sync-ts things` against real Things 3 data
- `todo-sync-ts asana` with a real PAT
- Re-running sync to verify no duplicates are created
- Push-back of completions to Things 3 and Asana

## How to use

```bash
cd ts

# Install dependencies & build
npm install
npm run build

# First-time setup (creates config, configures Taskwarrior UDAs)
node dist/cli.js setup

# Import from Things 3 (filtered through Ollama)
node dist/cli.js things

# Import from Asana
node dist/cli.js asana

# Import from both
node dist/cli.js all

# Push completions back to sources
node dist/cli.js push

# Full bidirectional sync (pull + push)
node dist/cli.js sync

# Install Taskwarrior hook for auto-sync
node dist/cli.js install-hook

# Verify in Taskwarrior
task list
task +things3 list
task +asana list
```

## Asana PAT setup

1. Go to https://app.asana.com/0/my-apps
2. Click "Create new token", name it "todo-sync"
3. Copy the token
4. Either paste during `todo-sync-ts setup` or edit `~/.config/todo-sync/config.toml`

## Config file

Location: `~/.config/todo-sync/config.toml`

```toml
[asana]
personal_access_token = "YOUR_TOKEN_HERE"

[things]
enabled = true
auth_token = ""

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
├── config.example.toml
├── STATUS.md               ← you are here
├── ts/
│   ├── src/
│   │   ├── cli.ts              ← Commander CLI (entry point)
│   │   ├── config.ts           ← Config loading
│   │   ├── types.ts            ← Shared types
│   │   ├── things-reader.ts    ← Things 3 → normalized tasks (SQLite)
│   │   ├── asana-reader.ts     ← Asana → normalized tasks
│   │   ├── things-writer.ts    ← Push completions to Things 3
│   │   ├── asana-writer.ts     ← Push completions to Asana
│   │   ├── taskwarrior.ts      ← Taskwarrior UDAs + upsert
│   │   ├── ollama-filter.ts    ← LLM task classifier
│   │   └── hook-on-exit.ts     ← Taskwarrior on-exit hook
│   ├── hooks/
│   │   └── on-exit-things-sync ← Bash wrapper for hook
│   ├── package.json
│   └── tsconfig.json
└── launchd/
    └── com.todo-sync.plist ← optional scheduled sync
```

## What to do next

1. **Run `todo-sync-ts setup`** — make sure UDAs get created and config file is written
2. **Run `todo-sync-ts things`** — test against your real Things 3 tasks, check that the Ollama filter is making sensible decisions
3. **Tweak the prompt** if the filter is too aggressive or too lenient — edit `ts/src/ollama-filter.ts`
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
