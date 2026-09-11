import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildCrisisListeningModePrompt,
  SAFETY_HOTLINES,
  SAFETY_POLICY_PROMPT_JP,
} from "../../../../src/bot/character/safety-policy.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("SAFETY_POLICY_PROMPT_JP stays in sync with AGENTS.md", () => {
  const agentsMd = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");

  it("AGENTS.md still contains the mandated hotline numbers (source of truth check)", () => {
    expect(agentsMd).toContain(SAFETY_HOTLINES.yorisoi);
    expect(agentsMd).toContain(SAFETY_HOTLINES.inochiNavi);
    expect(agentsMd).toContain(SAFETY_HOTLINES.inochiFree);
  });

  it("the hardcoded system-prompt excerpt includes every hotline number", () => {
    expect(SAFETY_POLICY_PROMPT_JP).toContain(SAFETY_HOTLINES.yorisoi);
    expect(SAFETY_POLICY_PROMPT_JP).toContain(SAFETY_HOTLINES.inochiNavi);
    expect(SAFETY_POLICY_PROMPT_JP).toContain(SAFETY_HOTLINES.inochiFree);
    expect(SAFETY_POLICY_PROMPT_JP).toContain(SAFETY_HOTLINES.emergencyAmbulance);
    expect(SAFETY_POLICY_PROMPT_JP).toContain(SAFETY_HOTLINES.emergencyPolice);
  });

  it("both AGENTS.md and the excerpt describe the per-user hotline preference (default enabled, listening-first when disabled)", () => {
    // AGENTS.md側の強調（**）は取り除いて比較する
    for (const text of [agentsMd.replaceAll("**", ""), SAFETY_POLICY_PROMPT_JP]) {
      expect(text).toContain("相談窓口案内");
      expect(text).toContain("既定は有効");
      expect(text).toContain("傾聴と相談を最優先");
      expect(text).toContain("明示的に意思表示した場合のみ");
    }
  });

  it("the listening-mode prompt never lists the hotline numbers proactively but keeps 119/110", () => {
    const prompt = buildCrisisListeningModePrompt(["死にたい"]);
    expect(prompt).toContain("死にたい");
    expect(prompt).not.toContain(SAFETY_HOTLINES.yorisoi);
    expect(prompt).not.toContain(SAFETY_HOTLINES.inochiNavi);
    expect(prompt).toContain(SAFETY_HOTLINES.emergencyAmbulance);
    expect(prompt).toContain(SAFETY_HOTLINES.emergencyPolice);
  });
});
