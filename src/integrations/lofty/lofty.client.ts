// Lofty CRM Open API (v1.0), READ-ONLY. Was convex/lofty.ts through Viktor's "custom_api_lofty_crm_*"
// tools; now called directly with the team's API key (LOFTY_API_KEY). Policy (2026-11-26): the Hub never
// writes to Michael's CRM, so this client only sends GET requests; there is no way to POST/PUT here.
import { config } from "../../config/index.js";

export class LoftyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
  /** Lofty rejected the key (expired / regenerated / wrong). */
  get isAuth() {
    return this.status === 401 || this.status === 403 || /200136|token/i.test(this.message);
  }
}

type Json = Record<string, unknown>;

/** GET a Lofty endpoint. Read-only by design: no method or body parameter exists. */
export async function lofty<T = Json>(path: string): Promise<T> {
  if (!config.lofty.key) throw new LoftyError("LOFTY_API_KEY is not set");
  const method = "GET";
  const res = await fetch(`${config.lofty.url}${path}`, {
    method,
    headers: { Authorization: `token ${config.lofty.key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new LoftyError(`Lofty ${method} ${path.split("?")[0]} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`, res.status);
  return data as T;
}

export type LoftyMember = { id: number; email?: string; firstName?: string; lastName?: string };
export type LoftyLead = { id: number; emails?: string[]; phones?: string[] };

export async function members(): Promise<LoftyMember[]> {
  return (await lofty<{ members?: LoftyMember[] }>("/v1.0/members?limit=100")).members ?? [];
}

const norm = (x: string) => x.toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/** Lofty member emails often differ from the Hub's, so match by email first, then first + last name. */
export function matchMember(list: LoftyMember[], email: string, name: string): number | undefined {
  const byEmail = list.find(m => (m.email ?? "").toLowerCase() === email.toLowerCase());
  if (byEmail) return byEmail.id;
  const a = norm(name).split(" ");
  if (!a[0]) return undefined;
  return list.find(m => {
    const mt = norm(`${m.firstName ?? ""} ${m.lastName ?? ""}`).split(" ");
    if (!mt[0]) return false;
    const firstOk = mt[0].startsWith(a[0]!) || a[0]!.startsWith(mt[0]);
    const lastOk = a.includes(mt[mt.length - 1]!) || mt.includes(a[a.length - 1]!);
    return firstOk && lastOk;
  })?.id;
}

export const digits10 = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

/** An existing lead by exact email, else by 10-digit phone. Search rows carry leadId, not id. */
export async function findLead(email?: string | null, phone?: string | null): Promise<LoftyLead | undefined> {
  type Row = { leadId?: number; id?: number; emails?: string[] };
  if (email) {
    const want = email.trim().toLowerCase();
    const b = await lofty<{ leads?: Row[] }>(`/v1.0/leads?email=${encodeURIComponent(want)}&limit=5`);
    const hit = (b.leads ?? []).find(x => (x.emails ?? []).some(e => e.trim().toLowerCase() === want));
    if (hit) return { ...hit, id: (hit.leadId ?? hit.id)! };
  }
  const d = digits10(phone);
  if (d.length === 10) {
    const hit = (await lofty<{ leads?: Row[] }>(`/v1.0/leads?phone=${d}&limit=5`)).leads?.[0];
    if (hit) return { ...hit, id: (hit.leadId ?? hit.id)! };
  }
  return undefined;
}
