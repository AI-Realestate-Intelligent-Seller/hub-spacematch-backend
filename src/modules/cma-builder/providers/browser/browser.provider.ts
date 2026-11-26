// Wraps a site-specific browser adapter as a ComparableProvider. The adapter knows one site; this
// file adds the shared rules: authorization gate, retries with backoff and the worker-only flag.
import { config } from "../../../../config/index.js";
import type { RawComparable } from "../../engine/normalize.js";
import { type CollectInput, type ComparableProvider, type ProviderAvailability, ProviderError, withRetry } from "../provider.types.js";

export interface BrowserAdapter {
  id: string;
  label: string;
  /** Hosts the browser may load (exact, or "*.example.com"). Everything else is blocked. */
  allowedHosts: string[];
  isFixture: boolean;
  redistributable: boolean;
  /** Credentials / settings check (the authorization gate is applied on top). */
  availability(): ProviderAvailability;
  collect(input: CollectInput): Promise<RawComparable[]>;
}

export function browserProvider(adapter: BrowserAdapter): ComparableProvider {
  return {
    id: `browser:${adapter.id}`,
    label: adapter.label,
    kind: "browser",
    needsBrowser: true,
    isFixture: adapter.isFixture,
    redistributable: adapter.redistributable,
    availability() {
      if (adapter.isFixture) {
        return config.cmaBuilder.devFixtures ? { available: true } : { available: false, reason: "Development fixtures are off.", needs: ["CMA_DEV_FIXTURES=true (non-production only)"] };
      }
      if (!config.cmaBuilder.authorizedBrowserSources.includes(adapter.id)) {
        return {
          available: false,
          reason: `${adapter.label} is not authorized for automated collection. The broker must confirm the source's terms allow it.`,
          needs: [`CMA_BROWSER_AUTHORIZED_SOURCES=${adapter.id}`],
        };
      }
      return adapter.availability();
    },
    collect(input) {
      const access = this.availability();
      if (!access.available) throw new ProviderError(access.reason ?? "Browser source unavailable", { blocked: true, agentMessage: access.reason ?? "The data source is unavailable." });
      return withRetry(() => adapter.collect(input), {
        attempts: 3,
        baseMs: 4000,
        signal: input.signal,
        onRetry: (attempt, error, waitMs) => input.log("warn", `Attempt ${attempt} failed, retrying in ${Math.round(waitMs / 1000)} s`, { error: error.message }),
      });
    },
  };
}
