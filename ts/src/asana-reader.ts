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

const SUBTASK_OPT_FIELDS = "gid,name,completed,due_on,notes";
const STORY_OPT_FIELDS = "text,created_by,created_by.name,type,created_at";

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
  const storiesApi = new asana.StoriesApi(client);

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
  const allSubtasks: TaskData[] = [];

  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i];

    // Skip if somehow completed (shouldn't happen with completed_since: 'now')
    if (t.completed) continue;

    // Log progress every 10 tasks
    if (i % 10 === 0) {
      console.log(`  Fetching details for task ${i + 1}/${rawTasks.length}...`);
    }

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

    // Fetch comments (stories) for this task
    try {
      const storiesResponse = await storiesApi.getStoriesForTask(t.gid, {
        opt_fields: STORY_OPT_FIELDS,
      });
      const stories = storiesResponse.data ?? [];
      for (const story of stories) {
        if (story.type === "comment" && story.text) {
          const author = story.created_by?.name ?? "Unknown";
          const commentText = `[${author}] ${story.text}`.slice(0, 1000);
          annotations.push(commentText);
        }
      }
    } catch {
      // Non-fatal: continue without comments
    }

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

    // Fetch subtasks for this task
    try {
      const subtasksResponse = await tasksApi.getSubtasksForTask(t.gid, {
        opt_fields: SUBTASK_OPT_FIELDS,
      });
      const subtasks = subtasksResponse.data ?? [];
      for (const sub of subtasks) {
        if (sub.completed) continue;

        const subTaskData = buildTaskData({
          description: sub.name,
          externalIdField: "asana_gid",
          externalId: sub.gid,
          source: "asana",
          sourceTag,
          project: projectName,
          due: sub.due_on ?? undefined,
          tags,
          annotations: sub.notes ? [sub.notes] : undefined,
        });
        subTaskData.parentAsanaGid = t.gid;
        allSubtasks.push(subTaskData);
      }
    } catch {
      // Non-fatal: continue without subtasks
    }
  }

  return [...result, ...allSubtasks];
}
