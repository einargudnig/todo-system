#!/usr/bin/env npx tsx
/**
 * Taskwarrior on-exit hook for syncing completions to Things 3.
 * 
 * This hook runs after any task modification. If a task with a things3_uuid
 * is marked as completed, it will complete it in Things 3 as well.
 * 
 * Install: symlink to ~/.task/hooks/on-exit-things-sync
 */

import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";

interface TaskwarriorTask {
  uuid: string;
  status: string;
  things3_uuid?: string;
  things3_synced?: string;
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
  // Load config to get auth token
  let authToken = "";
  try {
    const config = loadConfig();
    authToken = config.things.auth_token || "";
  } catch {
    // Config not found, skip syncing
    process.exit(0);
  }
  
  if (!authToken) {
    // No auth token configured, skip silently
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
      
      // Check if this is a completed task with a Things UUID that hasn't been synced
      if (
        task.status === 'completed' &&
        task.things3_uuid &&
        task.things3_synced !== 'true'
      ) {
        // Complete in Things 3
        completeInThings(task.things3_uuid, authToken);
        markAsSyncedToThings(task.uuid);
        
        // Output to stderr so user sees it (stdout is reserved for task JSON)
        console.error(`✓ Completed in Things 3: ${task.description}`);
      }
    } catch {
      // Ignore parse errors for non-JSON lines
    }
  }
  
  // Exit successfully
  process.exit(0);
}

main();
