/**
 * Codex throttle shared by every slot in this process, and (via Convex) every container:
 *  - a token bucket caps Codex turns per minute
 *  - a rate-limit error puts every worker into a shared cooldown; the job waits in place
 */
export class RateLimitError extends Error {
  constructor(message: string, public readonly cooldownUntil: number) { super(message); this.name = "RateLimitError"; }
}

const RATE_LIMIT_RE = /rate.?limit|429|too many requests|usage limit|quota|capacity|overloaded|insufficient_quota|try again later/i;
export function isRateLimit(err: unknown) { return RATE_LIMIT_RE.test(String((err as Error)?.message ?? err)); }

export type GateHooks = {
  getCooldownUntil: () => Promise<number>;
  reportRateLimit: (reason: string) => Promise<{ cooldownUntil: number; minutes: number; strikes: number }>;
  clearCooldown: () => Promise<void>;
};

export class CodexGate {
  private tokens: number;
  private lastRefill = Date.now();
  private hadCooldown = false;
  constructor(private perMinute: number, private hooks: GateHooks, private fakeOnce = false) { this.tokens = perMinute; }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.lastRefill) / 60_000) * this.perMinute);
    this.lastRefill = now;
  }

  /** Block until a turn is allowed: shared cooldown passed and a token is available. */
  async acquire(onWait?: (seconds: number, why: "cooldown" | "budget") => void | Promise<void>) {
    for (;;) {
      const until = await this.hooks.getCooldownUntil();
      const now = Date.now();
      if (until > now) {
        this.hadCooldown = true;
        await onWait?.(Math.ceil((until - now) / 1000), "cooldown");
        await sleep(Math.min(until - now, 30_000) + 500);
        continue;
      }
      this.refill();
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      const wait = ((1 - this.tokens) / this.perMinute) * 60_000;
      await onWait?.(Math.ceil(wait / 1000), "budget");
      await sleep(wait + 100);
    }
  }

  /** Run one Codex turn under the gate. A rate-limit error becomes a shared cooldown and a RateLimitError. */
  async run<T>(fn: () => Promise<T>, onWait?: Parameters<CodexGate["acquire"]>[0]): Promise<T> {
    await this.acquire(onWait);
    if (this.fakeOnce) { this.fakeOnce = false; const r = await this.hooks.reportRateLimit("FAKE 429 rate limit (test)"); throw new RateLimitError("429 rate limit (test)", r.cooldownUntil); }
    try {
      const out = await fn();
      if (this.hadCooldown) { this.hadCooldown = false; await this.hooks.clearCooldown().catch(() => {}); }
      return out;
    } catch (err) {
      if (!isRateLimit(err)) throw err;
      const r = await this.hooks.reportRateLimit(String((err as Error).message).slice(0, 200));
      throw new RateLimitError(`Codex rate limit; cooling down ${r.minutes} min (strike ${r.strikes})`, r.cooldownUntil);
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
