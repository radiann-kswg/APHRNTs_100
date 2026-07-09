import { describe, expect, it } from "vitest";
import { buildCrisisResponse, checkForCrisis } from "../../../../src/bot/safety/crisis-detector.js";

describe("checkForCrisis", () => {
  it("detects direct suicidal ideation phrases", () => {
    const result = checkForCrisis("最近死にたいって思うことがある");
    expect(result.triggered).toBe(true);
    expect(result.matchedTerms).toContain("死にたい");
  });

  it("detects self-harm related phrases", () => {
    const result = checkForCrisis("リストカットしてしまった");
    expect(result.triggered).toBe(true);
  });

  it("does not trigger on benign hyperbole containing 死ぬ", () => {
    const result = checkForCrisis("今日は死ぬほど眠い");
    expect(result.triggered).toBe(false);
  });

  it("does not trigger on unrelated text", () => {
    const result = checkForCrisis("創作の進捗について話したい");
    expect(result.triggered).toBe(false);
  });
});

describe("buildCrisisResponse", () => {
  it("includes all mandated hotline numbers verbatim", () => {
    const response = buildCrisisResponse();
    expect(response).toContain("0120-279-338");
    expect(response).toContain("0570-783-556");
    expect(response).toContain("0120-783-556");
    expect(response).toContain("119");
    expect(response).toContain("110");
  });
});
