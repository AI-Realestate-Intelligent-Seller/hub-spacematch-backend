// Headless Chromium for comparable collection. Runs only in the worker process (npm run worker),
// never inside an API request. Each job gets its own isolated browser context (no shared cookies or
// storage), every request leaving the approved hosts is blocked (SSRF / unsafe navigation), downloads
// and pop-ups are refused, and the context is always closed, even on timeout, error or cancel.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { config } from "../../../../config/index.js";
import { logger } from "../../../../utils/logger.js";
import { CancelledError, ProviderError } from "../provider.types.js";

let browser: Browser | undefined;
let launching: Promise<Browser> | undefined;
let active = 0;
const waiting: (() => void)[] = [];
let idleTimer: NodeJS.Timeout | undefined;
/** Open contexts (for tests and shutdown). */
export const openContexts = new Set<BrowserContext>();

/** Running as a serverless function (Vercel or AWS Lambda), where there is no system browser. */
const serverless = () => Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  launching ??= (async () => {
    // Loaded lazily: only report exports and browser sources need a browser.
    const { chromium } = await import("playwright-core");
    const base = ["--disable-dev-shm-usage", "--no-first-run", "--disable-extensions", "--disable-background-networking", "--js-flags=--max-old-space-size=384"];
    let executablePath = config.cmaBuilder.browserExecutable;
    let args = base;
    if (!executablePath && serverless()) {
      // Vercel / AWS Lambda: no system Chromium. @sparticuz/chromium ships one built for that runtime
      // (unpacked to /tmp on first use). Its version matches playwright-core's Chromium (143).
      const sparticuz = (await import("@sparticuz/chromium")).default;
      sparticuz.setGraphicsMode = false;
      // The binary's folder, named file by file so Vercel's file tracing bundles every archive.
      const bin = [
        new URL("../../../../../node_modules/@sparticuz/chromium/bin/chromium.br", import.meta.url),
        new URL("../../../../../node_modules/@sparticuz/chromium/bin/al2023.tar.br", import.meta.url),
        new URL("../../../../../node_modules/@sparticuz/chromium/bin/fonts.tar.br", import.meta.url),
        new URL("../../../../../node_modules/@sparticuz/chromium/bin/swiftshader.tar.br", import.meta.url),
      ];
      const dir = fileURLToPath(new URL(".", bin[0]));
      executablePath = await sparticuz.executablePath(existsSync(fileURLToPath(bin[0]!)) ? dir : undefined);
      // "--single-process" kills the whole browser when one page's context closes, so a warm
      // function's second export would fail; Vercel's memory doesn't need it.
      args = [...sparticuz.args.filter(a => a !== "--single-process"), ...base];
    }
    const b = await chromium.launch({ headless: true, executablePath, args });
    b.on("disconnected", () => {
      browser = undefined;
    });
    browser = b;
    return b;
  })().finally(() => {
    launching = undefined;
  });
  return launching;
}

/** Concurrency limit (CMA_BROWSER_CONCURRENCY): extra jobs wait their turn. */
async function acquire(signal: AbortSignal) {
  if (idleTimer) clearTimeout(idleTimer);
  if (active < config.cmaBuilder.browserConcurrency) {
    active++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const go = () => {
      signal.removeEventListener("abort", stop);
      active++;
      resolve();
    };
    const stop = () => {
      const i = waiting.indexOf(go);
      if (i >= 0) waiting.splice(i, 1);
      reject(new CancelledError());
    };
    waiting.push(go);
    signal.addEventListener("abort", stop, { once: true });
  });
}

function release() {
  active--;
  const next = waiting.shift();
  if (next) next();
  else if (active === 0) {
    // Free the browser's memory when nothing has used it for a minute.
    idleTimer = setTimeout(() => void closeBrowser(), 60_000);
    idleTimer.unref();
  }
}

export async function closeBrowser() {
  const b = browser;
  browser = undefined;
  if (b) await b.close().catch(() => {});
}

/** "connectmls3.mredllc.com" matches "*.mredllc.com" and "mredllc.com". */
export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some(a => {
    const x = a.toLowerCase();
    return x.startsWith("*.") ? h === x.slice(2) || h.endsWith(x.slice(1)) : h === x;
  });
}

export type BrowserSession = { page: Page; context: BrowserContext; blocked: string[] };

/**
 * Runs `fn` with a fresh page in an isolated context. Requests to hosts outside `allowedHosts`
 * are aborted (only https, plus about:/data: for local content). The whole call is limited to
 * `timeoutMs`; cancelling the signal closes the context at once.
 */
export async function withBrowserPage<T>(opts: { allowedHosts: string[]; timeoutMs?: number; signal: AbortSignal; label: string }, fn: (s: BrowserSession) => Promise<T>): Promise<T> {
  await acquire(opts.signal);
  let context: BrowserContext | undefined;
  const timeoutMs = opts.timeoutMs ?? config.cmaBuilder.browserTimeoutMs;
  let timer: NodeJS.Timeout | undefined;
  const blocked: string[] = [];
  const onAbort = () => void context?.close().catch(() => {});
  try {
    const b = await getBrowser();
    context = await b.newContext({
      acceptDownloads: false,
      javaScriptEnabled: true,
      serviceWorkers: "block",
      viewport: { width: 1366, height: 900 },
      userAgent: undefined, // the real headless Chromium UA: no disguise
    });
    openContexts.add(context);
    context.setDefaultTimeout(Math.min(30_000, timeoutMs));
    context.setDefaultNavigationTimeout(Math.min(45_000, timeoutMs));
    await context.route("**/*", route => {
      const url = route.request().url();
      let ok = false;
      try {
        const u = new URL(url);
        ok = u.protocol === "data:" || u.protocol === "about:" || (u.protocol === "https:" && hostAllowed(u.hostname, opts.allowedHosts));
      } catch {
        ok = false;
      }
      if (ok) return route.continue();
      if (blocked.length < 50) blocked.push(url.slice(0, 120));
      return route.abort("blockedbyclient");
    });
    let pages = 0;
    context.on("page", p => {
      // Our own page is the first one; pop-ups and new tabs are closed straight away.
      if (++pages > 1) void p.close().catch(() => {});
    });
    opts.signal.addEventListener("abort", onAbort, { once: true });
    const page = await context.newPage();
    page.on("dialog", d => void d.dismiss().catch(() => {}));
    const run = fn({ page, context, blocked });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError(`${opts.label}: timed out after ${Math.round(timeoutMs / 1000)} s`, { retryable: true, agentMessage: "The data source took too long to answer." })), timeoutMs);
    });
    return await Promise.race([run, timeout]);
  } catch (e) {
    if (opts.signal.aborted) throw new CancelledError();
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal.removeEventListener("abort", onAbort);
    if (context) {
      openContexts.delete(context);
      await context.close().catch(err => logger.warn("cma browser: context close failed", { error: String(err) }));
    }
    release();
  }
}

/** Signs of a bot wall. We never solve or route around these: the job stops and says so. */
export async function detectBlock(page: Page): Promise<string | null> {
  const frames = page.frames().map(f => f.url());
  if (frames.some(u => /recaptcha|hcaptcha|turnstile|captcha|arkoselabs|perimeterx|px-captcha/i.test(u))) return "CAPTCHA";
  const text = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 20_000).toLowerCase();
  if (/verify you are (a )?human|are you a robot|unusual traffic|access denied|press (and|&) hold|captcha/.test(text)) return "bot check";
  if (/new device|verify this device|device verification|too many devices/.test(text)) return "device verification";
  return null;
}
