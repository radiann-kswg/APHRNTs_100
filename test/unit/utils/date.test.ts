import { describe, expect, it } from "vitest";
import {
  formatJstDateWithWeekday,
  shiftJstDateString,
  toJstDateString,
} from "../../../src/utils/date.js";

describe("toJstDateString", () => {
  it("returns the UTC calendar date when it is still before the JST midnight boundary", () => {
    expect(toJstDateString(new Date("2026-07-10T14:59:59Z"))).toBe("2026-07-10");
  });

  it("rolls over to the next JST calendar date exactly at the JST midnight boundary", () => {
    expect(toJstDateString(new Date("2026-07-10T15:00:00Z"))).toBe("2026-07-11");
  });

  it("resolves late-evening JST correctly, not the UTC previous day (the reported bug)", () => {
    // UTC 2026-07-11T20:00:00Z = JST 2026-07-12T05:00:00 — early morning of the next JST day.
    expect(toJstDateString(new Date("2026-07-11T20:00:00Z"))).toBe("2026-07-12");
  });
});

describe("formatJstDateWithWeekday", () => {
  it("formats the date with its JST weekday", () => {
    // JST 2026-01-01T00:00:00 = UTC 2025-12-31T15:00:00Z. 2026-01-01 is a Thursday.
    expect(formatJstDateWithWeekday(new Date("2025-12-31T15:00:00Z"))).toBe("2026-01-01(木)");
  });
});

describe("shiftJstDateString", () => {
  it("shifts within the same month", () => {
    expect(shiftJstDateString("2026-07-11", 1)).toBe("2026-07-12");
    expect(shiftJstDateString("2026-07-11", -1)).toBe("2026-07-10");
  });

  it("rolls over month boundaries", () => {
    expect(shiftJstDateString("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("rolls over year boundaries in both directions", () => {
    expect(shiftJstDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftJstDateString("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap-year and non-leap-year February correctly", () => {
    expect(shiftJstDateString("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftJstDateString("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("handles multi-day shifts spanning month and year", () => {
    expect(shiftJstDateString("2026-12-25", 10)).toBe("2027-01-04");
  });
});
