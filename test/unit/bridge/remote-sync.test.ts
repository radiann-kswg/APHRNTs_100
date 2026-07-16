import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRemoteExport, syncRemote } from "../../../src/bridge/remote-sync.js";

describe("runRemoteExport", () => {
  const options = {
    gceProject: "proj",
    gceZone: "zone",
    gceInstance: "instance",
    remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
    remoteBotUser: "aphrnts-bot",
  };

  it("regenerates the digest on the VM as the bot user", () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 0, stdout: "[sync] Bot→Claude: 記録ダイジェストを logs/bot-digest.md へ書き出した。\n" } as never);

    const output = runRemoteExport({ ...options, exec });

    expect(exec.mock.calls[1]?.[0]).toContain(
      "sudo -u aphrnts-bot bash -c 'cd /opt/aphrnts-100 && npm run sync:export'",
    );
    expect(output).toContain("記録ダイジェストを logs/bot-digest.md へ書き出した");
  });

  it("throws when the remote export fails", () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 1, stderr: "npm ERR! missing script" } as never);

    expect(() => runRemoteExport({ ...options, exec })).toThrow(
      "VM上でのダイジェスト再生成(sync:export)に失敗した: npm ERR! missing script",
    );
  });

  it("returns an empty string when the remote export prints nothing", () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 0, stdout: undefined } as never);

    expect(runRemoteExport({ ...options, exec })).toBe("");
  });
});

describe("syncRemote", () => {
  let logsDir: string;

  beforeEach(() => {
    logsDir = mkdtempSync(join(tmpdir(), "aphrnts-sync-remote-"));
  });

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true });
  });

  it("runs push → remote export → pull over a single gcloud resolution", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), "# 2026-07-17\n\n## 体調・気分\nまずまず。", "utf8");
    const localDigestPath = join(logsDir, "bot-digest.md");
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never) // gcloud --version 探索
      .mockReturnValueOnce({ status: 0, stdout: "" } as never) // push: 中継ディレクトリの準備
      .mockReturnValueOnce({ status: 0, stdout: "" } as never) // push: scp
      .mockReturnValueOnce({ status: 0, stdout: "[sync] Claude→Bot: 1件" } as never) // push: VM上のimport
      .mockReturnValueOnce({ status: 0, stdout: "[sync] Bot→Claude: 書き出した" } as never) // VM上のexport
      .mockReturnValueOnce({ status: 0, stdout: "# Botの記録ダイジェスト\n" } as never); // pull

    const result = syncRemote({
      gceProject: "proj",
      gceZone: "zone",
      gceInstance: "instance",
      localLogsDir: logsDir,
      localDigestPath,
      remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
      remoteBotUser: "aphrnts-bot",
      now: new Date("2026-07-17T03:00:00Z"),
      exec,
    });

    expect(result.push.pushedFiles).toEqual(["2026-07-17.md"]);
    expect(result.exportOutput).toContain("Bot→Claude");
    expect(result.pull.content).toBe("# Botの記録ダイジェスト\n");
    expect(readFileSync(localDigestPath, "utf8")).toBe("# Botの記録ダイジェスト\n");

    // gcloudの探索は1回だけ。以降はssh/scpのみが順に走る
    expect(exec).toHaveBeenCalledTimes(6);
    expect(exec.mock.calls[0]?.[0]).toContain("--version");
    const commands = exec.mock.calls.slice(1).map((call) => call[0] as string);
    expect(commands[2]).toContain("npm run sync:import");
    expect(commands[3]).toContain("npm run sync:export");
    expect(commands[4]).toContain("sudo cat /opt/aphrnts-100/logs/bot-digest.md");
  });

  it("still regenerates and pulls the digest when there is nothing to push", () => {
    const localDigestPath = join(logsDir, "bot-digest.md");
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 0, stdout: "[sync] Bot→Claude: 書き出した" } as never)
      .mockReturnValueOnce({ status: 0, stdout: "# Botの記録ダイジェスト\n" } as never);

    const result = syncRemote({
      gceProject: "proj",
      gceZone: "zone",
      gceInstance: "instance",
      localLogsDir: logsDir,
      localDigestPath,
      remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
      remoteBotUser: "aphrnts-bot",
      now: new Date("2026-07-17T03:00:00Z"),
      exec,
    });

    expect(result.push.pushedFiles).toEqual([]);
    expect(result.pull.content).toBe("# Botの記録ダイジェスト\n");
    expect(exec).toHaveBeenCalledTimes(3);
  });

  it("stops before the remote export and pull when the push fails", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), "# 2026-07-17", "utf8");
    const localDigestPath = join(logsDir, "bot-digest.md");
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never) // gcloud --version 探索
      .mockReturnValueOnce({ status: 0, stdout: "" } as never) // push: 中継ディレクトリの準備
      .mockReturnValueOnce({ status: 1, stderr: "connection closed" } as never) // push: scpで失敗
      .mockReturnValue({ status: 0, stdout: "ここへは進まない" } as never);

    expect(() =>
      syncRemote({
        gceProject: "proj",
        gceZone: "zone",
        gceInstance: "instance",
        localLogsDir: logsDir,
        localDigestPath,
        remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
        remoteBotUser: "aphrnts-bot",
        now: new Date("2026-07-17T03:00:00Z"),
        exec,
      }),
    ).toThrow("VMへのセッション記録の転送(scp)に失敗した: connection closed");

    // push失敗時点で打ち切る。VM側のexportも走らず、古いダイジェストで上書きもしない
    expect(exec).toHaveBeenCalledTimes(3);
    expect(existsSync(localDigestPath)).toBe(false);
  });
});
