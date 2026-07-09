import { describe, expect, it } from "vitest";
import { shouldRunDailyNow } from "../../../src/scheduler/schedule-utils.js";

describe("shouldRunDailyNow", () => {
  it("returns false when the hour does not match", () => {
    const now = new Date("2026-01-05T20:00:00");
    expect(shouldRunDailyNow(null, now, now.getHours() + 1)).toBe(false);
  });

  it("returns true on the first run within the matching hour", () => {
    const now = new Date("2026-01-05T20:00:00");
    expect(shouldRunDailyNow(null, now, now.getHours())).toBe(true);
  });

  it("returns false if already run within the last 20 hours", () => {
    const now = new Date("2026-01-05T20:00:00");
    const lastRunAt = new Date(now.getTime() - 60 * 60 * 1000);
    expect(shouldRunDailyNow(lastRunAt, now, now.getHours())).toBe(false);
  });

  it("returns true if the last run was more than 20 hours ago", () => {
    const now = new Date("2026-01-05T20:00:00");
    const lastRunAt = new Date(now.getTime() - 21 * 60 * 60 * 1000);
    expect(shouldRunDailyNow(lastRunAt, now, now.getHours())).toBe(true);
  });
});
