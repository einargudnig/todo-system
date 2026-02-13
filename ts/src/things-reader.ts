/**
 * Read tasks from Things 3 via its SQLite database.
 *
 * Things 3 stores its data in:
 *   ~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/
 *     Things Database.thingsdatabase/main.sqlite
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { buildTaskData } from "./taskwarrior.js";
import type { Config, TaskData } from "./types.js";

const THINGS_DB_PATH = join(
  homedir(),
  "Library",
  "Group Containers",
  "JLMPQHK86H.com.culturedcode.ThingsMac",
  "Things Database.thingsdatabase",
  "main.sqlite",
);

interface ThingsRow {
  uuid: string;
  title: string;
  notes: string | null;
  deadline: string | null;
  project_title: string | null;
  area_title: string | null;
  tags: string | null;
}

/**
 * Query incomplete todos from the Things 3 SQLite database.
 * This mirrors what things.py does internally.
 */
function queryThingsTodos(areaFilter: string[]): ThingsRow[] {
  if (!existsSync(THINGS_DB_PATH)) {
    throw new Error(
      `Things 3 database not found at ${THINGS_DB_PATH}. ` +
        "Is Things 3 installed on this Mac?",
    );
  }

  const db = new Database(THINGS_DB_PATH, { readonly: true });

  try {
    // TMTask.status: 0 = incomplete, 3 = completed, 2 = cancelled
    // TMTask.trashed: 0 = not trashed
    // TMTask.type: 0 = todo, 1 = project, 2 = heading
    const rows = db
      .prepare(
        `
      SELECT
        t.uuid,
        t.title,
        t.notes,
        CASE WHEN t.deadline IS NOT NULL
          THEN date(t.deadline, 'unixepoch', '+31 years')
          ELSE NULL
        END AS deadline,
        p.title AS project_title,
        a.title AS area_title,
        GROUP_CONCAT(tag.title, '|||') AS tags
      FROM TMTask t
      LEFT JOIN TMTask p ON t.project = p.uuid
      LEFT JOIN TMArea a ON COALESCE(t.area, p.area) = a.uuid
      LEFT JOIN TMTaskTag tt ON t.uuid = tt.tasks
      LEFT JOIN TMTag tag ON tt.tags = tag.uuid
      WHERE t.status = 0
        AND t.trashed = 0
        AND t.type = 0
      GROUP BY t.uuid
      ORDER BY t.todayIndex
    `,
      )
      .all() as ThingsRow[];

    // Apply area filter if set
    if (areaFilter.length > 0) {
      return rows.filter(
        (r) => r.area_title && areaFilter.includes(r.area_title),
      );
    }

    return rows;
  } finally {
    db.close();
  }
}

export function fetchThingsTasks(config: Config): TaskData[] {
  const thingsCfg = config.things;
  const syncCfg = config.sync;
  const sourceTag = syncCfg.things_tag;
  const areaFilter = thingsCfg.areas ?? [];

  const rows = queryThingsTodos(areaFilter);
  const result: TaskData[] = [];

  for (const row of rows) {
    // Resolve project name: prefer project, fall back to area
    const project = row.project_title ?? row.area_title ?? undefined;

    // Parse tags (joined with |||)
    const tags = row.tags ? row.tags.split("|||").filter(Boolean) : [];

    // Build annotations from notes
    const annotations: string[] = [];
    if (row.notes) annotations.push(row.notes);

    const taskData = buildTaskData({
      description: row.title,
      externalIdField: "things3_uuid",
      externalId: row.uuid,
      source: "things3",
      sourceTag,
      project,
      due: row.deadline ?? undefined,
      tags,
      annotations,
    });

    result.push(taskData);
  }

  return result;
}
