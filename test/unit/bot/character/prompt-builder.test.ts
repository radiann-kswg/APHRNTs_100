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
});
