// Uses the visible connectMLS search and List View. Credentials stay in the worker.
import type { Frame, Locator, Page } from "playwright-core";
import { config } from "../../../../config/index.js";
import { mapHeaders } from "../../engine/csv.js";
import { parseStatus, type RawComparable } from "../../engine/normalize.js";
import { ProviderError, throwIfAborted } from "../provider.types.js";
import { detectBlock, hostAllowed, withBrowserPage } from "./browser-pool.js";
import type { BrowserAdapter } from "./browser.provider.js";

const START = "https://mred.connectmls.com/login.jsp";
const HOME_HOST = new URL(START).hostname;
const ALLOWED = [HOME_HOST, "mred-sso.connectmls.com", "*.mredllc.com"];
const MAX_ROWS = 100;
const TIMEOUT = 12_000;

function blocked(message: string) {
  return new ProviderError(message, { blocked: true, agentMessage: message });
}

async function visible(locator: Locator, message: string) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: TIMEOUT });
  } catch {
    throw blocked(message);
  }
  return locator.first();
}

export function mredLoginOutcome(url: URL) {
  if (url.searchParams.get("error")?.toUpperCase() === "CREDENTIALS") return "credentials";
  if (url.protocol === "https:" && url.hostname === HOME_HOST &&
      /^(?:\/mls)(?:\/|$)/i.test(url.pathname) && !/login/i.test(url.pathname)) return "home";
  if (/\/(?:ssologin|login)(?:\.jsp|\/|$)/i.test(url.pathname)) return "login";
  return "other";
}

function requestedHosts(urls: string[]) {
  return [...new Set(urls.flatMap(value => {
    try { return [new URL(value).hostname]; } catch { return []; }
  }))].slice(0, 8);
}

async function login(page: Page, signal: AbortSignal, blockedRequests: string[], log: (message: string) => Promise<void>) {
  const { username, password } = config.cmaBuilder.mred;
  if (!username || !password) throw blocked("The MRED login isn't set up.");
  await page.goto(START, { waitUntil: "domcontentloaded" });
  const members = await visible(page.getByRole("button", { name: /^mred members\b/i }), "MRED member login entry was unavailable.");
  await members.click({ timeout: TIMEOUT });
  const wall = await detectBlock(page);
  if (wall) throw blocked(`MRED requested a ${wall}. Complete verification directly in connectMLS.`);
  const passwordInput = await visible(page.locator('input[type="password"]:visible'), "MRED did not display the expected password form.");
  const usernameInput = await visible(page.locator('input[autocomplete="username"]:visible, input[type="email"]:visible, input[type="text"]:visible'), "MRED did not display the expected username field.");
  throwIfAborted(signal);
  try {
    await usernameInput.fill(username, { timeout: TIMEOUT });
    await passwordInput.fill(password, { timeout: TIMEOUT });
  } catch {
    throwIfAborted(signal);
    throw blocked("MRED credentials could not be entered into the visible form.");
  }
  const beforeSubmit = blockedRequests.length;
  await (await visible(page.getByRole("button", { name: /^(log\s*in|sign\s*in)$/i }), "MRED did not display a sign-in button.")).click({ timeout: TIMEOUT });
  try {
    await page.waitForURL(url => ["home", "credentials"].includes(mredLoginOutcome(url)), { timeout: 30_000, waitUntil: "domcontentloaded" });
    if (mredLoginOutcome(new URL(page.url())) === "home") return;
  } catch {
    throwIfAborted(signal);
  }

  const destination = new URL(page.url());
  const outcome = mredLoginOutcome(destination);
  if (outcome === "home") return;
  const challenge = await detectBlock(page).catch(() => null);
  const passwordChange = await page.getByText(/password (has )?expired|change your password|password change required/i).first().isVisible().catch(() => false);
  const invalid = outcome === "credentials" || await page.getByText(/invalid (username|password|credentials)|incorrect (username|password)|invalid user id/i).first().isVisible().catch(() => false);
  const hosts = requestedHosts(blockedRequests.slice(beforeSubmit));
  await log(`MRED sign-in ended on ${destination.hostname || "a browser error page"} (${outcome === "login" ? "login screen" : outcome}). Blocked request hosts after submission: ${hosts.join(", ") || "none recorded"}.`);
  if (challenge) throw blocked(`MRED requested a ${challenge}. Complete verification directly in connectMLS.`);
  if (passwordChange) throw blocked("MRED prompted for a password change. Complete it directly in connectMLS.");
  if (invalid) throw blocked("MRED displayed a credential rejection after one submission.");
  throw blocked("MRED sign-in could not be confirmed after one submission. See MRED collection activity for the destination and blocked hosts.");
}

function portalFrames(page: Page): Frame[] {
  return page.frames().filter(frame => {
    try {
      const url = new URL(frame.url());
      return url.protocol === "https:" && hostAllowed(url.hostname, ALLOWED);
    } catch {
      return false;
    }
  });
}

const searchLabel = /^(search|property search|listing search|search listings)(?: menu)?$/i;
export function mredSearchControl(frame: Frame): Locator {
  return frame.getByRole("link", { name: searchLabel })
    .or(frame.getByRole("button", { name: searchLabel }))
    .or(frame.getByRole("menuitem", { name: searchLabel }))
    .or(frame.getByRole("tab", { name: searchLabel }))
    .or(frame.getByTitle(searchLabel))
    .or(frame.getByText(/^search$/i))
    .filter({ visible: true }).first();
}

async function portalControl(page: Page, find: (frame: Frame) => Locator, signal: AbortSignal, timeout = TIMEOUT): Promise<Locator | undefined> {
  const until = Date.now() + timeout;
  do {
    throwIfAborted(signal);
    for (const frame of portalFrames(page)) {
      const locator = find(frame).filter({ visible: true }).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await page.waitForTimeout(250);
  } while (Date.now() < until);
}

const generalSearchLabel = /^general search$/i;
const crossPropertyLabel = /^cross[ -]property\s*(?:\(res\)|residential)$/i;

function searchOption(frame: Frame, name: RegExp): Locator {
  return frame.getByRole("link", { name }).or(frame.getByRole("menuitem", { name }))
    .or(frame.getByRole("button", { name })).or(frame.getByRole("tab", { name }))
    .or(frame.getByText(name, { exact: true }));
}

const cityField = /^(city|municipality)$/i;
const stateField = /^(state|state or province)$/i;
function locationControl(frame: Frame, name: RegExp) {
  return frame.getByRole("textbox", { name }).or(frame.getByRole("combobox", { name })).or(frame.getByLabel(name));
}

function generalLocationForm(frame: Frame) {
  return locationControl(frame, cityField);
}

export async function openResidentialSearch(page: Page, attached: boolean, signal: AbortSignal) {
  const label = attached ? "Attached Single" : "Detached Single";
  const classLabel = attached ? /^attached single(?: family)?$/i : /^detached single(?: family)?$/i;
  const direct = (frame: Frame) => searchOption(frame, classLabel);
  const general = (frame: Frame) => searchOption(frame, generalSearchLabel);
  const entry = (frame: Frame) => direct(frame).or(general(frame));
  let option = await portalControl(page, entry, signal, 250);
  if (!option) {
    const search = await portalControl(page, mredSearchControl, signal);
    if (!search) throw blocked("MRED sign-in succeeded, but the Search navigation was not visible on the home page or its portal frames.");
    await search.hover({ timeout: TIMEOUT });
    option = await portalControl(page, entry, signal, 1500);
    if (!option) {
      await search.click({ timeout: TIMEOUT });
      option = await portalControl(page, entry, signal);
    }
  }
  const directOption = await portalControl(page, direct, signal, 250);
  if (directOption) {
    await directOption.click({ timeout: TIMEOUT });
    return "direct residential search";
  }

  if (!option) throw blocked("MRED Search opened, but neither General Search nor the requested residential option was visible.");
  await option.click({ timeout: TIMEOUT });

  const residentialOption = await portalControl(page, frame => direct(frame)
    .or(searchOption(frame, crossPropertyLabel)).or(generalLocationForm(frame)), signal);
  if (!residentialOption) throw blocked("MRED General Search opened, but neither the residential options nor the City filter was visible.");
  const directResidentialOption = await portalControl(page, direct, signal, 250);
  if (directResidentialOption) {
    await directResidentialOption.click({ timeout: TIMEOUT });
    return "General Search";
  }

  const crossProperty = await portalControl(page, frame => searchOption(frame, crossPropertyLabel), signal, 250);
  if (!crossProperty) return "General Search / location filters";

  await crossProperty.click({ timeout: TIMEOUT });
  const typedInput = (frame: Frame) => frame.getByRole("checkbox", { name: classLabel })
    .or(frame.getByRole("radio", { name: classLabel }));
  const propertyType = await portalControl(page, typedInput, signal, 1500);
  if (propertyType) {
    await propertyType.check({ timeout: TIMEOUT });
    return "General Search / Cross Property";
  }

  const control = await portalControl(page, frame => frame.getByRole("combobox", { name: /^(property type|property types)$/i }), signal);
  if (!control) throw blocked(`MRED Cross Property search opened, but the ${label} filter could not be located.`);
  if (await control.evaluate(element => element.tagName === "SELECT")) {
    const options = await control.locator("option").allTextContents();
    const match = options.find(text => classLabel.test(text.trim()));
    if (!match) throw blocked(`MRED Cross Property search did not offer ${label}.`);
    await control.selectOption({ label: match.trim() }, { timeout: TIMEOUT });
    return "General Search / Cross Property";
  }

  await control.click({ timeout: TIMEOUT });
  const type = await portalControl(page, frame => frame.getByRole("option", { name: classLabel }), signal);
  if (!type) throw blocked(`MRED Cross Property search did not offer a selectable ${label} option.`);
  if (await type.getAttribute("aria-selected") !== "true") await type.click({ timeout: TIMEOUT });
  return "General Search / Cross Property";
}

export async function applyMredLocationFilters(page: Page, city: string, state: string, signal: AbortSignal) {
  const stateNames = state.toUpperCase() === "IL" ? ["il", "illinois"] : [state.toLowerCase()];
  const stateInput = await portalControl(page, frame => locationControl(frame, stateField), signal);
  if (!stateInput) throw blocked("MRED location search is visible, but the State filter could not be located.");
  if (await stateInput.evaluate(element => element.tagName === "SELECT")) {
    const options = await stateInput.locator("option").evaluateAll(elements => elements.map(option => ({
      label: (option as HTMLOptionElement).label, value: (option as HTMLOptionElement).value,
    })));
    const match = options.find(option => stateNames.includes(option.label.trim().toLowerCase()) || stateNames.includes(option.value.trim().toLowerCase()));
    if (!match) throw blocked("MRED State filter did not offer the listing’s state.");
    await stateInput.selectOption({ value: match.value }, { timeout: TIMEOUT });
  } else {
    const text = stateNames.at(-1) ?? state;
    const editable = await stateInput.evaluate(element => element.matches("input:not([readonly]), textarea:not([readonly])"));
    if (editable) await stateInput.fill(text, { timeout: TIMEOUT });
    else await stateInput.click({ timeout: TIMEOUT });
    const stateOption = await portalControl(page, frame => frame.getByRole("option", { name: new RegExp(`^(?:${stateNames.join("|")})$`, "i") }), signal, 1500);
    if (stateOption) await stateOption.click({ timeout: TIMEOUT });
    else if (editable) await stateInput.press("Tab", { timeout: TIMEOUT });
    else throw blocked("MRED State filter did not expose a selectable state.");
  }

  const cityInput = await portalControl(page, generalLocationForm, signal);
  if (!cityInput) throw blocked("MRED location search is visible, but the City filter could not be located.");
  await cityInput.fill(city, { timeout: TIMEOUT });
  const cityOption = await portalControl(page, frame => frame.getByRole("option", { name: city, exact: true }), signal, 1000);
  if (cityOption) await cityOption.click({ timeout: TIMEOUT });
  else await cityInput.press("Tab", { timeout: TIMEOUT });
  return (await cityInput.elementHandle())?.ownerFrame();
}

export function visibleMredRows(table: string[][], zip: string, zipFiltered = true): RawComparable[] | null {
  const [headers, ...records] = table;
  if (!headers) return null;
  const mapping = mapHeaders(headers.map(header => header.trim() === "MLS #" ? "MLS Number" : header));
  if (mapping.missingRequired.length) return null;
  return records.flatMap(cells => {
    const row: RawComparable = {};
    mapping.columns.forEach(({ field }, index) => {
      if (field && cells[index]?.trim()) row[field] = cells[index]!.trim();
    });
    const status = parseStatus(String(row.status).toLowerCase() === "actv" ? "active" : row.status);
    if (!row.address || !status || status === "off_market") return [];
    if (row.zip && String(row.zip).slice(0, 5) !== zip) return [];
    return [{ ...row, status, zip: row.zip ?? (zipFiltered ? zip : undefined) }];
  });
}

export const mredAdapter: BrowserAdapter = {
  id: "mred",
  label: "MRED connectMLS",
  allowedHosts: ALLOWED,
  isFixture: false,
  redistributable: false,
  availability() {
    const { username, password } = config.cmaBuilder.mred;
    return username && password ? { available: true } : { available: false, reason: "The MRED login isn't set up.", needs: ["CMA_MRED_USERNAME", "CMA_MRED_PASSWORD"] };
  },
  async collect({ subject, params, signal, progress, log }) {
    const zip = subject.zip;
    if (!zip || !/^\d{5}$/.test(zip)) throw blocked("Add the subject's five-digit ZIP code so MRED can be searched.");
    return withBrowserPage({ allowedHosts: ALLOWED, signal, label: "mred" }, async ({ page, blocked: blockedRequests }) => {
      await progress("Signing in to MRED");
      await login(page, signal, blockedRequests, message => log("info", message));
      await log("info", "MRED sign-in confirmed");
      await progress("Opening MRED residential search");
      const attached = subject.propertyType === "townhome" || subject.propertyType === "condo";
      if (!attached && subject.propertyType !== "single_family") throw blocked("This MRED collector supports attached and detached residential searches.");
      const searchRoute = await openResidentialSearch(page, attached, signal);
      await log("info", `MRED search opened via ${searchRoute}`);
      let searchFrame;
      const city = subject.city?.trim();
      const state = subject.state?.trim().toUpperCase();
      const hasCityFilter = city && state && /^[A-Z]{2}$/.test(state)
        ? await portalControl(page, generalLocationForm, signal, 1500)
        : undefined;
      if (hasCityFilter && city && state) {
        searchFrame = await applyMredLocationFilters(page, city, state, signal);
        await log("info", `MRED location filters set to ${city}, ${state}. The street number is open for comparable discovery.`);
      } else {
        const zipInput = await portalControl(page, frame => frame.getByRole("textbox", { name: /^(zip( code)?|postal code)$/i }), signal);
        if (!zipInput) throw blocked("MRED residential search opened, but neither the City nor the ZIP filter could be located.");
        searchFrame = await (await zipInput.elementHandle())?.ownerFrame();
        await zipInput.fill(zip, { timeout: TIMEOUT });
        await zipInput.press("Tab", { timeout: TIMEOUT });
      }
      if (!searchFrame) throw blocked("MRED residential search changed before its filters could be set.");
      const statusOptions = [
        ["sold", /^(sold|closed)$/i], ["active", /^active$/i], ["pending", /^(pending|under contract)$/i],
      ] as const;
      const statusControls = await Promise.all(statusOptions.map(async ([status, name]) => {
        const control = searchFrame.getByRole("checkbox", { name, exact: true }).first();
        return { status, control, visible: await control.isVisible() };
      }));
      if (statusControls.every(option => option.visible)) {
        for (const option of statusControls) {
          await option.control.setChecked(params.statuses.includes(option.status), { timeout: TIMEOUT });
        }
      } else {
        await log("warn", "MRED status checkboxes could not be fully identified. Collection uses the visible results and the CMA applies its status and date filters.");
      }
      const results = await visible(searchFrame.getByRole("button", { name: /^(view results|show list)$/i }).or(searchFrame.getByRole("link", { name: /^(view results|show list)$/i })), "MRED search results could not be opened.");
      throwIfAborted(signal);
      await results.click({ timeout: TIMEOUT });
      await progress("Reading the visible MRED listing table");
      const resultsTable = await portalControl(page, frame => frame.locator("table:visible").filter({ has: frame.getByText(/^(MLS\s*#|MLS Number)$/i) }), signal);
      if (!resultsTable) throw blocked("MRED search results opened, but a compatible List View was not visible.");
      const resultsFrame = await (await resultsTable.elementHandle())?.ownerFrame();
      if (!resultsFrame) throw blocked("MRED List View changed before any rows could be read.");
      const tables = await resultsFrame.locator("table:visible").evaluateAll((elements, limit) => elements.map(element =>
        Array.from((element as HTMLTableElement).rows).slice(0, limit + 1).map(row => Array.from(row.cells).map(cell => cell.innerText)),
      ), MAX_ROWS);
      const rows = tables.map(table => visibleMredRows(table, zip, !hasCityFilter)).find((batch): batch is RawComparable[] => Array.isArray(batch) && batch.length > 0);
      if (!rows) throw blocked("MRED sign-in succeeded, but the visible results had no usable rows. Check the List View columns and selected statuses.");
      const coverage = ["sourceRecordId", "soldPrice", "soldDate", "daysOnMarket", "listPrice", "sqft", "beds", "baths"] as const;
      const counts = coverage.map(field => `${field}: ${rows.filter(row => row[field] != null).length}`).join(", ");
      await log("info", `MRED List View provided ${rows.length} candidate row(s). Fields present: ${counts}. Photos and listing history were not collected.`, {
        fields: Object.fromEntries(coverage.map(field => [field, rows.filter(row => row[field] != null).length])),
      });
      return rows;
    }).catch(error => {
      throwIfAborted(signal);
      if (error instanceof ProviderError) throw error;
      throw blocked("MRED browser collection could not complete. Check the last recorded stage and the visible portal controls.");
    });
  },
};
