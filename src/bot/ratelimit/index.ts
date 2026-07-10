import type { RateLimitStore } from "../../storage/rate-limit-store.js";

export interface RateLimitDecision {
  allowed: boolean;
  exempt: boolean;
  reason?: "cooldown" | "global_cap";
}

export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly cooldownMs: number,
    private readonly globalPerHour: number,
  ) {}

  // 猶予期間をcooldownMsと同じ長さにすることで、会話が続いている間は返信までの
  // 間隔がどれだけあいても黙って抑制されない（以前は5分の固定値だったため、
  // 5〜30分の間隔で返信すると無言のままクールダウン扱いになっていた）。
  private isExempt(lastInteractionAt: Date | null, now: Date): boolean {
    if (!lastInteractionAt) return false;
    return now.getTime() - lastInteractionAt.getTime() <= this.cooldownMs;
  }

  check(userId: string, lastInteractionAt: Date | null, now: Date = new Date()): RateLimitDecision {
    if (this.isExempt(lastInteractionAt, now)) {
      return { allowed: true, exempt: true };
    }

    const lastReplyAt = this.store.getLastReplyAt(userId);
    if (lastReplyAt && now.getTime() - lastReplyAt.getTime() < this.cooldownMs) {
      return { allowed: false, exempt: false, reason: "cooldown" };
    }

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const globalCount = this.store.countGlobalPostsSince(oneHourAgo);
    if (globalCount >= this.globalPerHour) {
      return { allowed: false, exempt: false, reason: "global_cap" };
    }

    return { allowed: true, exempt: false };
  }

  recordReply(userId: string, exempt: boolean, now: Date = new Date()): void {
    this.store.recordReply(userId, now);
    if (!exempt) {
      this.store.recordGlobalPost(now);
    }
  }
}
