import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDaysOverride } from "../../../src/bridge/cli.js";

describe("parseDaysOverride", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no --days argument is given", () => {
    expect(parseDaysOverride(undefined)).toBeUndefined();
  });

  it("parses a valid --days=N argument", () => {
    expect(parseDaysOverride("--days=31")).toBe(31);
  });

  it("exits with an error on a non-positive-integer value", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseDaysOverride("--days=abc")).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
