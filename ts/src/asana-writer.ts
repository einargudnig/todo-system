/**
 * Write task completions back to Asana via the API.
 */

import { execSync } from "node:child_process";
import * as asana from "asana";
import { loadConfig } from "./config.js";

interface CompletedTask {
  uuid: string;
  asana_gid: string;
  description: string;
  end: string;
}

/**
 * Find tasks in Taskwarrior that are completed and have an asana_gid.
 */
export function findCompletedAsanaTasks(): CompletedTask[] {
  try {
    const output = execSync(
      'task status:completed asana_gid.not: export',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    if (!output.trim()) return [];
    
    const tasks = JSON.parse(output) as Array<{
      uuid: string;
      asana_gid?: string;
      description: string;
      end?: string;
    }>;
    
    return tasks
      .filter((t): t is CompletedTask & { asana_gid: string } => 
        !!t.asana_gid && !!t.end
      )
      .map(t => ({
        uuid: t.uuid,
        asana_gid: t.asana_gid,
        description: t.description,
        end: t.end,
      }));
  } catch {
    return [];
  }
}

/**
 * Mark a task as complete in Asana using the API.
 */
export async function completeInAsana(asanaGid: string): Promise<void> {
  const config = loadConfig();
  const token = config.asana.personal_access_token;
  
  if (!token || token === "YOUR_TOKEN_HERE") {
    throw new Error("Asana token not configured");
  }

  const client = new asana.ApiClient();
  client.authentications["token"].accessToken = token;
  
  const tasksApi = new asana.TasksApi(client);
  
  await tasksApi.updateTask(asanaGid, {
    data: { completed: true }
  });
}

/**
 * Track which tasks we've already synced back to Asana.
 * We use a Taskwarrior UDA to avoid re-syncing.
 */
export function markAsSyncedToAsana(taskUuid: string): void {
  execSync(
    `task rc.confirmation=off ${taskUuid} modify asana_synced:true`,
    { stdio: 'pipe' }
  );
}

/**
 * Check if a task has already been synced back to Asana.
 */
export function isAlreadySyncedToAsana(taskUuid: string): boolean {
  try {
    const output = execSync(
      `task ${taskUuid} export`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const tasks = JSON.parse(output);
    return tasks[0]?.asana_synced === 'true';
  } catch {
    return false;
  }
}

/**
 * Sync completed tasks from Taskwarrior back to Asana.
 * Returns count of tasks synced.
 */
export async function syncCompletionsToAsana(): Promise<{ synced: number; skipped: number; errors: number }> {
  const completed = findCompletedAsanaTasks();
  let synced = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const task of completed) {
    if (isAlreadySyncedToAsana(task.uuid)) {
      skipped++;
      continue;
    }
    
    try {
      console.log(`  Completing in Asana: ${task.description}`);
      await completeInAsana(task.asana_gid);
      markAsSyncedToAsana(task.uuid);
      synced++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  Error completing "${task.description}": ${msg}`);
      errors++;
    }
  }
  
  return { synced, skipped, errors };
}
