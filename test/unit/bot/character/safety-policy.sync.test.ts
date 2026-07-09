import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SAFETY_HOTLINES, SAFETY_POLICY_PROMPT_JP } from "../../../../src/bot/character/safety-policy.js";

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
});
