import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pullRemoteDigest, resolveGcloudPath } from "../../../src/bridge/remote-pull.js";

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

describe("pullRemoteDigest", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmpFile(): string {
    const dir = mkdtempSync(join(tmpdir(), "remote-pull-test-"));
    tmpDirs.push(dir);
    return join(dir, "nested", "bot-digest.md");
  }

  it("writes the fetched digest content to the local path", () => {
    const localDigestPath = tmpFile();
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never) // gcloud --version probe
      .mockReturnValueOnce({ status: 0, stdout: "# digest content\n" } as never); // ssh cat

    const result = pullRemoteDigest({
      gceProject: "proj",
      gceZone: "zone",
      gceInstance: "instance",
      remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
      localDigestPath,
      exec,
    });

    expect(result.content).toBe("# digest content\n");
    expect(readFileSync(localDigestPath, "utf8")).toBe("# digest content\n");

    const sshCommand = exec.mock.calls[1][0] as string;
    expect(sshCommand).toContain("compute ssh instance");
    expect(sshCommand).toContain("--zone=zone");
    expect(sshCommand).toContain("--project=proj");
    expect(sshCommand).toContain("sudo cat /opt/aphrnts-100/logs/bot-digest.md");
  });

  it("throws when the remote command exits non-zero", () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 1, stderr: "permission denied" } as never);

    expect(() =>
      pullRemoteDigest({
        gceProject: "proj",
        gceZone: "zone",
        gceInstance: "instance",
        remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
        localDigestPath: tmpFile(),
        exec,
      }),
    ).toThrow("permission denied");
  });

  it("throws when the remote output is empty", () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined } as never)
      .mockReturnValueOnce({ status: 0, stdout: "   " } as never);

    expect(() =>
      pullRemoteDigest({
        gceProject: "proj",
        gceZone: "zone",
        gceInstance: "instance",
        remoteDigestPath: "/opt/aphrnts-100/logs/bot-digest.md",
        localDigestPath: tmpFile(),
        exec,
      }),
    ).toThrow("VMからのbot-digest.md取得に失敗した");
  });
});
