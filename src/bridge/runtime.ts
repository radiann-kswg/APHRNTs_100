import type { MessageHandler } from "../bot/pipeline.js";
import { CLAUDE_BRIDGE_NOTES_DAYS } from "../config/constants.js";
import { ClaudeNotesStore } from "../storage/claude-notes-store.js";
import { buildClaudeNotesSection } from "./notes-section.js";
import { runExport, runImport, runSync, type BridgeSyncDeps, type BridgeSyncResult } from "./sync.js";

export interface BridgeRuntime {
  /** 起動時の双方向同期（logs/取り込み → ダイジェスト書き出し） */
  syncOnStartup(): BridgeSyncResult;
  /** システムプロンプトへ注入する直近のClaudeセッション記録セクション（記録がなければundefined） */
  currentNotesSection(): string | undefined;
  /**
   * メッセージハンドラーを連携ブリッジ付きでラップする。
   * 処理前に logs/ を再取り込み（Claude側の新しい記録を即反映）、
   * 処理後にダイジェストを書き出す（Bot側の新しい記録を即公開）。
   * 同期の失敗は onError に通知するのみで、応答自体は妨げない。
   */
  wrapHandler(handler: MessageHandler, onError?: (error: unknown) => void): MessageHandler;
}

/** Bot実行プロセス内でClaude連携ブリッジを扱うためのランタイムを生成する */
export function createBridgeRuntime(deps: BridgeSyncDeps): BridgeRuntime {
  const notesStore = new ClaudeNotesStore(deps.db);
  const now = deps.now ?? (() => new Date());

  return {
    syncOnStartup(): BridgeSyncResult {
      return runSync(deps);
    },

    currentNotesSection(): string | undefined {
      const since = new Date(now().getTime() - CLAUDE_BRIDGE_NOTES_DAYS * 24 * 60 * 60 * 1000);
      const rows = notesStore.listSince(since.toISOString().slice(0, 10));
      return buildClaudeNotesSection(rows);
    },

    wrapHandler(handler: MessageHandler, onError?: (error: unknown) => void): MessageHandler {
      return async (userId, text, channel) => {
        try {
          runImport(deps);
        } catch (error) {
          onError?.(error);
        }
        const result = await handler(userId, text, channel);
        try {
          runExport(deps);
        } catch (error) {
          onError?.(error);
        }
        return result;
      };
    },
  };
}
