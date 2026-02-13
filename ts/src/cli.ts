#!/usr/bin/env node

/** CLI entry point for todo-sync (TypeScript version). */

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, configExists, createDefaultConfig } from "./config.js";
import { ensureUdas, upsertTask } from "./taskwarrior.js";
import { fetchThingsTasks } from "./things-reader.js";
import { fetchAsanaTasks } from "./asana-reader.js";
import { filterTasks } from "./ollama-filter.js";
import type { Config, TaskData, UpsertAction } from "./types.js";

const program = new Command();

program
  .name("todo-sync-ts")
  .description("One-way sync from Things 3 and Asana into Taskwarrior.")
  .version("0.1.0");

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
  opts: { useOllama?: boolean } = {},
): Promise<void> {
  console.log(`Syncing from ${name}...`);

  let tasks: TaskData[];
  try {
    tasks = await fetchFn(config);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  Error reading ${name}: ${msg}`);
    return;
  }

  console.log(`  Fetched ${tasks.length} tasks from ${name}`);

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

  const counts: Record<UpsertAction, number> = {
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (const taskData of tasks) {
    const externalId = taskData[externalIdField];
    if (!externalId) continue;
    const [action] = upsertTask(externalIdField, externalId, taskData);
    counts[action]++;
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

// ─── things ────────────────────────────────────────────────────────
program
  .command("things")
  .description("Import tasks from Things 3")
  .action(async () => {
    const config = loadConfig();
    if (!config.things.enabled) {
      console.log("Things 3 sync is disabled in config.");
      return;
    }
    await syncSource("Things 3", fetchThingsTasks, "things3_uuid", config, {
      useOllama: true,
    });
  });

// ─── asana ─────────────────────────────────────────────────────────
program
  .command("asana")
  .description("Import tasks from Asana")
  .action(async () => {
    const config = loadConfig();
    await syncSource("Asana", fetchAsanaTasks, "asana_gid", config);
  });

// ─── all ───────────────────────────────────────────────────────────
program
  .command("all")
  .description("Import tasks from both Things 3 and Asana")
  .action(async () => {
    const config = loadConfig();

    if (config.things.enabled) {
      await syncSource("Things 3", fetchThingsTasks, "things3_uuid", config, {
        useOllama: true,
      });
    } else {
      console.log("Things 3 sync is disabled in config, skipping.");
    }

    const token = config.asana.personal_access_token;
    if (token && token !== "YOUR_TOKEN_HERE") {
      await syncSource("Asana", fetchAsanaTasks, "asana_gid", config);
    } else {
      console.log("Asana not configured, skipping.");
    }
  });

program.parse();
