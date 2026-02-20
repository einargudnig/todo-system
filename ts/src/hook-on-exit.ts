#!/usr/bin/env npx tsx
/**
 * Taskwarrior on-exit hook for syncing completions to Things 3 and Asana.
 *
 * This hook runs after any task modification. If a task with a things3_uuid
 * or asana_gid is marked as completed, it will complete it in the source.
 *
 * Install: symlink to ~/.task/hooks/on-exit-sync
 */

import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";
import { completeInAsana, markAsSyncedToAsana } from "./asana-writer.js";

interface TaskwarriorTask {
  uuid: string;
  status: string;
  things3_uuid?: string;
  things3_synced?: string;
  asana_gid?: string;
  asana_synced?: string;
  description: string;
}

function completeInThings(thingsUuid: string, authToken: string): void {
  const url = `things:///update?auth-token=${encodeURIComponent(authToken)}&id=${encodeURIComponent(thingsUuid)}&completed=true`;
  execSync(`open -g "${url}"`, { stdio: 'pipe' });
}

function markAsSyncedToThings(taskUuid: string): void {
  execSync(
    `task rc.confirmation=off rc.hooks=off ${taskUuid} modify things3_synced:true`,
    { stdio: 'pipe' }
  );
}

async function main() {
  // Load config
  let thingsAuthToken = "";
  let asanaConfigured = false;
  try {
    const config = loadConfig();
    thingsAuthToken = config.things.auth_token || "";
    const asanaToken = config.asana?.personal_access_token || "";
    asanaConfigured = !!asanaToken && asanaToken !== "YOUR_TOKEN_HERE";
  } catch {
    // Config not found, skip syncing
    process.exit(0);
  }

  if (!thingsAuthToken && !asanaConfigured) {
    // Nothing configured, skip silently
    process.exit(0);
  }

  // Read all input from stdin (Taskwarrior sends JSON lines)
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8');

  // Parse each line as a separate JSON task
  const lines = input.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const task: TaskwarriorTask = JSON.parse(line);

      // Things 3: complete if task has a Things UUID
      if (
        thingsAuthToken &&
        task.status === 'completed' &&
        task.things3_uuid &&
        task.things3_synced !== 'true'
      ) {
        completeInThings(task.things3_uuid, thingsAuthToken);
        markAsSyncedToThings(task.uuid);
        console.error(`✓ Completed in Things 3: ${task.description}`);
      }

      // Asana: complete if task has an Asana GID
      if (
        asanaConfigured &&
        task.status === 'completed' &&
        task.asana_gid &&
        task.asana_synced !== 'true'
      ) {
        try {
          await completeInAsana(task.asana_gid);
          markAsSyncedToAsana(task.uuid);
          console.error(`✓ Completed in Asana: ${task.description}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`✗ Failed to complete in Asana: ${task.description} (${msg})`);
        }
      }
    } catch {
      // Ignore parse errors for non-JSON lines
    }
  }

  // Exit successfully
  process.exit(0);
}

main();
