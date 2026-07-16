import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteRunner,
  ensureRemoteSuccess,
  resolveGcloudPath,
  resolveRemoteRepoPaths,
} from "../../../src/bridge/remote-common.js";

describe("resolveGcloudPath", () => {
  it("returns the first candidate whose --version probe succeeds", () => {
    const exec = vi.fn().mockReturnValue({ status: 0, error: undefined } as never);
    const path = resolveGcloudPath({ gcloudPathOverride: "C:/tools/gcloud.cmd", exec });
    expect(path).toBe("C:/tools/gcloud.cmd");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("falls back to the Windows default install path when PATH lookup fails", () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 1, error: new Error("not found") } as never)
      .mockReturnValueOnce({ status: 0, error: undefined } as never);
    const localAppData = "C:/Users/test/AppData/Local";
    const path = resolveGcloudPath({ localAppData, exec });
    expect(path).toBe(join(localAppData, "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd"));
  });

  it("throws when no candidate is executable", () => {
    const exec = vi.fn().mockReturnValue({ status: 1, error: new Error("not found") } as never);
    expect(() => resolveGcloudPath({ exec })).toThrow("gcloud CLIが見つからない");
  });
});

describe("resolveRemoteRepoPaths", () => {
  it("derives the VM repository and logs directory from the digest path", () => {
    expect(resolveRemoteRepoPaths("/opt/aphrnts-100/logs/bot-digest.md")).toEqual({
      repoDir: "/opt/aphrnts-100",
      logsDir: "/opt/aphrnts-100/logs",
    });
  });

  it("rejects a relative digest path", () => {
    expect(() => resolveRemoteRepoPaths("logs/bot-digest.md")).toThrow("REMOTE_BOT_DIGEST_PATH");
  });

  it("rejects a digest path that is not inside a repository logs directory", () => {
    expect(() => resolveRemoteRepoPaths("/logs/bot-digest.md")).toThrow("REMOTE_BOT_DIGEST_PATH");
  });

  it("rejects a digest path placed directly at the filesystem root", () => {
    expect(() => resolveRemoteRepoPaths("/bot-digest.md")).toThrow("REMOTE_BOT_DIGEST_PATH");
  });
});

describe("ensureRemoteSuccess", () => {
  it("returns the result untouched when the command succeeded", () => {
    const result = { status: 0, stdout: "ok", stderr: "" } as never;
    expect(ensureRemoteSuccess(result, "失敗した")).toBe(result);
  });

  it("prefers stderr in the error message", () => {
    const result = { status: 1, stdout: "out", stderr: "err" } as never;
    expect(() => ensureRemoteSuccess(result, "失敗した")).toThrow("失敗した: err");
  });

  it("falls back to stdout when stderr is empty", () => {
    const result = { status: 1, stdout: "out", stderr: "" } as never;
    expect(() => ensureRemoteSuccess(result, "失敗した")).toThrow("失敗した: out");
  });

  it("falls back to the spawn error message when the command never ran", () => {
    // gcloud自体の起動に失敗した場合はstatusがnullのままerrorだけが入る
    const result = { status: null, stdout: "", stderr: "", error: new Error("spawn ENOENT") } as never;
    expect(() => ensureRemoteSuccess(result, "失敗した")).toThrow("失敗した: spawn ENOENT");
  });

  it("falls back to a placeholder when the failure carries no output at all", () => {
    const result = { status: 1, stdout: "", stderr: "" } as never;
    expect(() => ensureRemoteSuccess(result, "失敗した")).toThrow("失敗した: (出力なし)");
  });
});

describe("createRemoteRunner", () => {
  const connection = { gceProject: "proj", gceZone: "zone", gceInstance: "instance" };

  it("resolves the gcloud path once per runner", () => {
    const exec = vi.fn().mockReturnValue({ status: 0, error: undefined } as never);
    const runner = createRemoteRunner({ ...connection, exec });
    runner.ssh("echo hi");
    runner.ssh("echo hi again");

    // 1回目のみ --version による探索。以降はssh実行のみ
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[0][0]).toContain("--version");
  });

  it("builds an ssh command line with the zone, project and IAP tunnel", () => {
    const exec = vi.fn().mockReturnValue({ status: 0, error: undefined } as never);
    createRemoteRunner({ ...connection, exec }).ssh("sudo cat /opt/aphrnts-100/logs/bot-digest.md");

    const commandLine = exec.mock.calls[1][0] as string;
    expect(commandLine).toContain("compute ssh instance");
    expect(commandLine).toContain("--zone=zone");
    expect(commandLine).toContain("--project=proj");
    expect(commandLine).toContain("--tunnel-through-iap");
    expect(commandLine).toContain('"--command=sudo cat /opt/aphrnts-100/logs/bot-digest.md"');
  });

  it("builds an scp command line with the sources before the remote destination", () => {
    const exec = vi.fn().mockReturnValue({ status: 0, error: undefined } as never);
    createRemoteRunner({ ...connection, exec }).scp(["2026-07-16.md", "2026-07-17.md"], ".staging/", "/local/logs");

    const [commandLine, options] = exec.mock.calls[1] as [string, { cwd?: string }];
    expect(commandLine).toContain("compute scp 2026-07-16.md 2026-07-17.md instance:.staging/");
    // ローカルのパス（"C:\..."）を渡すとgcloudがコロンをVM名の区切りと解釈しうるため、
    // logsディレクトリをcwdにしてファイル名だけを渡す
    expect(options.cwd).toBe("/local/logs");
  });
});
