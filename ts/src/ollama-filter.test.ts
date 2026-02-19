import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyTask, filterTasks } from "./ollama-filter.js";

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockOllamaResponse(response: string) {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ response }),
  });
}

// ─── classifyTask ────────────────────────────────────────────────────────────

describe("classifyTask", () => {
  it('returns true for "yes"', async () => {
    mockOllamaResponse("yes");
    expect(await classifyTask("Write code")).toBe(true);
  });

  it('returns false for "no"', async () => {
    mockOllamaResponse("no");
    expect(await classifyTask("Buy milk")).toBe(false);
  });

  it("is case insensitive", async () => {
    mockOllamaResponse("Yes");
    expect(await classifyTask("Deploy server")).toBe(true);
  });

  it('handles "yes" with trailing text', async () => {
    mockOllamaResponse("yes, this is a computer task");
    expect(await classifyTask("Code review")).toBe(true);
  });

  it("strips </think> tags and uses text after last one", async () => {
    mockOllamaResponse(
      "<think>Let me think about this...</think>thinking more</think>yes",
    );
    expect(await classifyTask("Debug issue")).toBe(true);
  });

  it("returns false for empty response", async () => {
    mockOllamaResponse("");
    expect(await classifyTask("Something")).toBe(false);
  });

  it("returns false for undefined response", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({}),
    });
    expect(await classifyTask("Something")).toBe(false);
  });

  it("constructs correct prompt with title and notes", async () => {
    mockOllamaResponse("yes");
    await classifyTask("Fix bug", "In the auth module");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toContain("Fix bug");
    expect(body.prompt).toContain("Notes: In the auth module");
  });

  it("constructs prompt without notes section when notes empty", async () => {
    mockOllamaResponse("yes");
    await classifyTask("Fix bug");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toContain("Fix bug");
    expect(body.prompt).not.toContain("Notes:");
  });

  it("uses custom model and baseUrl when provided", async () => {
    mockOllamaResponse("yes");
    await classifyTask("Test", "", {
      model: "llama3",
      baseUrl: "http://remote:11434",
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://remote:11434/api/generate");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("llama3");
  });

  it("throws descriptive error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(classifyTask("Test")).rejects.toThrow(
      /Cannot reach Ollama.*Connection refused/,
    );
  });
});

// ─── filterTasks ─────────────────────────────────────────────────────────────

describe("filterTasks", () => {
  it("splits tasks into included and excluded", async () => {
    mockOllamaResponse("yes");
    mockOllamaResponse("no");
    mockOllamaResponse("yes");

    const tasks = [
      { description: "Write code", source: "things3", tags: [] },
      { description: "Buy groceries", source: "things3", tags: [] },
      { description: "Deploy app", source: "things3", tags: [] },
    ];

    const { included, excluded } = await filterTasks(tasks);
    expect(included).toHaveLength(2);
    expect(excluded).toHaveLength(1);
    expect(included[0].description).toBe("Write code");
    expect(included[1].description).toBe("Deploy app");
    expect(excluded[0].description).toBe("Buy groceries");
  });

  it("passes first annotation as notes", async () => {
    mockOllamaResponse("yes");

    await filterTasks([
      {
        description: "Fix bug",
        source: "things3",
        tags: [],
        annotations: ["Check auth module", "Second note"],
      },
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toContain("Notes: Check auth module");
  });

  it("handles empty task array", async () => {
    const { included, excluded } = await filterTasks([]);
    expect(included).toEqual([]);
    expect(excluded).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
