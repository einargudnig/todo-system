/** Filter tasks through a local Ollama LLM to decide what belongs in Taskwarrior. */

import type { TaskData } from "./types.js";

const PROMPT_TEMPLATE = `\
You are a strict task classifier. You decide if a task belongs in a software \
developer's terminal-based task manager (Taskwarrior).

ONLY answer "yes" for tasks that are done ON A COMPUTER:
- Coding, debugging, code review, pull requests
- Writing documents, emails, spreadsheets
- System admin, deployments, server work
- Digital design, technical research, online learning

Answer "no" for ANYTHING physical or away from a computer:
- Shopping, groceries, buying things in stores
- Chores: cleaning, laundry, cooking, dishes
- Appointments: doctor, dentist, haircut, mechanic
- Exercise, sports, outdoor activities
- Errands: post office, bank, picking things up
- Social: parties, dinners, meetups

When in doubt, answer "no".

Answer with ONLY "yes" or "no".

Task: {title}
{notes_section}`;

export async function classifyTask(
  title: string,
  notes: string = "",
  opts: { model?: string; baseUrl?: string } = {},
): Promise<boolean> {
  const model = opts.model ?? "lfm2.5-thinking";
  const baseUrl = opts.baseUrl ?? "http://localhost:11434";

  const notesSection = notes ? `Notes: ${notes}\n` : "";
  const prompt = PROMPT_TEMPLATE.replace("{title}", title).replace(
    "{notes_section}",
    notesSection,
  );

  const payload = {
    model,
    prompt,
    stream: false,
    options: { temperature: 0.0 },
  };

  let body: { response?: string };
  try {
    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    body = (await resp.json()) as { response?: string };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot reach Ollama at ${baseUrl}: ${msg}`);
  }

  let answer = (body.response ?? "").trim().toLowerCase();
  // Strip any thinking tags the model might produce
  if (answer.includes("</think>")) {
    answer = answer.split("</think>").pop()!.trim();
  }
  return answer.startsWith("yes");
}

export async function filterTasks(
  tasks: TaskData[],
  opts: { model?: string; baseUrl?: string } = {},
): Promise<{ included: TaskData[]; excluded: TaskData[] }> {
  const included: TaskData[] = [];
  const excluded: TaskData[] = [];

  for (const task of tasks) {
    const title = task.description;
    const annotations = task.annotations ?? [];
    const notes = annotations[0] ?? "";

    const keep = await classifyTask(title, notes, opts);
    if (keep) {
      included.push(task);
    } else {
      excluded.push(task);
    }
  }

  return { included, excluded };
}
