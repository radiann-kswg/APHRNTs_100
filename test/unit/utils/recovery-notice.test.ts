import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRecoveryMessage,
  evaluateDowntimeMs,
  formatDowntimeJa,
  notifyRecoveryIfLongDowntime,
  readPreviousHeartbeatTs,
} from "../../../src/utils/recovery-notice.js";

const THRESHOLD_10MIN = 10 * 60 * 1000;

describe("readPreviousHeartbeatTs", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "recovery-notice-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads ts from a valid heartbeat.json", () => {
    const path = join(dir, "heartbeat.json");
    writeFileSync(path, JSON.stringify({ ts: "2026-07-20T00:00:00.000Z", wsConnected: true }));
    expect(readPreviousHeartbeatTs(path)?.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("returns null when the file does not exist", () => {
    expect(readPreviousHeartbeatTs(join(dir, "missing.json"))).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    const path = join(dir, "heartbeat.json");
    writeFileSync(path, "{not json");
    expect(readPreviousHeartbeatTs(path)).toBeNull();
  });

  it("returns null when ts is missing or not a date string", () => {
    const path = join(dir, "heartbeat.json");
    writeFileSync(path, JSON.stringify({ wsConnected: true }));
    expect(readPreviousHeartbeatTs(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ ts: "not-a-date" }));
    expect(readPreviousHeartbeatTs(path)).toBeNull();
  });
});

describe("evaluateDowntimeMs", () => {
  const now = new Date("2026-07-20T12:00:00Z");

  it("returns downtime when the gap is at or above the threshold", () => {
    const prev = new Date("2026-07-20T11:45:00Z"); // 15分前
    expect(evaluateDowntimeMs(prev, now, THRESHOLD_10MIN)).toBe(15 * 60 * 1000);
  });

  it("returns null when the gap is below the threshold (e.g. layer-2 watchdog restart)", () => {
    const prev = new Date("2026-07-20T11:59:00Z"); // 1分前
    expect(evaluateDowntimeMs(prev, now, THRESHOLD_10MIN)).toBeNull();
  });

  it("returns null when there is no previous heartbeat (first boot)", () => {
    expect(evaluateDowntimeMs(null, now, THRESHOLD_10MIN)).toBeNull();
  });

  it("returns null when the feature is disabled (threshold <= 0)", () => {
    const prev = new Date("2026-07-20T00:00:00Z");
    expect(evaluateDowntimeMs(prev, now, 0)).toBeNull();
  });
});

describe("formatDowntimeJa", () => {
  it("formats minutes", () => {
    expect(formatDowntimeJa(15 * 60 * 1000)).toBe("約15分");
  });

  it("never shows 0 minutes", () => {
    expect(formatDowntimeJa(10 * 1000)).toBe("約1分");
  });

  it("formats exact hours without a minutes part", () => {
    expect(formatDowntimeJa(2 * 60 * 60 * 1000)).toBe("約2時間");
  });

  it("formats hours and minutes", () => {
    expect(formatDowntimeJa((60 + 25) * 60 * 1000)).toBe("約1時間25分");
  });
});

describe("buildRecoveryMessage", () => {
  it("includes the downtime duration", () => {
    expect(buildRecoveryMessage(30 * 60 * 1000)).toContain("約30分");
  });
});

describe("notifyRecoveryIfLongDowntime", () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const logger = { info: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    logger.info.mockClear();
    logger.warn.mockClear();
  });

  it("sends a chat message to the owner after a long downtime", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sent = await notifyRecoveryIfLongDowntime({
      previousTs: new Date("2026-07-20T11:00:00Z"),
      thresholdMs: THRESHOLD_10MIN,
      ownerUserId: "owner1",
      sendChatMessage: send,
      logger,
      now,
    });
    expect(sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("owner1", expect.stringContaining("約1時間"));
  });

  it("does nothing when downtime is below the threshold", async () => {
    const send = vi.fn();
    const sent = await notifyRecoveryIfLongDowntime({
      previousTs: new Date("2026-07-20T11:59:30Z"),
      thresholdMs: THRESHOLD_10MIN,
      ownerUserId: "owner1",
      sendChatMessage: send,
      logger,
      now,
    });
    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips (with a log) when owner id is not configured", async () => {
    const send = vi.fn();
    const sent = await notifyRecoveryIfLongDowntime({
      previousTs: new Date("2026-07-20T11:00:00Z"),
      thresholdMs: THRESHOLD_10MIN,
      ownerUserId: "",
      sendChatMessage: send,
      logger,
      now,
    });
    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("does not throw when sending fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network down"));
    const sent = await notifyRecoveryIfLongDowntime({
      previousTs: new Date("2026-07-20T11:00:00Z"),
      thresholdMs: THRESHOLD_10MIN,
      ownerUserId: "owner1",
      sendChatMessage: send,
      logger,
      now,
    });
    expect(sent).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});
