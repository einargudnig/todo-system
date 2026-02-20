#!/usr/bin/env node

/** CLI entry point for todo-sync (TypeScript version). */

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, configExists, createDefaultConfig } from "./config.js";
import { ensureUdas, upsertTask, setDependency, findAllPendingBySource, completeTask } from "./taskwarrior.js";
import { fetchThingsTasks } from "./things-reader.js";
import { fetchAsanaTasks } from "./asana-reader.js";
import { filterTasks } from "./ollama-filter.js";
import { syncCompletionsToThings, findCompletedThingsTasks, isAlreadySyncedToThings } from "./things-writer.js";
import { syncCompletionsToAsana, findCompletedAsanaTasks, isAlreadySyncedToAsana } from "./asana-writer.js";
import type { Config, TaskData, UpsertAction } from "./types.js";

const program = new Command();

program
  .name("todo-sync-ts")
  .description("One-way sync from Things 3 and Asana into Taskwarrior.")
  .version("0.1.0")
  .option("--dry-run", "Show what would happen without making changes");

// ─── setup ─────────────────────────────────────────────────────────
program
  .command("setup")
  .description("Interactive first-time setup: create config and configure UDAs")
  .action(async () => {
    console.log("=== todo-sync setup ===\n");

    // Configure UDAs
    console.log("Configuring Taskwarrior UDAs...");
    const created = ensureUdas();
    if (created.length > 0) {
      console.log(`  Created UDAs: ${created.join(", ")}`);
    } else {
      console.log("  UDAs already configured.");
    }

    // Create config file
    if (configExists()) {
      console.log("\nConfig file already exists. Edit it at:");
      console.log("  ~/.config/todo-sync/config.toml");
    } else {
      console.log("\n--- Asana Setup ---");
      console.log("To get a Personal Access Token:");
      console.log("  1. Go to https://app.asana.com/0/my-apps");
      console.log('  2. Click "Create new token"');
      console.log('  3. Name it "todo-sync" and copy the token\n');

      const rl = createInterface({ input: stdin, output: stdout });
      const token = await rl.question(
        "Paste your Asana PAT (or press Enter to skip): ",
      );
      rl.close();

      const path = createDefaultConfig(token || "");
      console.log(`\nConfig created at: ${path}`);
    }

    console.log("\nSetup complete! Try running:");
    console.log("  todo-sync-ts things   # import from Things 3");
    console.log("  todo-sync-ts asana    # import from Asana");
    console.log("  todo-sync-ts all      # import from both");
  });

// ─── sync helper ───────────────────────────────────────────────────
async function syncSource(
  name: string,
  fetchFn: (config: Config) => TaskData[] | Promise<TaskData[]>,
  externalIdField: "things3_uuid" | "asana_gid",
  config: Config,
  opts: { useOllama?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  console.log(`Syncing from ${name}...`);

  const createdUdas = ensureUdas();
  if (createdUdas.length > 0) {
    console.log(`  Created missing UDAs: ${createdUdas.join(", ")}`);
  }

  let tasks: TaskData[];
  try {
    tasks = await fetchFn(config);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  Error reading ${name}: ${msg}`);
    return;
  }

  console.log(`  Fetched ${tasks.length} tasks from ${name}`);

  // Capture all fetched external IDs BEFORE Ollama filtering for stale detection
  const fetchedExternalIds = new Set<string>();
  for (const t of tasks) {
    const extId = t[externalIdField];
    if (extId) fetchedExternalIds.add(extId);
  }

  // Optionally filter through Ollama
  let filteredOut = 0;
  if (opts.useOllama) {
    const ollamaCfg = config.ollama;
    if (ollamaCfg.enabled) {
      console.log(`  Filtering through Ollama (${ollamaCfg.model})...`);
      try {
        const result = await filterTasks(tasks, {
          model: ollamaCfg.model,
          baseUrl: ollamaCfg.base_url,
        });
        tasks = result.included;
        filteredOut = result.excluded.length;
        for (const t of result.excluded) {
          console.log(`    skip: ${t.description}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  Ollama error: ${msg}`);
        console.log("  Importing all tasks without filtering.");
      }
    }
  }

  if (opts.dryRun) {
    for (const taskData of tasks) {
      const prefix = taskData.parentAsanaGid ? "  subtask" : "  task";
      console.log(`  [dry-run] Would sync${prefix}: "${taskData.description}"`);
      if (taskData.parentAsanaGid) {
        console.log(`    [dry-run] Would link subtask "${taskData.description}" to parent "${taskData.parentAsanaGid}"`);
      }
    }
    console.log(`  ${name}: ${tasks.length} tasks would be synced`);
  } else {
    const counts: Record<UpsertAction, number> = {
      created: 0,
      updated: 0,
      skipped: 0,
    };

    // Map asana GID → taskwarrior UUID for dependency linking
    const gidToUuid = new Map<string, string>();

    for (const taskData of tasks) {
      const externalId = taskData[externalIdField];
      if (!externalId) continue;
      const [action, uuid] = upsertTask(externalIdField, externalId, taskData);
      counts[action]++;
      if (uuid) {
        gidToUuid.set(externalId, uuid);
      }
    }

    // Link subtasks to their parents via depends:
    let linkedCount = 0;
    for (const taskData of tasks) {
      if (!taskData.parentAsanaGid) continue;
      const childGid = taskData[externalIdField];
      if (!childGid) continue;
      const childUuid = gidToUuid.get(childGid);
      const parentUuid = gidToUuid.get(taskData.parentAsanaGid);
      if (childUuid && parentUuid) {
        try {
          setDependency(childUuid, parentUuid);
          linkedCount++;
        } catch {
          // Non-fatal: continue without linking
        }
      }
    }
    if (linkedCount > 0) {
      console.log(`  Linked ${linkedCount} subtasks to their parents`);
    }

    let summary =
      `  ${name}: ${counts.created} new, ` +
      `${counts.updated} updated, ` +
      `${counts.skipped} unchanged`;
    if (filteredOut) {
      summary += `, ${filteredOut} filtered out by LLM`;
    }
    console.log(summary);
  }

  // ── Stale task detection ──────────────────────────────────────────
  const twTasks = findAllPendingBySource(externalIdField);
  let staleCount = 0;
  for (const [extId, uuid] of twTasks) {
    if (!fetchedExternalIds.has(extId)) {
      if (opts.dryRun) {
        console.log(`  [dry-run] Would complete stale task: ${extId} (${uuid})`);
      } else {
        try {
          completeTask(uuid);
          console.log(`  Completed stale task: ${extId} (${uuid})`);
        } catch {
          console.error(`  Failed to complete stale task: ${extId} (${uuid})`);
        }
      }
      staleCount++;
    }
  }
  if (staleCount > 0) {
    console.log(`  ${staleCount} stale tasks ${opts.dryRun ? "would be " : ""}completed`);
  }
}

// ─── dry-run push helpers ─────────────────────────────────────────
function dryRunPushThings(): void {
  console.log("Checking completions for Things 3...");
  const completed = findCompletedThingsTasks();
  let count = 0;
  for (const task of completed) {
    if (!isAlreadySyncedToThings(task.uuid)) {
      console.log(`  [dry-run] Would complete in Things 3: "${task.description}"`);
      count++;
    }
  }
  console.log(`  ${count} tasks would be completed in Things 3`);
}

function dryRunPushAsana(): void {
  console.log("Checking completions for Asana...");
  const completed = findCompletedAsanaTasks();
  let taskCount = 0;
  let subtaskCount = 0;
  for (const task of completed) {
    if (!isAlreadySyncedToAsana(task.uuid)) {
      const kind = task.asana_parent_gid ? "subtask" : "task";
      console.log(`  [dry-run] Would complete ${kind} in Asana: "${task.description}"`);
      if (task.asana_parent_gid) {
        subtaskCount++;
      } else {
        taskCount++;
      }
    }
  }
  const total = taskCount + subtaskCount;
  console.log(`  ${total} would be completed in Asana (${taskCount} tasks, ${subtaskCount} subtasks)`);
}

// ─── things ────────────────────────────────────────────────────────
program
  .command("things")
  .description("Import tasks from Things 3")
  .action(async () => {
    const dryRun = program.opts().dryRun as boolean | undefined;
    const config = loadConfig();
    if (!config.things.enabled) {
      console.log("Things 3 sync is disabled in config.");
      return;
    }
    await syncSource("Things 3", fetchThingsTasks, "things3_uuid", config, {
      useOllama: true,
      dryRun,
    });
  });

// ─── asana ─────────────────────────────────────────────────────────
program
  .command("asana")
  .description("Import tasks from Asana")
  .action(async () => {
    const dryRun = program.opts().dryRun as boolean | undefined;
    const config = loadConfig();
    await syncSource("Asana", fetchAsanaTasks, "asana_gid", config, {
      dryRun,
    });
  });

// ─── all ───────────────────────────────────────────────────────────
program
  .command("all")
  .description("Import tasks from both Things 3 and Asana")
  .action(async () => {
    const dryRun = program.opts().dryRun as boolean | undefined;
    const config = loadConfig();

    if (config.things.enabled) {
      await syncSource("Things 3", fetchThingsTasks, "things3_uuid", config, {
        useOllama: true,
        dryRun,
      });
    } else {
      console.log("Things 3 sync is disabled in config, skipping.");
    }

    const token = config.asana.personal_access_token;
    if (token && token !== "YOUR_TOKEN_HERE") {
      await syncSource("Asana", fetchAsanaTasks, "asana_gid", config, {
        dryRun,
      });
    } else {
      console.log("Asana not configured, skipping.");
    }
  });

// ─── push ──────────────────────────────────────────────────────────
program
  .command("push")
  .description("Push completed tasks back to Things 3 and Asana")
  .action(async () => {
    const dryRun = program.opts().dryRun as boolean | undefined;
    const config = loadConfig();

    // Push to Things 3
    if (config.things.enabled) {
      if (dryRun) {
        dryRunPushThings();
      } else {
        console.log("Syncing completions back to Things 3...");
        const { synced, skipped } = syncCompletionsToThings();
        console.log(`  Completed ${synced} tasks in Things 3 (${skipped} already synced)`);
      }
    }

    // Push to Asana
    const token = config.asana.personal_access_token;
    if (token && token !== "YOUR_TOKEN_HERE") {
      if (dryRun) {
        dryRunPushAsana();
      } else {
        console.log("Syncing completions back to Asana...");
        const { synced, skipped, errors } = await syncCompletionsToAsana();
        let msg = `  Completed ${synced} tasks in Asana (${skipped} already synced)`;
        if (errors > 0) msg += `, ${errors} errors`;
        console.log(msg);
      }
    }
  });

// ─── push-things ───────────────────────────────────────────────────
program
  .command("push-things")
  .description("Push completed tasks back to Things 3 only")
  .action(async () => {
    const dryRun = program.opts().dryRun as boolean | undefined;
    if (dryRun) {
      dryRunPushThings();
    } else {
      console.log("Syncing completions back to Things 3...");
      const { synced, skipped } = syncCompletionsToThings();
      console.log(`  Completed ${synced} tasks in Things 3 (${skipped} already synced)`);
    }
  });

// ─── push-asana ────────────────────────────────────────────────────
program
  .command("push-asana")
  .description("Push completed tasks back to Asana only")
  .action(async () => {
    const dryRun = program.opts().dryRun as boolean | undefined;
    if (dryRun) {
      dryRunPushAsana();
    } else {
      console.log("Syncing completions back to Asana...");
      const { synced, skipped, errors } = await syncCompletionsToAsana();
      let msg = `  Completed ${synced} tasks in Asana (${skipped} already synced)`;
      if (errors > 0) msg += `, ${errors} errors`;
      console.log(msg);
    }
  });

// ─── sync ──────────────────────────────────────────────────────────
program
  .command("sync")
  .description("Full bi-directional sync: pull from Things 3 & Asana, push completions back")
  .action(async () => {
    const dryRun = program.opts().dryRun as boolean | undefined;
    const config = loadConfig();

    // Pull from Things
    if (config.things.enabled) {
      await syncSource("Things 3", fetchThingsTasks, "things3_uuid", config, {
        useOllama: true,
        dryRun,
      });
    }

    // Pull from Asana
    const token = config.asana.personal_access_token;
    if (token && token !== "YOUR_TOKEN_HERE") {
      await syncSource("Asana", fetchAsanaTasks, "asana_gid", config, {
        dryRun,
      });
    }

    // Push completions back to Things
    if (config.things.enabled) {
      if (dryRun) {
        dryRunPushThings();
      } else {
        console.log("\nSyncing completions back to Things 3...");
        const { synced, skipped } = syncCompletionsToThings();
        console.log(`  Completed ${synced} tasks in Things 3 (${skipped} already synced)`);
      }
    }

    // Push completions back to Asana
    if (token && token !== "YOUR_TOKEN_HERE") {
      if (dryRun) {
        dryRunPushAsana();
      } else {
        console.log("\nSyncing completions back to Asana...");
        const { synced, skipped, errors } = await syncCompletionsToAsana();
        let msg = `  Completed ${synced} tasks in Asana (${skipped} already synced)`;
        if (errors > 0) msg += `, ${errors} errors`;
        console.log(msg);
      }
    }
  });

// ─── install-hook ──────────────────────────────────────────────────
program
  .command("install-hook")
  .description("Install Taskwarrior hook for automatic Things 3 sync on completion")
  .action(() => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const taskHooksDir = join(homeDir, ".task", "hooks");
    const hookName = "on-exit-things-sync";
    const hookDest = join(taskHooksDir, hookName);
    
    // Get the source hook path (relative to this file)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const tsRoot = dirname(__dirname); // Go up from src/ to ts/
    const hookSrc = join(tsRoot, "hooks", hookName);
    
    // Create hooks directory if needed
    if (!existsSync(taskHooksDir)) {
      mkdirSync(taskHooksDir, { recursive: true });
      console.log(`Created ${taskHooksDir}`);
    }
    
    // Remove existing hook if present
    if (existsSync(hookDest)) {
      unlinkSync(hookDest);
      console.log(`Removed existing hook at ${hookDest}`);
    }
    
    // Create symlink
    symlinkSync(hookSrc, hookDest);
    console.log(`Installed hook: ${hookDest} -> ${hookSrc}`);
    console.log("\n✓ Hook installed! Tasks completed in Taskwarrior will now auto-sync to Things 3.");
  });

// ─── uninstall-hook ────────────────────────────────────────────────
program
  .command("uninstall-hook")
  .description("Remove the Taskwarrior hook")
  .action(() => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const hookPath = join(homeDir, ".task", "hooks", "on-exit-things-sync");
    
    if (existsSync(hookPath)) {
      unlinkSync(hookPath);
      console.log(`Removed hook: ${hookPath}`);
    } else {
      console.log("Hook not installed.");
    }
  });

program.parse();
