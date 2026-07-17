import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  importMedicationFromLogs,
  parseMedicationLog,
} from "../../../src/bridge/medication-importer.js";
import { openDatabase } from "../../../src/storage/db.js";
import { MedicationStore } from "../../../src/storage/medication-store.js";

const NOW = new Date("2026-07-17T12:00:00+09:00");

function medicationSection(lines: string[]): string {
  return ["# 2026-07-17（金）", "", "## 服薬", "", ...lines, "", "## 体調・気分", "", "気分: 8/10"].join("\n");
}

describe("parseMedicationLog", () => {
  it("reads checked slots as taken", () => {
    const parsed = parseMedicationLog(
      medicationSection(["- 朝🌄: [x] 済 ／", "- 日中☀️: [ ] 済 ／", "- 夜🌙: [X] 済 ／"]),
    );
    expect(parsed).toEqual({ morningTaken: true, nightTaken: true });
  });

  it("ignores unchecked boxes and missing slots (template placeholders stay untouched)", () => {
    const parsed = parseMedicationLog(
      medicationSection(["- 朝🌄: [ ] 済 ／", "- 日中☀️: [ ] 済 ／", "- 食後🍽: [ ] 済 ／", "- 夜🌙: [ ] 済 ／"]),
    );
    expect(parsed).toEqual({});
  });

  it("returns empty when the medication section is absent", () => {
    expect(parseMedicationLog("# 2026-07-17\n\n## 体調・気分\n\n気分: 8/10")).toEqual({});
  });

  it("reads PRN notes and extracts a count when present", () => {
    const parsed = parseMedicationLog(medicationSection(["- 発作時⚡: → 2回 頭痛でカロナール"]));
    expect(parsed).toEqual({ prnCount: 2, prnNotes: "2回 頭痛でカロナール" });
  });

  it("reads PRN notes without a count", () => {
    const parsed = parseMedicationLog(medicationSection(["- 発作時⚡: 不安時に頓服"]));
    expect(parsed).toEqual({ prnNotes: "不安時に頓服" });
  });

  it("accepts full-width colons after slot labels", () => {
    const parsed = parseMedicationLog(medicationSection(["- 朝🌄： [x] 済"]));
    expect(parsed).toEqual({ morningTaken: true });
  });
});

describe("importMedicationFromLogs", () => {
  let db: Database;
  let store: MedicationStore;
  let logsDir: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new MedicationStore(db);
    logsDir = mkdtempSync(join(tmpdir(), "med-import-"));
  });

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true });
    db.close();
  });

  it("merges checked slots into the medication store for the owner", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), medicationSection(["- 朝🌄: [x] 済"]));

    const result = importMedicationFromLogs(logsDir, store, "owner1", NOW);

    expect(result.merged).toBe(1);
    const row = store.listSince("owner1", "2026-07-17")[0];
    expect(row.morning_taken).toBe(1);
    expect(row.night_taken).toBeNull();
  });

  it("does not clobber bot-side records with unchecked template boxes", () => {
    // Botへ直接「夜の薬飲んだ」と報告済みの状態
    store.upsert({ userId: "owner1", date: "2026-07-17", nightTaken: true }, NOW);
    writeFileSync(
      join(logsDir, "2026-07-17.md"),
      medicationSection(["- 朝🌄: [x] 済 ／", "- 夜🌙: [ ] 済 ／"]),
    );

    importMedicationFromLogs(logsDir, store, "owner1", NOW);

    const row = store.listSince("owner1", "2026-07-17")[0];
    expect(row.morning_taken).toBe(1);
    expect(row.night_taken).toBe(1);
  });

  it("skips files without any medication checks and non-date files", () => {
    writeFileSync(join(logsDir, "2026-07-16.md"), medicationSection(["- 朝🌄: [ ] 済"]));
    writeFileSync(join(logsDir, "README.md"), medicationSection(["- 朝🌄: [x] 済"]));
    writeFileSync(join(logsDir, "bot-digest.md"), medicationSection(["- 朝🌄: [x] 済"]));

    const result = importMedicationFromLogs(logsDir, store, "owner1", NOW);

    expect(result.merged).toBe(0);
    expect(store.listSince("owner1", "2000-01-01")).toHaveLength(0);
  });

  it("is idempotent for the same log content", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), medicationSection(["- 朝🌄: [x] 済"]));

    importMedicationFromLogs(logsDir, store, "owner1", NOW);
    importMedicationFromLogs(logsDir, store, "owner1", NOW);

    const rows = store.listSince("owner1", "2000-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].morning_taken).toBe(1);
  });

  it("does nothing when ownerUserId is empty or logsDir does not exist", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), medicationSection(["- 朝🌄: [x] 済"]));

    expect(importMedicationFromLogs(logsDir, store, "", NOW).merged).toBe(0);
    expect(importMedicationFromLogs(join(logsDir, "missing"), store, "owner1", NOW).merged).toBe(0);
  });
});
