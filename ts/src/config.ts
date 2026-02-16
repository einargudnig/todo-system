/** Load and manage configuration from ~/.config/todo-sync/config.toml. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseToml } from "smol-toml";
import type { Config } from "./types.js";

const CONFIG_DIR = join(homedir(), ".config", "todo-sync");
const CONFIG_PATH = join(CONFIG_DIR, "config.toml");

function defaults(): Config {
  return {
    asana: { personal_access_token: "", workspace: "" },
    things: { enabled: true, auth_token: "", areas: [] },
    sync: { things_tag: "things3", asana_tag: "asana" },
    ollama: {
      enabled: true,
      model: "lfm2.5-thinking",
      base_url: "http://localhost:11434",
    },
  };
}

export function loadConfig(): Config {
  const cfg = defaults();

  if (!existsSync(CONFIG_PATH)) {
    return cfg;
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const userCfg = parseToml(raw) as Record<string, Record<string, unknown>>;

  for (const section of Object.keys(cfg) as (keyof Config)[]) {
    if (userCfg[section]) {
      Object.assign(cfg[section], userCfg[section]);
    }
  }

  return cfg;
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function createDefaultConfig(asanaToken: string = ""): string {
  mkdirSync(CONFIG_DIR, { recursive: true });

  const content = `[asana]
personal_access_token = "${asanaToken}"
# workspace = ""

[things]
enabled = true
# areas = []

[sync]
things_tag = "things3"
asana_tag = "asana"

[ollama]
enabled = true
model = "lfm2.5-thinking"
# base_url = "http://localhost:11434"
`;

  writeFileSync(CONFIG_PATH, content, "utf-8");
  return CONFIG_PATH;
}
