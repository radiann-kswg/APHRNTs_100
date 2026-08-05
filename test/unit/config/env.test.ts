import { describe, expect, it } from "vitest";
import { loadEnv } from "../../../src/config/env.js";

describe("loadEnv", () => {
  it("uses sensible defaults when nothing is set", () => {
    const env = loadEnv({});
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.DB_PATH).toBe(".cache/session.db");
    expect(env.RATE_LIMIT_GLOBAL_PER_HOUR).toBe(30);
    expect(env.WEEKLY_SUMMARY_DAY_OF_WEEK).toBe(0);
    expect(env.WEEKLY_SUMMARY_HOUR).toBe(20);
    expect(env.DAILY_REFLECTION_HOUR).toBe(20);
    expect(env.DAILY_MORNING_REMINDER_HOUR).toBe(8);
    expect(env.TREND_NUDGE_HOUR).toBe(21);
    expect(env.MED_REMINDER_HOUR).toBe(18);
    expect(env.BOT_DIGEST_DAYS).toBe(14);
    expect(env.GCE_PROJECT).toBe("numbertales-misskey-surver");
    expect(env.GCE_ZONE).toBe("us-central1-a");
    expect(env.GCE_INSTANCE).toBe("misskey-bots-unified");
    expect(env.REMOTE_BOT_DIGEST_PATH).toBe("/opt/aphrnts-100/logs/bot-digest.md");
  });

  it("coerces numeric env vars from strings", () => {
    const env = loadEnv({
      RATE_LIMIT_REPLY_COOLDOWN_MS: "5000",
      WEEKLY_SUMMARY_HOUR: "9",
      DAILY_REFLECTION_HOUR: "21",
      DAILY_MORNING_REMINDER_HOUR: "7",
      BOT_DIGEST_DAYS: "31",
    });
    expect(env.RATE_LIMIT_REPLY_COOLDOWN_MS).toBe(5000);
    expect(env.WEEKLY_SUMMARY_HOUR).toBe(9);
    expect(env.DAILY_REFLECTION_HOUR).toBe(21);
    expect(env.DAILY_MORNING_REMINDER_HOUR).toBe(7);
    expect(env.BOT_DIGEST_DAYS).toBe(31);
  });

  it("treats an empty DAILY_MORNING_REMINDER_HOUR as disabled", () => {
    const env = loadEnv({ DAILY_MORNING_REMINDER_HOUR: "" });
    expect(env.DAILY_MORNING_REMINDER_HOUR).toBeNull();
  });

  it("rejects an invalid AI_PROVIDER", () => {
    expect(() => loadEnv({ AI_PROVIDER: "invalid" })).toThrow();
  });
});
