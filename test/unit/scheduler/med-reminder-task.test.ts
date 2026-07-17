import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { MisskeyClient } from "../../../src/misskey/client.js";
import { createMedicationReminderTask } from "../../../src/scheduler/med-reminder-task.js";
import { BotStateStore } from "../../../src/storage/bot-state-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { MedicationStore } from "../../../src/storage/medication-store.js";
import { SessionStore } from "../../../src/storage/session-store.js";
import { toJstDateString } from "../../../src/utils/date.js";

function createFakeMisskeyClient(): { client: MisskeyClient; messages: { toUserId: string; text: string }[] } {
  const messages: { toUserId: string; text: string }[] = [];
  const client = {
    sendChatMessage: async (toUserId: string, text: string) => {
      messages.push({ toUserId, text });
    },
  } as unknown as MisskeyClient;
  return { client, messages };
}

// 18:00 JST（タスクの時刻ゲートはホストのローカル時間で判定するため、ローカル時刻で生成する）
const AT_18 = new Date("2026-07-17T18:10:00");
// タスクは記録日をJST基準で引くため、テスト側も同じ変換で「その日」を求める（ホストTZに依存しない）
const TODAY_JST = toJstDateString(AT_18);

describe("createMedicationReminderTask", () => {
  let db: Database;
  let botStateStore: BotStateStore;
  let sessionStore: SessionStore;
  let medicationStore: MedicationStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    botStateStore = new BotStateStore(db);
    sessionStore = new SessionStore(db);
    medicationStore = new MedicationStore(db);
  });

  function createTask(ownerUserId?: string) {
    const fake = createFakeMisskeyClient();
    const task = createMedicationReminderTask({
      botStateStore,
      sessionStore,
      medicationStore,
      misskeyClient: fake.client,
      hour: 18,
      ownerUserId,
    });
    return { task, ...fake };
  }

  it("does nothing outside the configured hour", async () => {
    sessionStore.appendExchange("owner1", "hi", "yo", AT_18);
    const { task, messages } = createTask("owner1");

    await task.run(new Date("2026-07-17T09:00:00"));

    expect(messages).toHaveLength(0);
  });

  it("sends a reminder to the owner when tonight's dose is unrecorded", async () => {
    const { task, messages } = createTask("owner1");

    await task.run(AT_18);

    expect(messages).toHaveLength(1);
    expect(messages[0].toUserId).toBe("owner1");
    expect(messages[0].text).toContain("夜");
  });

  it("also reminds when the dose was explicitly reported as not taken", async () => {
    medicationStore.upsert({ userId: "owner1", date: TODAY_JST, nightTaken: false }, AT_18);
    const { task, messages } = createTask("owner1");

    await task.run(AT_18);

    expect(messages).toHaveLength(1);
  });

  it("skips users whose night dose is already recorded as taken", async () => {
    medicationStore.upsert({ userId: "owner1", date: TODAY_JST, nightTaken: true }, AT_18);
    const { task, messages } = createTask("owner1");

    await task.run(AT_18);

    expect(messages).toHaveLength(0);
  });

  it("falls back to all known users when no owner is configured", async () => {
    sessionStore.appendExchange("user1", "hi", "yo", AT_18);
    sessionStore.appendExchange("user2", "hi", "yo", AT_18);
    medicationStore.upsert({ userId: "user2", date: TODAY_JST, nightTaken: true }, AT_18);
    const { task, messages } = createTask();

    await task.run(AT_18);

    expect(messages.map((m) => m.toUserId)).toEqual(["user1"]);
  });

  it("does not refire within the cooldown window", async () => {
    const { task, messages } = createTask("owner1");

    await task.run(AT_18);
    await task.run(new Date(AT_18.getTime() + 30 * 60 * 1000));

    expect(messages).toHaveLength(1);
  });
});
