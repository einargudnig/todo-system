/** Taskwarrior integration: UDA setup, task upsert, and duplicate detection. */

import { execSync } from "node:child_process";
import type { TaskData, UpsertAction } from "./types.js";

/** UDAs that must exist in Taskwarrior config for sync to work. */
const REQUIRED_UDAS: Record<string, { type: string; label: string }> = {
  things3_uuid: { type: "string", label: "Things 3 UUID" },
  asana_gid: { type: "string", label: "Asana GID" },
  source: { type: "string", label: "Sync source" },
  things3_synced: { type: "string", label: "Synced back to Things" },
  asana_synced: { type: "string", label: "Synced back to Asana" },
};

function runTaskConfig(key: string, value: string): void {
  execSync(`task rc.confirmation=off config ${key} ${JSON.stringify(value)}`, {
    stdio: "pipe",
  });
}

function runTask(args: string): string {
  try {
    return execSync(`task rc.confirmation=off rc.bulk=0 ${args}`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number };
    // task returns exit code 1 when no results found — that's OK
    if (err.status === 1) return err.stdout ?? "";
    throw e;
  }
}

export function ensureUdas(): string[] {
  const existing = runTask("show");
  const created: string[] = [];

  for (const [name, attrs] of Object.entries(REQUIRED_UDAS)) {
    if (existing.includes(`uda.${name}.type`)) continue;
    runTaskConfig(`uda.${name}.type`, attrs.type);
    runTaskConfig(`uda.${name}.label`, attrs.label);
    created.push(name);
  }

  return created;
}

interface TaskwarriorTask {
  uuid: string;
  description: string;
  [key: string]: unknown;
}

function findByExternalId(
  udaName: string,
  value: string,
): TaskwarriorTask | null {
  // Search pending + waiting tasks by external ID
  for (const status of ["pending", "waiting"]) {
    const raw = runTask(`status:${status} ${udaName}:${value} export`);
    if (!raw.trim()) continue;
    try {
      const tasks: TaskwarriorTask[] = JSON.parse(raw);
      if (tasks.length > 0) return tasks[0];
    } catch {
      continue;
    }
  }
  return null;
}

export function upsertTask(
  externalIdField: string,
  externalId: string,
  taskData: TaskData,
): [UpsertAction, string] {
  const existing = findByExternalId(externalIdField, externalId);
  const annotations = taskData.annotations ?? [];

  if (existing) {
    // Check if anything changed
    let changed = false;
    const updates: string[] = [];

    if (
      taskData.description &&
      taskData.description !== existing.description
    ) {
      updates.push(`description:${JSON.stringify(taskData.description)}`);
      changed = true;
    }
    if (taskData.project && taskData.project !== existing["project"]) {
      updates.push(`project:${JSON.stringify(taskData.project)}`);
      changed = true;
    }
    if (taskData.due && taskData.due !== existing["due"]) {
      updates.push(`due:${taskData.due}`);
      changed = true;
    }
    if (taskData.priority && taskData.priority !== existing["priority"]) {
      updates.push(`priority:${taskData.priority}`);
      changed = true;
    }

    // Check tags
    const existingTags = (existing["tags"] as string[]) ?? [];
    const newTags = (taskData.tags ?? []).map(t => t.replace(/\s+/g, "_"));
    if (JSON.stringify(existingTags.sort()) !== JSON.stringify(newTags.sort())) {
      updates.push(`tags:${newTags.join(",")}`);
      changed = true;
    }

    if (changed) {
      runTask(`${existing.uuid} modify ${updates.join(" ")}`);
      return ["updated", existing.uuid];
    }
    return ["skipped", existing.uuid];
  }

  // Create new task
  const parts: string[] = [
    `description:${JSON.stringify(taskData.description)}`,
    `${externalIdField}:${JSON.stringify(externalId)}`,
    `source:${JSON.stringify(taskData.source)}`,
  ];

  if (taskData.tags && taskData.tags.length > 0) {
    for (const tag of taskData.tags) {
      // Taskwarrior doesn't allow spaces in tags - replace with underscores
      const sanitizedTag = tag.replace(/\s+/g, "_");
      parts.push(`+${sanitizedTag}`);
    }
  }
  if (taskData.project) {
    parts.push(`project:${JSON.stringify(taskData.project)}`);
  }
  if (taskData.due) {
    parts.push(`due:${taskData.due}`);
  }
  if (taskData.priority) {
    parts.push(`priority:${taskData.priority}`);
  }

  const output = runTask(`add ${parts.join(" ")}`);
  // Extract UUID from "Created task <uuid>" output
  const uuidMatch = output.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/,
  );
  const uuid = uuidMatch?.[1] ?? "";

  // Add annotations after creation
  if (uuid) {
    for (const note of annotations) {
      if (note?.trim()) {
        runTask(`${uuid} annotate ${JSON.stringify(note.trim().slice(0, 1000))}`);
      }
    }
  }

  return ["created", uuid];
}

export function buildTaskData(opts: {
  description: string;
  externalIdField: "things3_uuid" | "asana_gid";
  externalId: string;
  source: string;
  sourceTag: string;
  project?: string;
  due?: string;
  tags?: string[];
  priority?: string;
  annotations?: string[];
}): TaskData {
  const tags = [...(opts.tags ?? [])];
  if (!tags.includes(opts.sourceTag)) {
    tags.push(opts.sourceTag);
  }

  const data: TaskData = {
    description: opts.description,
    [opts.externalIdField]: opts.externalId,
    source: opts.source,
    tags,
  };

  if (opts.project) data.project = opts.project;
  if (opts.due) data.due = opts.due;
  if (opts.priority && ["H", "M", "L"].includes(opts.priority)) {
    data.priority = opts.priority as "H" | "M" | "L";
  }
  if (opts.annotations && opts.annotations.length > 0) {
    data.annotations = opts.annotations;
  }

  return data;
}
