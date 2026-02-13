/** Shared types for todo-sync. */

export interface TaskData {
  description: string;
  things3_uuid?: string;
  asana_gid?: string;
  source: string;
  tags: string[];
  project?: string;
  due?: string; // ISO date string YYYY-MM-DD
  priority?: "H" | "M" | "L";
  annotations?: string[];
}

export interface Config {
  asana: {
    personal_access_token: string;
    workspace: string;
  };
  things: {
    enabled: boolean;
    areas: string[];
  };
  sync: {
    things_tag: string;
    asana_tag: string;
  };
  ollama: {
    enabled: boolean;
    model: string;
    base_url: string;
  };
}

export type UpsertAction = "created" | "updated" | "skipped";
