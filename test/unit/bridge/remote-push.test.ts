import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPushTargets, pushRemoteLogs } from "../../../src/bridge/remote-push.js";

describe("listPushTargets", () => {
  let logsDir: string;

  beforeEach(() => {
    logsDir = mkdtempSync(join(tmpdir(), "aphrnts-push-"));
  });

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true });
  });

  function writeLog(filename: string, content = "記録"): void {
    writeFileSync(join(logsDir, filename), content, "utf8");
  }

  it("returns YYYY-MM-DD.md files on or after sinceDate in ascending order", () => {
    writeLog("2026-07-17.md");
    writeLog("2026-07-11.md");
    writeLog("2026-07-10.md");

    expect(listPushTargets(logsDir, "2026-07-11")).toEqual(["2026-07-11.md", "2026-07-17.md"]);
  });

  it("skips README.md, bot-digest.md, weekly sheets and other non-date files", () => {
    writeLog("README.md");
    writeLog("bot-digest.md");
    writeLog("weekly-2026-07-13.md");
    writeLog("memo.md");
    writeLog("2026-07-17.md");

    expect(listPushTargets(logsDir, "2026-07-11")).toEqual(["2026-07-17.md"]);
  });

  it("skips empty files, matching the importer's behaviour", () => {
    writeLog("2026-07-16.md", "   \n");
    writeLog("2026-07-17.md");

    expect(listPushTargets(logsDir, "2026-07-11")).toEqual(["2026-07-17.md"]);
  });

  it("returns an empty list when the logs directory does not exist", () => {
    expect(listPushTargets(join(logsDir, "missing"), "2026-07-11")).toEqual([]);
  });
});

describe("pushRemoteLogs", () => {
  let logsDir: string;

  const baseOptions = {
    gceProject: "proj",
    gceZone: "zone",
    gceInstance: "instance",
    remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
    remoteBotUser: "aphrnts-bot",
    // JST 2026-07-17 12:00
    now: new Date("2026-07-17T03:00:00Z"),
  };

  beforeEach(() => {
    logsDir = mkdtempSync(join(tmpdir(), "aphrnts-push-"));
  });

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true });
  });

  function writeLog(filename: string, content = "記録"): void {
    writeFileSync(join(logsDir, filename), content, "utf8");
  }

  /** --version探索 → staging用ssh → scp → install+importのssh の順に成功を返すexec */
  function okExec(): ReturnType<typeof vi.fn> {
    return vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 0, stdout: "" } as never)
      .mockReturnValueOnce({ status: 0, stdout: "" } as never)
      .mockReturnValueOnce({ status: 0, stdout: "[sync] Claude→Bot: logs/ から 2件のセッション記録を取り込んだ（スキップ 0件）。\n" } as never);
  }

  it("transfers the last 7 days of logs and imports them on the VM", () => {
    writeLog("2026-07-16.md");
    writeLog("2026-07-17.md");
    writeLog("2026-07-10.md"); // 8日前・対象外
    const exec = okExec();

    const result = pushRemoteLogs({ ...baseOptions, localLogsDir: logsDir, exec });

    expect(result.pushedFiles).toEqual(["2026-07-16.md", "2026-07-17.md"]);
    expect(result.sinceDate).toBe("2026-07-11");
    expect(result.remoteLogsDir).toBe("/opt/aphrnts-100/logs");
    expect(result.importOutput).toContain("2件のセッション記録を取り込んだ");

    const [stagingCommand, scpCommand, importCommand] = exec.mock.calls.slice(1).map((call) => call[0] as string);
    expect(stagingCommand).toContain("mkdir -p ~/.aphrnts-100-push");
    expect(stagingCommand).toContain("chmod 700 ~/.aphrnts-100-push");
    expect(stagingCommand).toContain("rm -f ~/.aphrnts-100-push/*.md");

    expect(scpCommand).toContain("compute scp 2026-07-16.md 2026-07-17.md instance:.aphrnts-100-push/");
    expect(exec.mock.calls[2]?.[1]).toMatchObject({ cwd: logsDir });

    // VMのlogs/はBot実行ユーザー所有のため、sudo installで所有者・パーミッションを揃えて配置する
    expect(importCommand).toContain(
      "sudo install -o aphrnts-bot -g aphrnts-bot -m 600 -t /opt/aphrnts-100/logs ~/.aphrnts-100-push/*.md",
    );
    expect(importCommand).toContain("sudo -u aphrnts-bot bash -c 'cd /opt/aphrnts-100 && npm run sync:import'");
    // 失敗しても機微なログの中継コピーをVM上に残さない
    expect(importCommand).toContain("trap 'rm -f ~/.aphrnts-100-push/*.md' EXIT");
  });

  it("uses the JST calendar date to compute the transfer window", () => {
    writeLog("2026-07-11.md");
    writeLog("2026-07-10.md");
    const exec = okExec();

    // UTCでは2026-07-16だがJSTでは2026-07-17。JST基準なので下限は2026-07-11
    const result = pushRemoteLogs({
      ...baseOptions,
      now: new Date("2026-07-16T15:30:00Z"),
      localLogsDir: logsDir,
      exec,
    });

    expect(result.sinceDate).toBe("2026-07-11");
    expect(result.pushedFiles).toEqual(["2026-07-11.md"]);
  });

  it("honours a days override", () => {
    writeLog("2026-07-10.md");
    writeLog("2026-07-17.md");
    const exec = okExec();

    const result = pushRemoteLogs({ ...baseOptions, localLogsDir: logsDir, days: 14, exec });

    expect(result.sinceDate).toBe("2026-07-04");
    expect(result.pushedFiles).toEqual(["2026-07-10.md", "2026-07-17.md"]);
  });

  it("does not touch the VM when there is nothing to transfer", () => {
    writeLog("2026-07-01.md");
    const exec = okExec();

    const result = pushRemoteLogs({ ...baseOptions, localLogsDir: logsDir, exec });

    expect(result.pushedFiles).toEqual([]);
    expect(result.importOutput).toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });

  it("throws when the staging directory cannot be prepared", () => {
    writeLog("2026-07-17.md");
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 255, stderr: "Permission denied (publickey)" } as never);

    expect(() => pushRemoteLogs({ ...baseOptions, localLogsDir: logsDir, exec })).toThrow(
      "VM上の中継ディレクトリの準備に失敗した: Permission denied (publickey)",
    );
    // 中継ディレクトリを用意できていない以上、機微なログのscpへは進まない
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("throws when the transfer fails", () => {
    writeLog("2026-07-17.md");
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 0, stdout: "" } as never)
      .mockReturnValueOnce({ status: 1, stderr: "connection closed" } as never);

    expect(() => pushRemoteLogs({ ...baseOptions, localLogsDir: logsDir, exec })).toThrow(
      "VMへのセッション記録の転送(scp)に失敗した: connection closed",
    );
  });

  it("throws when the import on the VM fails", () => {
    writeLog("2026-07-17.md");
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 0, stdout: "" } as never)
      .mockReturnValueOnce({ status: 0, stdout: "" } as never)
      .mockReturnValueOnce({ status: 1, stderr: "sudo: a password is required" } as never);

    expect(() => pushRemoteLogs({ ...baseOptions, localLogsDir: logsDir, exec })).toThrow(
      "VM上でのセッション記録の取り込み(sync:import)に失敗した: sudo: a password is required",
    );
  });
});
