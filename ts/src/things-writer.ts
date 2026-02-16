/**
 * Write task completions back to Things 3 via URL scheme.
 *
 * Things 3 URL scheme: things:///update?auth-token=TOKEN&id=UUID&completed=true
 */

import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";

interface CompletedTask {
  uuid: string;
  things3_uuid: string;
  description: string;
  end: string;
}

/**
 * Find tasks in Taskwarrior that are completed and have a things3_uuid.
 */
export function findCompletedThingsTasks(): CompletedTask[] {
  try {
    const output = execSync(
      'task status:completed things3_uuid.not: export',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    if (!output.trim()) return [];
    
    const tasks = JSON.parse(output) as Array<{
      uuid: string;
      things3_uuid?: string;
      description: string;
      end?: string;
    }>;
    
    return tasks
      .filter((t): t is CompletedTask & { things3_uuid: string } => 
        !!t.things3_uuid && !!t.end
      )
      .map(t => ({
        uuid: t.uuid,
        things3_uuid: t.things3_uuid,
        description: t.description,
        end: t.end,
      }));
  } catch {
    return [];
  }
}

/**
 * Get the Things auth token from config.
 */
export function getThingsAuthToken(): string {
  const config = loadConfig();
  return config.things.auth_token || "";
}

/**
 * Mark a task as complete in Things 3 using URL scheme.
 */
export function completeInThings(thingsUuid: string, authToken?: string): void {
  const token = authToken || getThingsAuthToken();
  if (!token) {
    throw new Error("Things auth token not configured. Add it to ~/.config/todo-sync/config.toml");
  }
  const url = `things:///update?auth-token=${encodeURIComponent(token)}&id=${encodeURIComponent(thingsUuid)}&completed=true`;
  execSync(`open -g "${url}"`, { stdio: 'pipe' });
}

/**
 * Track which tasks we've already synced back to Things.
 * We use a Taskwarrior UDA to avoid re-syncing.
 */
export function markAsSyncedToThings(taskUuid: string): void {
  execSync(
    `task rc.confirmation=off ${taskUuid} modify things3_synced:true`,
    { stdio: 'pipe' }
  );
}

/**
 * Check if a task has already been synced back to Things.
 */
export function isAlreadySyncedToThings(taskUuid: string): boolean {
  try {
    const output = execSync(
      `task ${taskUuid} export`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const tasks = JSON.parse(output);
    return tasks[0]?.things3_synced === 'true';
  } catch {
    return false;
  }
}

/**
 * Sync completed tasks from Taskwarrior back to Things 3.
 * Returns count of tasks synced.
 */
export function syncCompletionsToThings(): { synced: number; skipped: number } {
  const completed = findCompletedThingsTasks();
  let synced = 0;
  let skipped = 0;
  
  for (const task of completed) {
    if (isAlreadySyncedToThings(task.uuid)) {
      skipped++;
      continue;
    }
    
    console.log(`  Completing in Things: ${task.description}`);
    completeInThings(task.things3_uuid);
    markAsSyncedToThings(task.uuid);
    synced++;
    
    // Small delay to not overwhelm Things
    if (synced > 0) {
      execSync('sleep 0.3');
    }
  }
  
  return { synced, skipped };
}
