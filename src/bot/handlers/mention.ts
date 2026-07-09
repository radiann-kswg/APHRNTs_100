import type { MentionNote, MisskeyClient } from "../../misskey/client.js";
import type { MessageHandler } from "../pipeline.js";

export function createMentionHandler(handleMessage: MessageHandler, client: MisskeyClient) {
  return async function onMention(note: MentionNote): Promise<void> {
    const result = await handleMessage(note.userId, note.text, "misskey");
    if (result.suppressed || result.replyText.length === 0) {
      return;
    }
    await client.reply(note.id, result.replyText);
  };
}
