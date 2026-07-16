import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_BRIDGE_NOTES_DAYS } from "../config/constants.js";
import { shiftJstDateString, toJstDateString } from "../utils/date.js";
import { claudeLogDate } from "./log-importer.js";
import {
  ensureRemoteSuccess,
  resolveRemoteRepoPaths,
  resolveRemoteRunner,
  type RemoteCommandOptions,
  type RemoteRepoPaths,
} from "./remote-common.js";

// scpの受け口としてVM上に置く中継ディレクトリ。VMのlogs/はBot実行ユーザー（aphrnts-bot）の
// 所有でSSHユーザーには書き込めないため、いったんSSHユーザーのホームへ置いてから
// sudo install で所有者・パーミッションを揃えて配置する。
const STAGING_DIR_NAME = ".aphrnts-100-push";
/** sshコマンド内で使うパス（リモートシェルが ~ を展開する） */
const STAGING_SHELL_PATH = `~/${STAGING_DIR_NAME}`;
/** scpの宛先。Windowsのgcloudが使うpscpは ~ を展開しないため、ホーム基準の相対パスで渡す */
const STAGING_SCP_DEST = `${STAGING_DIR_NAME}/`;

export interface RemotePushOptions extends RemoteCommandOptions {
  /** ローカルのログディレクトリ（既定: logs/） */
  localLogsDir: string;
  /** VM上のbot-digest.mdのパス。ここからVMのリポジトリ・logsディレクトリを導出する */
  remoteDigestPath: string;
  /** VM上でBotを実行しているユーザー（配置後のファイル所有者・sync:importの実行者） */
  remoteBotUser: string;
  /** 転送対象の日数（既定: CLAUDE_BRIDGE_NOTES_DAYS＝Botがプロンプトへ注入する範囲と同じ） */
  days?: number;
  now?: Date;
}

export interface RemotePushResult {
  /** 転送したログのファイル名（YYYY-MM-DD.md・日付昇順） */
  pushedFiles: string[];
  /** 転送対象の下限日付（YYYY-MM-DD, JST） */
  sinceDate: string;
  /** 配置先のVM上のログディレクトリ */
  remoteLogsDir: string;
  /** VM上で実行した sync:import の出力（転送対象が無くスキップした場合は undefined） */
  importOutput?: string;
}

/**
 * localLogsDir から sinceDate 以降のセッション記録（YYYY-MM-DD.md）をファイル名昇順で返す。
 * 取り込み側（log-importer）と同じく、日付形式でないファイルと空ファイルは対象外。
 */
export function listPushTargets(localLogsDir: string, sinceDate: string): string[] {
  if (!existsSync(localLogsDir)) {
    return [];
  }
  return readdirSync(localLogsDir)
    .filter((filename) => {
      const date = claudeLogDate(filename);
      if (date === undefined || date < sinceDate) {
        return false;
      }
      return readFileSync(join(localLogsDir, filename), "utf8").trim().length > 0;
    })
    .sort();
}

/** 中継ディレクトリを用意し、前回の残骸を消す（機微なログをVM上に残さないため） */
function buildStagingCommand(): string {
  return `mkdir -p ${STAGING_SHELL_PATH} && chmod 700 ${STAGING_SHELL_PATH} && rm -f ${STAGING_SHELL_PATH}/*.md`;
}

/**
 * 中継ディレクトリのログをVMのlogs/へ配置し、VM側のSQLiteへ取り込む。
 * 転送したログはBot実行ユーザーの所有・600で置き、中継ファイルは成否によらずtrapで必ず消す。
 */
function buildInstallAndImportCommand(paths: RemoteRepoPaths, botUser: string): string {
  const staged = `${STAGING_SHELL_PATH}/*.md`;
  return (
    `trap 'rm -f ${staged}' EXIT; ` +
    `sudo install -o ${botUser} -g ${botUser} -m 600 -t ${paths.logsDir} ${staged} && ` +
    `sudo -u ${botUser} bash -c 'cd ${paths.repoDir} && npm run sync:import'`
  );
}

/**
 * Claude→Bot方向の本番VM連携: ローカルの logs/YYYY-MM-DD.md をVMへ転送し、
 * VM上で sync:import を実行してVMのSQLite（claude_session_notes）へ取り込む。
 *
 * pull-remote（VM→ローカル）と対になる経路で、デプロイの pull型一方向（GitHub→VM）では
 * 届かないClaude側の記録を本番Botの応答文脈へ載せるために使う。
 * 取り込みは日付をキーにした上書きのため、同じログを何度pushしても結果は変わらない（冪等）。
 */
export function pushRemoteLogs(options: RemotePushOptions): RemotePushResult {
  const paths = resolveRemoteRepoPaths(options.remoteDigestPath);
  const days = options.days ?? CLAUDE_BRIDGE_NOTES_DAYS;
  const today = toJstDateString(options.now ?? new Date());
  const sinceDate = shiftJstDateString(today, -(days - 1));
  const pushedFiles = listPushTargets(options.localLogsDir, sinceDate);

  if (pushedFiles.length === 0) {
    return { pushedFiles, sinceDate, remoteLogsDir: paths.logsDir };
  }

  const runner = resolveRemoteRunner(options);
  ensureRemoteSuccess(runner.ssh(buildStagingCommand()), "VM上の中継ディレクトリの準備に失敗した");
  ensureRemoteSuccess(
    runner.scp(pushedFiles, STAGING_SCP_DEST, options.localLogsDir),
    "VMへのセッション記録の転送(scp)に失敗した",
  );
  const imported = ensureRemoteSuccess(
    runner.ssh(buildInstallAndImportCommand(paths, options.remoteBotUser)),
    "VM上でのセッション記録の取り込み(sync:import)に失敗した",
  );

  return {
    pushedFiles,
    sinceDate,
    remoteLogsDir: paths.logsDir,
    importOutput: imported.stdout?.trim(),
  };
}
