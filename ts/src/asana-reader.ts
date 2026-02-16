/** Read tasks from Asana via the official Node.js SDK (v3). */

import * as asana from "asana";
import { buildTaskData } from "./taskwarrior.js";
import type { Config, TaskData } from "./types.js";

const OPT_FIELDS = [
  "gid",
  "name",
  "completed",
  "due_on",
  "tags",
  "tags.name",
  "projects",
  "projects.name",
  "notes",
];

async function getWorkspaceGid(
  workspacesApi: asana.WorkspacesApi,
  configured: string,
): Promise<string> {
  if (configured) return configured;

  const response = await workspacesApi.getWorkspaces({});
  const workspaces = response.data ?? [];

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

  // Set up the API client with authentication
  const client = new asana.ApiClient();
  client.authentications["token"].accessToken = token;

  const workspacesApi = new asana.WorkspacesApi(client);
  const userTaskListsApi = new asana.UserTaskListsApi(client);
  const tasksApi = new asana.TasksApi(client);

  const workspaceGid = await getWorkspaceGid(
    workspacesApi,
    asanaCfg.workspace ?? "",
  );

  // Get user's task list
  const userTaskList = await userTaskListsApi.getUserTaskListForUser(
    "me",
    workspaceGid,
  );

  // Fetch tasks from the user's task list (only incomplete tasks)
  const rawTasks: Array<{
    gid: string;
    name: string;
    completed: boolean;
    due_on: string | null;
    tags: Array<{ name?: string }> | null;
    projects: Array<{ name?: string }> | null;
    notes: string | null;
  }> = [];

  let offset: string | undefined;
  do {
    const opts: Record<string, unknown> = {
      opt_fields: OPT_FIELDS.join(","),
      limit: 100,
      completed_since: "now", // Only incomplete tasks
    };
    if (offset) opts.offset = offset;

    const tasksResponse = await tasksApi.getTasksForUserTaskList(
      userTaskList.data.gid,
      opts,
    );
    rawTasks.push(...(tasksResponse.data ?? []));
    offset = tasksResponse._response?.next_page?.offset;
  } while (offset);

  const result: TaskData[] = [];

  for (const t of rawTasks) {
    // Skip if somehow completed (shouldn't happen with completed_since: 'now')
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
