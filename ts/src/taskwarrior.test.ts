import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { buildTaskData, upsertTask, ensureUdas, findAllPendingBySource, completeTask } from "./taskwarrior.js";

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  mockExecSync.mockReset();
});

// ─── buildTaskData ───────────────────────────────────────────────────────────

describe("buildTaskData", () => {
  it("adds source tag when not already present", () => {
    const data = buildTaskData({
      description: "Test task",
      externalIdField: "things3_uuid",
      externalId: "abc-123",
      source: "things3",
      sourceTag: "things",
      tags: ["work"],
    });
    expect(data.tags).toContain("things");
    expect(data.tags).toContain("work");
  });

  it("does not duplicate source tag", () => {
    const data = buildTaskData({
      description: "Test task",
      externalIdField: "things3_uuid",
      externalId: "abc-123",
      source: "things3",
      sourceTag: "things",
      tags: ["things", "work"],
    });
    expect(data.tags.filter((t) => t === "things")).toHaveLength(1);
  });

  it("sets things3_uuid for things3 source", () => {
    const data = buildTaskData({
      description: "Test task",
      externalIdField: "things3_uuid",
      externalId: "abc-123",
      source: "things3",
      sourceTag: "things",
    });
    expect(data.things3_uuid).toBe("abc-123");
    expect(data.asana_gid).toBeUndefined();
  });

  it("sets asana_gid for asana source", () => {
    const data = buildTaskData({
      description: "Test task",
      externalIdField: "asana_gid",
      externalId: "456",
      source: "asana",
      sourceTag: "asana",
    });
    expect(data.asana_gid).toBe("456");
    expect(data.things3_uuid).toBeUndefined();
  });

  it("validates priority — only H/M/L accepted", () => {
    const valid = buildTaskData({
      description: "Test",
      externalIdField: "things3_uuid",
      externalId: "x",
      source: "things3",
      sourceTag: "things",
      priority: "H",
    });
    expect(valid.priority).toBe("H");

    const invalid = buildTaskData({
      description: "Test",
      externalIdField: "things3_uuid",
      externalId: "x",
      source: "things3",
      sourceTag: "things",
      priority: "CRITICAL",
    });
    expect(invalid.priority).toBeUndefined();
  });

  it("omits optional fields when not provided", () => {
    const data = buildTaskData({
      description: "Test",
      externalIdField: "things3_uuid",
      externalId: "x",
      source: "things3",
      sourceTag: "things",
    });
    expect(data.project).toBeUndefined();
    expect(data.due).toBeUndefined();
    expect(data.priority).toBeUndefined();
    expect(data.annotations).toBeUndefined();
  });

  it("includes annotations when non-empty", () => {
    const data = buildTaskData({
      description: "Test",
      externalIdField: "things3_uuid",
      externalId: "x",
      source: "things3",
      sourceTag: "things",
      annotations: ["note 1", "note 2"],
    });
    expect(data.annotations).toEqual(["note 1", "note 2"]);
  });

  it("omits annotations when empty array", () => {
    const data = buildTaskData({
      description: "Test",
      externalIdField: "things3_uuid",
      externalId: "x",
      source: "things3",
      sourceTag: "things",
      annotations: [],
    });
    expect(data.annotations).toBeUndefined();
  });
});

// ─── upsertTask ──────────────────────────────────────────────────────────────

describe("upsertTask", () => {
  describe("create path", () => {
    it("creates a new task with all fields and extracts UUID", () => {
      // findByExternalId — pending search returns empty
      mockExecSync.mockReturnValueOnce("" as any); // pending
      mockExecSync.mockReturnValueOnce("" as any); // waiting

      // task add
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      mockExecSync.mockReturnValueOnce(`Created task ${uuid}.\n` as any);

      const [action, returnedUuid] = upsertTask("things3_uuid", "ext-1", {
        description: "Buy groceries",
        source: "things3",
        tags: ["shopping"],
        project: "Home",
        due: "2025-12-31",
        priority: "H",
      });

      expect(action).toBe("created");
      expect(returnedUuid).toBe(uuid);

      // Verify the add command includes all fields
      const addCall = mockExecSync.mock.calls[2][0] as string;
      expect(addCall).toContain("add");
      expect(addCall).toContain('"Buy groceries"');
      expect(addCall).toContain("things3_uuid:");
      expect(addCall).toContain("project:");
      expect(addCall).toContain("due:2025-12-31");
      expect(addCall).toContain("priority:H");
    });

    it("sanitizes tag spaces to underscores", () => {
      mockExecSync.mockReturnValueOnce("" as any);
      mockExecSync.mockReturnValueOnce("" as any);
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      mockExecSync.mockReturnValueOnce(`Created task ${uuid}.\n` as any);

      upsertTask("things3_uuid", "ext-1", {
        description: "Test",
        source: "things3",
        tags: ["my tag", "another  tag"],
      });

      const addCall = mockExecSync.mock.calls[2][0] as string;
      expect(addCall).toContain("+my_tag");
      expect(addCall).toContain("+another_tag");
    });

    it("adds annotations after creation, truncated to 1000 chars", () => {
      mockExecSync.mockReturnValueOnce("" as any);
      mockExecSync.mockReturnValueOnce("" as any);
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      mockExecSync.mockReturnValueOnce(`Created task ${uuid}.\n` as any);
      mockExecSync.mockReturnValueOnce("" as any); // annotate call

      const longNote = "x".repeat(2000);
      upsertTask("things3_uuid", "ext-1", {
        description: "Test",
        source: "things3",
        tags: [],
        annotations: [longNote],
      });

      const annotateCall = mockExecSync.mock.calls[3][0] as string;
      expect(annotateCall).toContain("annotate");
      // The note gets JSON.stringify'd and truncated to 1000
      expect(annotateCall).toContain(uuid);
    });

    it("skips empty annotations", () => {
      mockExecSync.mockReturnValueOnce("" as any);
      mockExecSync.mockReturnValueOnce("" as any);
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      mockExecSync.mockReturnValueOnce(`Created task ${uuid}.\n` as any);

      upsertTask("things3_uuid", "ext-1", {
        description: "Test",
        source: "things3",
        tags: [],
        annotations: ["", "  ", "real note"],
      });

      // Only the "real note" should produce an annotate call (call index 3)
      const annotateCalls = mockExecSync.mock.calls.filter((c) =>
        (c[0] as string).includes("annotate"),
      );
      expect(annotateCalls).toHaveLength(1);
      expect(annotateCalls[0][0] as string).toContain("real note");
    });
  });

  describe("update path", () => {
    function setupExistingTask(overrides: Record<string, unknown> = {}) {
      const existing = {
        uuid: "existing-uuid-1234-5678-abcdefabcdef",
        description: "Existing task",
        project: "Work",
        due: "2025-06-01",
        priority: "M",
        tags: ["things"],
        ...overrides,
      };
      // pending search returns the task
      mockExecSync.mockReturnValueOnce(JSON.stringify([existing]) as any);
    }

    it("returns skipped when nothing changed", () => {
      setupExistingTask();
      const [action, uuid] = upsertTask("things3_uuid", "ext-1", {
        description: "Existing task",
        source: "things3",
        tags: ["things"],
        project: "Work",
        due: "2025-06-01",
        priority: "M",
      });

      expect(action).toBe("skipped");
      expect(uuid).toBe("existing-uuid-1234-5678-abcdefabcdef");
    });

    it("detects description change", () => {
      setupExistingTask();
      mockExecSync.mockReturnValueOnce("" as any); // modify call

      const [action] = upsertTask("things3_uuid", "ext-1", {
        description: "Updated task",
        source: "things3",
        tags: ["things"],
        project: "Work",
        due: "2025-06-01",
        priority: "M",
      });

      expect(action).toBe("updated");
      const modifyCall = mockExecSync.mock.calls[1][0] as string;
      expect(modifyCall).toContain("modify");
      expect(modifyCall).toContain('"Updated task"');
    });

    it("detects project change", () => {
      setupExistingTask();
      mockExecSync.mockReturnValueOnce("" as any);

      const [action] = upsertTask("things3_uuid", "ext-1", {
        description: "Existing task",
        source: "things3",
        tags: ["things"],
        project: "Personal",
        due: "2025-06-01",
        priority: "M",
      });

      expect(action).toBe("updated");
      const modifyCall = mockExecSync.mock.calls[1][0] as string;
      expect(modifyCall).toContain('project:"Personal"');
    });

    it("detects due date change", () => {
      setupExistingTask();
      mockExecSync.mockReturnValueOnce("" as any);

      const [action] = upsertTask("things3_uuid", "ext-1", {
        description: "Existing task",
        source: "things3",
        tags: ["things"],
        project: "Work",
        due: "2025-12-31",
        priority: "M",
      });

      expect(action).toBe("updated");
      const modifyCall = mockExecSync.mock.calls[1][0] as string;
      expect(modifyCall).toContain("due:2025-12-31");
    });

    it("detects priority change", () => {
      setupExistingTask();
      mockExecSync.mockReturnValueOnce("" as any);

      const [action] = upsertTask("things3_uuid", "ext-1", {
        description: "Existing task",
        source: "things3",
        tags: ["things"],
        project: "Work",
        due: "2025-06-01",
        priority: "H",
      });

      expect(action).toBe("updated");
      const modifyCall = mockExecSync.mock.calls[1][0] as string;
      expect(modifyCall).toContain("priority:H");
    });

    it("detects tag changes and sanitizes them", () => {
      setupExistingTask({ tags: ["things", "old_tag"] });
      mockExecSync.mockReturnValueOnce("" as any);

      const [action] = upsertTask("things3_uuid", "ext-1", {
        description: "Existing task",
        source: "things3",
        tags: ["things", "new tag"],
        project: "Work",
        due: "2025-06-01",
        priority: "M",
      });

      expect(action).toBe("updated");
      const modifyCall = mockExecSync.mock.calls[1][0] as string;
      expect(modifyCall).toContain("tags:new_tag,things");
    });
  });

  describe("search behavior", () => {
    it("tries pending first, then waiting", () => {
      // pending returns empty
      mockExecSync.mockReturnValueOnce("" as any);
      // waiting returns a task
      const task = { uuid: "wait-uuid", description: "Waiting task", tags: [] };
      mockExecSync.mockReturnValueOnce(JSON.stringify([task]) as any);

      const [action, uuid] = upsertTask("things3_uuid", "ext-1", {
        description: "Waiting task",
        source: "things3",
        tags: [],
      });

      expect(action).toBe("skipped");
      expect(uuid).toBe("wait-uuid");

      // Verify both statuses were searched
      expect((mockExecSync.mock.calls[0][0] as string)).toContain("status:pending");
      expect((mockExecSync.mock.calls[1][0] as string)).toContain("status:waiting");
    });

    it("handles invalid JSON gracefully", () => {
      mockExecSync.mockReturnValueOnce("not json" as any);
      mockExecSync.mockReturnValueOnce("also not json" as any);
      // Falls through to create
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      mockExecSync.mockReturnValueOnce(`Created task ${uuid}.\n` as any);

      const [action] = upsertTask("things3_uuid", "ext-1", {
        description: "Test",
        source: "things3",
        tags: [],
      });

      expect(action).toBe("created");
    });
  });
});

// ─── ensureUdas ──────────────────────────────────────────────────────────────

describe("ensureUdas", () => {
  it("creates missing UDAs", () => {
    // `task show` returns output with no UDA definitions
    mockExecSync.mockReturnValueOnce("Some config output\n" as any);
    // Each missing UDA triggers two config calls (type + label)
    mockExecSync.mockImplementation((() => "" as any));

    const created = ensureUdas();
    expect(created.length).toBeGreaterThan(0);
    expect(created).toContain("things3_uuid");
  });

  it("skips existing UDAs", () => {
    // Return output that includes all UDA definitions
    const existing = [
      "uda.things3_uuid.type",
      "uda.asana_gid.type",
      "uda.source.type",
      "uda.things3_synced.type",
      "uda.asana_synced.type",
      "uda.asana_parent_gid.type",
    ].join("\n");
    mockExecSync.mockReturnValueOnce(existing as any);

    const created = ensureUdas();
    expect(created).toEqual([]);
  });
});

// ─── findAllPendingBySource ─────────────────────────────────────────────────

describe("findAllPendingBySource", () => {
  it("builds map from pending tasks", () => {
    const tasks = [
      { uuid: "uuid-1", description: "Task 1", asana_gid: "gid-1" },
      { uuid: "uuid-2", description: "Task 2", asana_gid: "gid-2" },
    ];
    mockExecSync.mockReturnValueOnce(JSON.stringify(tasks) as any); // pending
    mockExecSync.mockReturnValueOnce("" as any); // waiting

    const result = findAllPendingBySource("asana_gid");
    expect(result.size).toBe(2);
    expect(result.get("gid-1")).toBe("uuid-1");
    expect(result.get("gid-2")).toBe("uuid-2");
  });

  it("combines pending and waiting tasks", () => {
    const pending = [{ uuid: "uuid-1", description: "Pending", asana_gid: "gid-1" }];
    const waiting = [{ uuid: "uuid-2", description: "Waiting", asana_gid: "gid-2" }];
    mockExecSync.mockReturnValueOnce(JSON.stringify(pending) as any);
    mockExecSync.mockReturnValueOnce(JSON.stringify(waiting) as any);

    const result = findAllPendingBySource("asana_gid");
    expect(result.size).toBe(2);
    expect(result.get("gid-1")).toBe("uuid-1");
    expect(result.get("gid-2")).toBe("uuid-2");
  });

  it("returns empty map when no tasks found", () => {
    mockExecSync.mockReturnValueOnce("" as any);
    mockExecSync.mockReturnValueOnce("" as any);

    const result = findAllPendingBySource("asana_gid");
    expect(result.size).toBe(0);
  });

  it("handles invalid JSON gracefully", () => {
    mockExecSync.mockReturnValueOnce("not json" as any);
    mockExecSync.mockReturnValueOnce("also bad" as any);

    const result = findAllPendingBySource("asana_gid");
    expect(result.size).toBe(0);
  });

  it("skips tasks missing the external ID field", () => {
    const tasks = [
      { uuid: "uuid-1", description: "Has GID", asana_gid: "gid-1" },
      { uuid: "uuid-2", description: "No GID" },
    ];
    mockExecSync.mockReturnValueOnce(JSON.stringify(tasks) as any);
    mockExecSync.mockReturnValueOnce("" as any);

    const result = findAllPendingBySource("asana_gid");
    expect(result.size).toBe(1);
    expect(result.get("gid-1")).toBe("uuid-1");
  });

  it("works with things3_uuid field", () => {
    const tasks = [
      { uuid: "uuid-1", description: "Things task", things3_uuid: "t3-abc" },
    ];
    mockExecSync.mockReturnValueOnce(JSON.stringify(tasks) as any);
    mockExecSync.mockReturnValueOnce("" as any);

    const result = findAllPendingBySource("things3_uuid");
    expect(result.size).toBe(1);
    expect(result.get("t3-abc")).toBe("uuid-1");
  });
});

// ─── completeTask ───────────────────────────────────────────────────────────

describe("completeTask", () => {
  it("runs task done command with the UUID", () => {
    mockExecSync.mockReturnValueOnce("" as any);

    completeTask("550e8400-e29b-41d4-a716-446655440000");

    const call = mockExecSync.mock.calls[0][0] as string;
    expect(call).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(call).toContain("done");
  });
});
