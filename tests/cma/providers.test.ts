// Unit tests: provider interface helpers (retry/backoff, cancellation), provider gating, and the
// Playwright browser pool (real headless Chromium, no network). Run: npm run test:cma
// Needs Chromium: set CMA_BROWSER_EXECUTABLE or install Playwright's Chromium (see CMA_BUILDER.md).
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { closeBrowser, hostAllowed, openContexts, withBrowserPage } from "../../src/modules/cma-builder/providers/browser/browser-pool.js";
import { fixturePortalAdapter } from "../../src/modules/cma-builder/providers/browser/fixture-portal.adapter.js";
import { applyMredLocationFilters, mredAdapter, mredLoginOutcome, mredSearchControl, openResidentialSearch, visibleMredRows } from "../../src/modules/cma-builder/providers/browser/mred.adapter.js";
import { providerById, providerList } from "../../src/modules/cma-builder/providers/index.js";
import { CancelledError, ProviderError, withRetry } from "../../src/modules/cma-builder/providers/provider.types.js";
import { normalizeBatch } from "../../src/modules/cma-builder/engine/normalize.js";

const signal = () => new AbortController().signal;

describe("withRetry", () => {
  it("retries retryable errors with growing waits, then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const r = await withRetry(
      async () => {
        if (++calls < 3) throw new ProviderError("flaky", { retryable: true });
        return "ok";
      },
      { attempts: 3, baseMs: 10, signal: signal(), onRetry: (_a, _e, w) => void waits.push(w) },
    );
    assert.equal(r, "ok");
    assert.equal(calls, 3);
    assert.ok(waits[1]! >= waits[0]! * 1.6, `backoff ${waits}`);
  });
  it("gives up after the attempt limit", async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => { calls++; throw new ProviderError("down", { retryable: true }); }, { attempts: 3, baseMs: 1, signal: signal() }),
      /down/,
    );
    assert.equal(calls, 3);
  });
  it("never retries a blocked source (CAPTCHA / login refused)", async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw new ProviderError("captcha", { blocked: true, retryable: true }); }, { attempts: 3, baseMs: 1, signal: signal() }));
    assert.equal(calls, 1);
  });
  it("stops at once when cancelled", async () => {
    const c = new AbortController();
    c.abort();
    await assert.rejects(withRetry(async () => "x", { attempts: 3, baseMs: 1, signal: c.signal }), CancelledError);
  });
});

describe("provider registry", () => {
  it("keeps manual available while MRED is paused", () => {
    assert.equal(providerById("manual")!.availability().available, true);
    assert.equal(providerById("browser:mred"), undefined);
    assert.equal(providerList().some(provider => provider.id === "browser:mred"), false);
    assert.equal(providerById("lofty")!.availability().available, false);
  });
  it("fixtures are hidden unless switched on", () => {
    const listed = providerList().map(p => p.id);
    if (!providerById("browser:fixture-portal")!.availability().available) assert.ok(!listed.includes("browser:fixture-portal"));
  });
  it("host allowlist matches exact hosts and wildcards only", () => {
    assert.ok(hostAllowed("connectmls3.mredllc.com", ["*.mredllc.com"]));
    assert.ok(hostAllowed("mredllc.com", ["*.mredllc.com"]));
    assert.ok(!hostAllowed("mredllc.com.evil.io", ["*.mredllc.com"]));
    assert.ok(!hostAllowed("evilmredllc.com", ["*.mredllc.com"]));
    assert.ok(!hostAllowed("169.254.169.254", ["*.mredllc.com"]));
  });
});

describe("browser pool (headless Chromium)", { timeout: 120_000 }, () => {
  after(async () => {
    await closeBrowser();
  });

  it("blocks requests to unapproved hosts and always closes the context", async () => {
    const result = await withBrowserPage({ allowedHosts: [], signal: signal(), label: "test", timeoutMs: 30_000 }, async ({ page, blocked }) => {
      await page.setContent('<img src="https://example.com/x.png"><script>fetch("https://169.254.169.254/latest/meta-data").catch(()=>{})</script><p>hi</p>');
      await page.waitForTimeout(500);
      return { text: await page.textContent("p"), blocked: [...blocked] };
    });
    assert.equal(result.text, "hi");
    assert.ok(result.blocked.some(u => u.includes("example.com")));
    assert.ok(result.blocked.some(u => u.includes("169.254.169.254")));
    assert.equal(openContexts.size, 0);
  });

  it("closes the context after an error", async () => {
    await assert.rejects(withBrowserPage({ allowedHosts: [], signal: signal(), label: "test" }, async () => { throw new Error("boom"); }), /boom/);
    assert.equal(openContexts.size, 0);
  });

  it("times out and cleans up", async () => {
    await assert.rejects(
      withBrowserPage({ allowedHosts: [], signal: signal(), label: "slow", timeoutMs: 10_000 }, () => new Promise(r => setTimeout(r, 20_000))),
      (e: unknown) => e instanceof ProviderError && e.retryable,
    );
    assert.equal(openContexts.size, 0);
  });

  it("cancellation closes the browser context", async () => {
    const c = new AbortController();
    setTimeout(() => c.abort(), 300);
    await assert.rejects(withBrowserPage({ allowedHosts: [], signal: c.signal, label: "cancel" }, async ({ page }) => { await page.setContent("<p>x</p>"); await page.waitForTimeout(10_000); }), CancelledError);
    assert.equal(openContexts.size, 0);
  });

  it("fixture portal: extracts, normalizes, dedupes and ignores injected instructions", async () => {
    const logs: string[] = [];
    const raw = await fixturePortalAdapter.collect({
      subject: { address: "851 N Eagle St", zip: "60563", propertyType: "single_family", beds: 3, baths: 2, sqft: 2000, lat: 41.77, lng: -88.15, askingPrice: 520000 },
      params: { radiusMi: 5, soldWithinDays: 180, propertyTypes: ["single_family"], statuses: ["sold", "active", "pending"], provider: "browser:fixture-portal" },
      signal: signal(),
      log: async (_level, m) => void logs.push(m),
      progress: async () => {},
    });
    assert.equal(raw.length, 14);
    const { comps, rejected, duplicates } = normalizeBatch(raw);
    assert.equal(duplicates, 1);
    assert.equal(rejected.length, 1);
    assert.equal(comps.length, 12);
    assert.ok(comps.every(c => !String(c.soldPrice).includes("9999999")));
    assert.ok(comps.filter(c => c.status === "sold").length >= 8);
    assert.ok(logs.some(l => /Blocked 1 request/.test(l)), logs.join("|"));
    assert.equal(openContexts.size, 0);
  });
});

describe("MRED visible results", () => {
  after(closeBrowser);
  it("finds the visible Search navigation when the toolbar uses an icon or tab", async () => {
    await withBrowserPage({ allowedHosts: [], signal: signal(), label: "mred-local-navigation" }, async ({ page }) => {
      await page.setContent('<button hidden>Search</button><button title="Search"><span aria-hidden="true">⌕</span></button>');
      assert.equal(await mredSearchControl(page.mainFrame()).getAttribute("title"), "Search");
      await page.setContent('<div role="tab" aria-label="Search">Search</div>');
      assert.equal(await mredSearchControl(page.mainFrame()).getAttribute("role"), "tab");
    });
  });

  it("follows General Search and selects Attached Single in Cross Property", async () => {
    const origin = "https://mred.connectmls.com";
    await withBrowserPage({ allowedHosts: ["mred.connectmls.com"], signal: signal(), label: "mred-local-general-search" }, async ({ context, page }) => {
      const pages: Record<string, string> = {
        "/": '<nav><button>Search</button><a href="/general">General Search</a></nav>',
        "/general": '<a href="/cross">Cross Property (Res)</a>',
        "/cross": '<label>Property Type <select><option>Detached Single</option><option>Attached Single</option></select></label>',
      };
      await context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html", body: pages[new URL(route.request().url()).pathname] ?? "" }));
      await page.goto(origin);
      assert.equal(await openResidentialSearch(page, true, signal()), "General Search / Cross Property");
      assert.equal(await page.getByRole("combobox", { name: "Property Type" }).inputValue(), "Attached Single");
    });
  });

  it("uses the General Search location form directly and leaves street number open", async () => {
    const origin = "https://mred.connectmls.com";
    await withBrowserPage({ allowedHosts: ["mred.connectmls.com"], signal: signal(), label: "mred-local-location-search" }, async ({ context, page }) => {
      const pages: Record<string, string> = {
        "/": '<nav><button>Search</button><a href="/general">General Search</a></nav>',
        "/general": '<label>State <select><option value="WI">Wisconsin</option><option value="IL">Illinois</option></select></label><label>City <input></label><label>Street Number <input></label>',
      };
      await context.route(`${origin}/**`, route => route.fulfill({ contentType: "text/html", body: pages[new URL(route.request().url()).pathname] ?? "" }));
      await page.goto(origin);
      assert.equal(await openResidentialSearch(page, true, signal()), "General Search / location filters");
      assert.equal(await applyMredLocationFilters(page, "Wheeling", "IL", signal()), page.mainFrame());
      assert.equal(await page.getByLabel("State").inputValue(), "IL");
      assert.equal(await page.getByLabel("City").inputValue(), "Wheeling");
      assert.equal(await page.getByLabel("Street Number").inputValue(), "");
    });
  });

  it("recognizes the MRED home and distinguishes credential rejection", () => {
    assert.equal(mredLoginOutcome(new URL("https://mred.connectmls.com/mls/home/home.jsp")), "home");
    assert.equal(mredLoginOutcome(new URL("https://mred.connectmls.com/login.jsp?error=CREDENTIALS")), "credentials");
    assert.equal(mredLoginOutcome(new URL("https://connectmls-api.mredllc.com/oid/login")), "login");
    assert.equal(mredLoginOutcome(new URL("https://other.connectmls.com/mls/home/home.jsp")), "other");
    assert.equal(mredLoginOutcome(new URL("https://mred-sso.connectmls.com/mls/home/home.jsp")), "other");
  });

  it("allows the MRED connectMLS host without allowing other connectMLS portals", () => {
    assert.ok(hostAllowed("mred.connectmls.com", mredAdapter.allowedHosts));
    assert.ok(hostAllowed("connectmls-api.mredllc.com", mredAdapter.allowedHosts));
    assert.ok(hostAllowed("mred-sso.connectmls.com", mredAdapter.allowedHosts));
    assert.ok(!hostAllowed("mred-sso.connectmls.com.example.org", mredAdapter.allowedHosts));
    assert.ok(!hostAllowed("other.connectmls.com", mredAdapter.allowedHosts));
  });

  it("maps supported column names and rejects out-of-area or off-market rows", () => {
    const rows = visibleMredRows([
      ["MLS #", "Status", "Address", "ZIP Code", "Sold Price", "Closed Date", "DOM"],
      ["1234", "CLSD", "10 Main St", "60090", "300000", "2026-11-10", "9"],
      ["2345", "CLSD", "12 Main St", "60091", "305000", "2026-11-10", "9"],
      ["3456", "Cancelled", "14 Main St", "60090", "", "", "12"],
    ], "60090");
    assert.equal(rows?.length, 1);
    assert.deepEqual(rows?.[0], { sourceRecordId: "1234", status: "sold", address: "10 Main St", zip: "60090", soldPrice: "300000", soldDate: "2026-11-10", daysOnMarket: "9" });
  });

  it("preserves missing ZIP on a city-wide search rather than assuming a ZIP filter", () => {
    const table = [["Address", "Status", "List Price"], ["10 Main St", "Active", "300000"]];
    assert.equal(visibleMredRows(table, "60090", false)?.[0]?.zip, undefined);
  });

  it("rejects a layout missing required comparable fields", () => {
    assert.equal(visibleMredRows([["MLS #", "Address"], ["1234", "10 Main St"]], "60090"), null);
  });
});
