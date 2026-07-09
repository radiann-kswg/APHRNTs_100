import { describe, expect, it } from "vitest";
import { buildClaudeNotesSection } from "../../../src/bridge/notes-section.js";

const baseRow = { source_path: "logs/2026-07-09.md", imported_at: "2026-07-09T00:00:00.000Z" };

describe("buildClaudeNotesSection", () => {
  it("returns undefined when there are no rows", () => {
    expect(buildClaudeNotesSection([])).toBeUndefined();
  });

  it("renders one section per date", () => {
    const section = buildClaudeNotesSection([
      { ...baseRow, date: "2026-07-08", content: "記録A" },
      { ...baseRow, date: "2026-07-09", content: "記録B" },
    ]);
    expect(section).toContain("### 2026-07-08");
    expect(section).toContain("記録A");
    expect(section).toContain("### 2026-07-09");
    expect(section).toContain("記録B");
  });

  it("truncates overly long notes", () => {
    const section = buildClaudeNotesSection([{ ...baseRow, date: "2026-07-09", content: "あ".repeat(50) }], 10);
    expect(section).toContain("…（以降省略）");
    expect(section).not.toContain("あ".repeat(50));
  });
});
