/** Read tasks from Asana via the official Node.js SDK. */

import asana from "asana";
import type { AsanaClient } from "asana";
import { buildTaskData } from "./taskwarrior.js";
import type { Config, TaskData } from "./types.js";

const OPT_FIELDS =
  "gid,name,completed,due_on,tags,tags.name,projects,projects.name,notes";

async function getWorkspaceGid(
  client: AsanaClient,
  configured: string,
): Promise<string> {
  if (configured) return configured;

  const workspacesResponse = await client.workspaces.getWorkspaces();
  const workspaces = workspacesResponse.data ?? [];

  if (workspaces.length === 0) {
    throw new Error("No Asana workspaces found for this account.");
  }
  if (workspaces.length > 1) {
    const names = workspaces.map((w: { name?: string }) => w.name).join(", ");
    throw new Error(
      `Multiple workspaces found (${names}). ` +
        "Set 'workspace' in your config to pick one.",
    );
  }
  return workspaces[0].gid;
}

export async function fetchAsanaTasks(config: Config): Promise<TaskData[]> {
  const asanaCfg = config.asana;
  const syncCfg = config.sync;
  const sourceTag = syncCfg.asana_tag;

  const token = asanaCfg.personal_access_token;
  if (!token || token === "YOUR_TOKEN_HERE") {
    throw new Error(
      "Asana personal access token not configured. " +
        "Run 'todo-sync-ts setup' or edit ~/.config/todo-sync/config.toml",
    );
  }

  const client = asana.Client.create().useAccessToken(token);
  const workspaceGid = await getWorkspaceGid(
    client,
    asanaCfg.workspace ?? "",
  );

  // Get user's task list
  const userTaskList = await client.userTaskLists.getUserTaskListForUser("me", {
    workspace: workspaceGid,
  });

  // Fetch tasks
  const tasksResponse = await client.tasks.getTasksForUserTaskList(
    userTaskList.gid,
    { opt_fields: OPT_FIELDS },
  );
  const rawTasks = tasksResponse.data ?? [];

  const result: TaskData[] = [];

  for (const t of rawTasks) {
    // Skip completed tasks
    if (t.completed) continue;

    // Collect tag names
    const tags: string[] = [];
    if (t.tags) {
      for (const tag of t.tags) {
        if (tag.name) tags.push(tag.name);
      }
    }

    // Get first project name
    let projectName: string | undefined;
    if (t.projects) {
      for (const p of t.projects) {
        if (p.name) {
          projectName = p.name;
          break;
        }
      }
    }

    // Build annotations from notes
    const annotations: string[] = [];
    if (t.notes) annotations.push(t.notes);

    const taskData = buildTaskData({
      description: t.name,
      externalIdField: "asana_gid",
      externalId: t.gid,
      source: "asana",
      sourceTag,
      project: projectName,
      due: t.due_on ?? undefined,
      tags,
      annotations,
    });

    result.push(taskData);
  }

  return result;
}
