import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../../../src/bot/character/prompt-builder.js";

describe("buildSystemPrompt", () => {
  it("includes the roleplay prompt, safety policy, and every .cbt-datas file", () => {
    const prompt = buildSystemPrompt({
      roleplayPrompt: "ROLEPLAY_MARKER",
      cbtDatas: [
        { filename: "a.md", content: "CBT_A_MARKER" },
        { filename: "b.md", content: "CBT_B_MARKER" },
      ],
    });

    expect(prompt).toContain("ROLEPLAY_MARKER");
    expect(prompt).toContain("CBT_A_MARKER");
    expect(prompt).toContain("CBT_B_MARKER");
    expect(prompt).toContain("安全指針");
    expect(prompt).toContain("Misskey Bot運用上の注意");
  });

  it("omits the Claude notes section when no notes are provided", () => {
    const prompt = buildSystemPrompt({ roleplayPrompt: "R", cbtDatas: [] });
    expect(prompt).not.toContain("<claude-session-notes>");
  });

  it("appends the Claude notes section with a privacy notice when provided", () => {
    const prompt = buildSystemPrompt(
      { roleplayPrompt: "R", cbtDatas: [] },
      { claudeNotesSection: "### 2026-07-09\n\nNOTES_MARKER" },
    );
    expect(prompt).toContain("<claude-session-notes>");
    expect(prompt).toContain("NOTES_MARKER");
    expect(prompt).toContain("センパイのClaudeセッション記録");
    expect(prompt).toContain("公開投稿で内容の詳細を復唱・言及しないこと");
  });
});
