// One interface for every comparable source: browser automation, property APIs and manual/CSV
// import. The collection job only talks to this interface, so adding a licensed MLS feed later is
// one new file plus a line in providers/index.ts.
import type { SearchParams, SubjectProperty } from "../cma-builder.types.js";
import type { RawComparable } from "../engine/normalize.js";

export type ProviderKind = "browser" | "api" | "manual";

export type ProviderAvailability = {
  available: boolean;
  /** Why it can't run (shown to agents in the request dialog). */
  reason?: string;
  /** Settings an admin must add (names only, never values). */
  needs?: string[];
};

export type CollectLog = (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => Promise<void>;

export type CollectInput = {
  subject: SubjectProperty;
  params: SearchParams;
  signal: AbortSignal;
  log: CollectLog;
  /** Updates the agent-facing progress line ("Searching sold homes…"). */
  progress: (note: string) => Promise<void>;
};

export interface ComparableProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Browser providers need Chromium, so they only run in the worker process (npm run worker). */
  needsBrowser: boolean;
  /** Records are clearly labelled development fixtures, never real properties. */
  isFixture: boolean;
  /** Whether the source's terms allow showing its records (addresses, photos) to sellers. */
  redistributable: boolean;
  availability(): ProviderAvailability;
  collect(input: CollectInput): Promise<RawComparable[]>;
}

/** A failure the job can explain. `retryable` = worth another try; `blocked` = stop (CAPTCHA, device wall, login refused). */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly blocked: boolean;
  /** Safe to show the agent (never includes credentials or page content). */
  readonly agentMessage: string;
  constructor(message: string, opts: { retryable?: boolean; blocked?: boolean; agentMessage?: string } = {}) {
    super(message);
    this.name = "ProviderError";
    this.retryable = opts.retryable ?? false;
    this.blocked = opts.blocked ?? false;
    this.agentMessage = opts.agentMessage ?? message;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new CancelledError();
}

/** Waits `ms`, or rejects at once when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Bounded retries with exponential backoff (base, 2×base, 4×base … plus up to 20% jitter).
 * Only ProviderErrors marked retryable (and plain network errors) are retried; blocked and
 * cancelled ones stop immediately.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts: number; baseMs: number; signal: AbortSignal; onRetry?: (attempt: number, error: Error, waitMs: number) => Promise<void> | void },
): Promise<T> {
  let last: Error | undefined;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    throwIfAborted(opts.signal);
    try {
      return await fn(attempt);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      last = err;
      const retryable = err instanceof ProviderError ? err.retryable && !err.blocked : !(err instanceof CancelledError);
      if (!retryable || attempt === opts.attempts) throw err;
      const wait = Math.round(opts.baseMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.2));
      await opts.onRetry?.(attempt, err, wait);
      await sleep(wait, opts.signal);
    }
  }
  throw last ?? new Error("retry failed");
}

/** Per-provider rate limit: at most one call every `minIntervalMs` (per process). */
const lastCall = new Map<string, number>();
export async function rateLimit(providerId: string, minIntervalMs: number, signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const next = Math.max(now, (lastCall.get(providerId) ?? 0) + minIntervalMs);
  lastCall.set(providerId, next);
  if (next > now) await sleep(next - now, signal);
}
