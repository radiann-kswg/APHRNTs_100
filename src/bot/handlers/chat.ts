import type { IncomingChatMessage, MisskeyClient } from "../../misskey/client.js";
import type { MessageHandler } from "../pipeline.js";

export function createChatHandler(handleMessage: MessageHandler, client: MisskeyClient) {
  return async function onChatMessage(message: IncomingChatMessage): Promise<void> {
    const result = await handleMessage(message.fromUserId, message.text, "misskey-chat");
    if (result.suppressed || result.replyText.length === 0) {
      return;
    }
    await client.sendChatMessage(message.fromUserId, result.replyText);
  };
}
