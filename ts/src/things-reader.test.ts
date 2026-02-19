import { describe, it, expect } from "vitest";
import { transformThingsRows } from "./things-reader.js";

describe("transformThingsRows", () => {
  const SOURCE_TAG = "things";

  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      uuid: "row-uuid-1",
      title: "Test task",
      notes: null as string | null,
      deadline: null as string | null,
      project_title: null as string | null,
      area_title: null as string | null,
      tags: null as string | null,
      ...overrides,
    };
  }

  it("splits tags on |||", () => {
    const rows = [makeRow({ tags: "work|||urgent|||personal" })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.tags).toContain("work");
    expect(task.tags).toContain("urgent");
    expect(task.tags).toContain("personal");
    expect(task.tags).toContain(SOURCE_TAG);
  });

  it("handles null tags", () => {
    const rows = [makeRow({ tags: null })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    // Should only have the source tag
    expect(task.tags).toEqual([SOURCE_TAG]);
  });

  it("handles empty tags string", () => {
    const rows = [makeRow({ tags: "" })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.tags).toEqual([SOURCE_TAG]);
  });

  it("uses project_title as project", () => {
    const rows = [makeRow({ project_title: "My Project", area_title: "Work" })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.project).toBe("My Project");
  });

  it("falls back to area_title when project_title is null", () => {
    const rows = [makeRow({ project_title: null, area_title: "Work" })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.project).toBe("Work");
  });

  it("omits project when both project_title and area_title are null", () => {
    const rows = [makeRow({ project_title: null, area_title: null })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.project).toBeUndefined();
  });

  it("passes deadline as due date", () => {
    const rows = [makeRow({ deadline: "2025-12-31" })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.due).toBe("2025-12-31");
  });

  it("omits due when deadline is null", () => {
    const rows = [makeRow({ deadline: null })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.due).toBeUndefined();
  });

  it("adds notes as annotation", () => {
    const rows = [makeRow({ notes: "Some important notes" })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.annotations).toEqual(["Some important notes"]);
  });

  it("omits annotations when notes is null", () => {
    const rows = [makeRow({ notes: null })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.annotations).toBeUndefined();
  });

  it("sets source to things3 and adds source tag", () => {
    const rows = [makeRow()];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.source).toBe("things3");
    expect(task.tags).toContain(SOURCE_TAG);
  });

  it("sets things3_uuid from row uuid", () => {
    const rows = [makeRow({ uuid: "my-uuid-123" })];
    const [task] = transformThingsRows(rows, SOURCE_TAG);
    expect(task.things3_uuid).toBe("my-uuid-123");
  });
});
