// The comparable sources the CMA Builder knows about. Add a provider = one file + one line here.
import { fixturePortalAdapter } from "./browser/fixture-portal.adapter.js";
import { browserProvider } from "./browser/browser.provider.js";
// MRED collection is paused. Keep the adapter in source for a future integration.
// import { mredAdapter } from "./browser/mred.adapter.js";
import type { ComparableProvider } from "./provider.types.js";
import { rentcastProvider } from "./rentcast.provider.js";

/** Manual: no automatic collection. The agent adds comparables by hand or imports a CSV export. */
const manualProvider: ComparableProvider = {
  id: "manual",
  label: "Manual entry / CSV import",
  kind: "manual",
  needsBrowser: false,
  isFixture: false,
  redistributable: true,
  availability: () => ({ available: true }),
  collect: async () => [],
};

/** Lofty: listed so agents see why it isn't offered. Lofty's API (CRM leads/contacts) doesn't
 *  document comparable-sales data, and the Lofty connector isn't on the new backend yet. */
const loftyProvider: ComparableProvider = {
  id: "lofty",
  label: "Lofty",
  kind: "api",
  needsBrowser: false,
  isFixture: false,
  redistributable: false,
  availability: () => ({ available: false, reason: "Lofty's API doesn't provide comparable sales, and the Lofty connection isn't set up on the new backend yet." }),
  collect: async () => [],
};

export const PROVIDERS: ComparableProvider[] = [
  manualProvider,
  // browserProvider(mredAdapter),
  rentcastProvider,
  loftyProvider,
  browserProvider(fixturePortalAdapter),
];

export const providerById = (id: string) => PROVIDERS.find(p => p.id === id);

export function providerList() {
  return PROVIDERS.map(p => {
    const a = p.availability();
    return { id: p.id, label: p.label, kind: p.kind, isFixture: p.isFixture, available: a.available, reason: a.reason ?? null, needs: a.needs ?? [] };
  }).filter(p => p.available || !p.isFixture); // hide fixtures entirely when they're off
}
