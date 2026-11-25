// End-to-end test for the listings module. Usage (from backend/): start the API with MAIL_MODE=off, then
//   node tests/listings.e2e.mjs http://localhost:4000
// Creates throwaway zz-e2e-* accounts and listings and deletes everything it creates. Never run against production.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
require("dotenv").config({ quiet: true });
const pg = require("postgres"); const postgres = pg.default ?? pg;

const API = process.argv[2] ?? "http://localhost:4000";
const ORIGIN = "http://localhost:5173";
const DOMAIN = (process.env.AUTH_ALLOWED_DOMAINS ?? "linchpin.net").split(",")[0].trim();
const ts = Date.now();
const AGENT = `zz-e2e-agent-${ts}@${DOMAIN}`;
const OTHER = `zz-e2e-other-${ts}@${DOMAIN}`;
const OPS = `zz-e2e-ops-${ts}@${DOMAIN}`;
const PW = "Test-password-123";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: "require" });

let failures = 0;
const created = []; // listing ids, for cleanup
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };

async function call(method, path, body, cookie) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, json, cookie: setCookie.map(c => c.split(";")[0]).join("; ") };
}
const fields = r => (r.json?.error?.details ?? []).map(d => d.path).join(",");

async function account(email, name, role) {
  await call("POST", "/api/v1/auth/sign-up/email", { name, email, password: PW });
  await sql`update users set email_verified = true, role = ${role} where email = ${email}`;
  const r = await call("POST", "/api/v1/auth/sign-in/email", { email, password: PW });
  if (r.status !== 200) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.cookie;
}

try {
  const agent = await account(AGENT, "Zz Agent", "agent");
  const other = await account(OTHER, "Zz Other", "agent");
  const ops = await account(OPS, "Zz Ops", "ops");
  const [otherUser] = await sql`select id from users where email = ${OTHER}`;

  // ---------- Auth ----------
  let r = await call("GET", "/api/v1/listings");
  check("signed-out list is refused", r.status === 401, `status ${r.status}`);

  // ---------- Create: validation ----------
  r = await call("POST", "/api/v1/listings", { address: "", sellerName: "" }, agent);
  check("empty form is refused with field errors", r.status === 400 && fields(r).includes("address") && fields(r).includes("sellerName"), fields(r));
  r = await call("POST", "/api/v1/listings", { address: "1234 N Main St", sellerName: "Jane Doe", mlsNumber: "12ab", priceCents: "abc", sellerEmail: "nope", sellerPhone: "555-12", }, agent);
  check("bad MLS / price / email / phone are refused", r.status === 400 && ["mlsNumber", "priceCents", "sellerEmail", "sellerPhone"].every(f => fields(r).includes(f)), fields(r));
  r = await call("POST", "/api/v1/listings", { address: "Main Street", sellerName: "Jane Doe" }, agent);
  check("address without a house number is refused", r.status === 400 && fields(r).includes("address"), fields(r));
  r = await call("POST", "/api/v1/listings", { address: "1234 N Main St", sellerName: "J4ne" }, agent);
  check("seller name with digits is refused", r.status === 400 && fields(r).includes("sellerName"), fields(r));
  r = await call("POST", "/api/v1/listings", { address: "1234 N Main St", sellerName: "Jane", agentUserId: otherUser.id }, agent);
  check("agent can't create a listing for someone else", r.status === 403, `status ${r.status}`);

  // ---------- Create ----------
  r = await call("POST", "/api/v1/listings", {
    address: "1234 n main st, chicago il 60614", mlsNumber: "12345678", priceCents: 54900000,
    sellerName: "Jane Doe", sellerEmail: "Jane@Example.com", sellerPhone: "312.555.0100",
  }, agent);
  check("create listing", r.status === 201, `status ${r.status} ${JSON.stringify(r.json?.error ?? "")}`);
  const L = r.json;
  created.push(L.id);
  check("address normalised", L.address === "1234 N Main St, Chicago, IL 60614", L.address);
  check("price stored in cents and formatted", L.priceCents === 54900000 && L.price === "$549,000", `${L.priceCents} ${L.price}`);
  check("email lower-cased, phone formatted", L.sellerEmail === "jane@example.com" && L.sellerPhone === "(312) 555-0100", `${L.sellerEmail} ${L.sellerPhone}`);
  check("11 launch steps, status Preparing, 24-char token", L.steps.length === 11 && L.status === "Preparing" && L.token.length === 24);
  const [jobs] = await sql`select count(*)::int as n from jobs where payload->>'listingId' = ${L.id}`;
  check("follow-up jobs queued (Zillow, Reels, ads, YouTube, Lofty, plan)", jobs.n === 6, `${jobs.n} jobs`);

  // ---------- Read ----------
  r = await call("GET", "/api/v1/listings?scope=mine", null, agent);
  check("list shows it to its agent", r.status === 200 && r.json.items.some(x => x.id === L.id) && r.json.me.staff === false);
  r = await call("GET", `/api/v1/listings/${L.id}`, null, other);
  check("another agent can't open it", r.status === 404, `status ${r.status}`);
  r = await call("GET", "/api/v1/listings?scope=all", null, ops);
  check("ops sees the whole team", r.status === 200 && r.json.items.some(x => x.id === L.id) && r.json.me.staff === true);
  r = await call("GET", `/api/v1/listings/${L.id}`, null, ops);
  check("ops can open it", r.status === 200 && r.json.listing.id === L.id && typeof r.json.thisWeek === "string");
  r = await call("GET", "/api/v1/listings/agents", null, agent);
  check("agent list is admin/ops only", r.status === 403, `status ${r.status}`);
  r = await call("GET", "/api/v1/listings/agents", null, ops);
  check("ops gets the agent list", r.status === 200 && r.json.items.some(a => a.email === OTHER));
  r = await call("GET", "/api/v1/listings/pick", null, agent);
  check("picker returns split address", r.status === 200 && r.json.items[0]?.street === "1234 N Main St" && r.json.items[0]?.zip === "60614", JSON.stringify(r.json.items?.[0] ?? {}).slice(0, 120));

  // ---------- Update ----------
  r = await call("PATCH", `/api/v1/listings/${L.id}`, { priceCents: 52500000, status: "Active", liveDate: "2026-11-01", links: { zillow: "https://www.zillow.com/x", reel: "http://insecure" } }, agent);
  check("http:// link is refused", r.status === 400 && fields(r) === "links.reel", fields(r));
  r = await call("PATCH", `/api/v1/listings/${L.id}`, { status: "Sold" }, agent);
  check("unknown status is refused", r.status === 400 && fields(r) === "status", fields(r));
  r = await call("PATCH", `/api/v1/listings/${L.id}`, { liveDate: "2030-01-01" }, agent);
  check("live date over a year ahead is refused", r.status === 400 && fields(r) === "liveDate", fields(r));
  r = await call("PATCH", `/api/v1/listings/${L.id}`, { priceCents: 52500000, status: "Active", liveDate: "2026-11-01", links: { zillow: "https://www.zillow.com/x" } }, agent);
  check("edit details", r.status === 200 && r.json.price === "$525,000" && r.json.status === "Active" && r.json.links.zillow === "https://www.zillow.com/x", JSON.stringify(r.json?.error ?? ""));
  r = await call("GET", `/api/v1/listings/${L.id}`, null, agent);
  check("price change logged as an event", r.json.events.some(e => e.kind === "price" && e.title === "Price updated to $525,000"));
  r = await call("PATCH", `/api/v1/listings/${L.id}`, { sellerEmail: "", weeklyEmail: true }, agent);
  check("weekly email needs a seller email", r.status === 400, `status ${r.status}`);
  r = await call("PATCH", `/api/v1/listings/${L.id}`, { weeklyEmail: true }, agent);
  check("weekly email on", r.status === 200 && r.json.weeklyEmail === true);

  // ---------- Steps ----------
  r = await call("PATCH", `/api/v1/listings/${L.id}/steps/nope`, { done: true }, agent);
  check("unknown step is refused", r.status === 400, `status ${r.status}`);
  r = await call("PATCH", `/api/v1/listings/${L.id}/steps/media`, { done: true }, agent);
  check("tick a launch step", r.status === 200 && r.json.steps.find(s => s.key === "media").done && r.json.steps.find(s => s.key === "media").doneAt);

  // ---------- Weekly numbers ----------
  const thisWeek = (await call("GET", `/api/v1/listings/${L.id}`, null, agent)).json.thisWeek;
  r = await call("PUT", `/api/v1/listings/${L.id}/metrics/${thisWeek}`, { zillowViews: -1, mlsSaved: 1.5 }, agent);
  check("negative / decimal numbers are refused", r.status === 400 && fields(r).includes("zillowViews") && fields(r).includes("mlsSaved"), fields(r));
  r = await call("PUT", `/api/v1/listings/${L.id}/metrics/2026-11-25`, { zillowViews: 1 }, agent);
  check("week must start on a Monday", r.status === 400, `status ${r.status}`);
  r = await call("PUT", `/api/v1/listings/${L.id}/metrics/${thisWeek}`, { zillowViews: 420, zillowSaves: 5, mlsSaved: 3, tiktokLink: "https://tiktok.com/@x/1" }, agent);
  check("save weekly numbers", r.status === 200 && r.json.metrics.some(m => m.weekOf === thisWeek && m.zillowViews === 420));
  r = await call("PUT", `/api/v1/listings/${L.id}/metrics/${thisWeek}`, { zillowViews: 430, zillowSaves: 6, mlsSaved: 3 }, agent);
  check("re-save the same week updates it", r.status === 200 && r.json.metrics.filter(m => m.weekOf === thisWeek).length === 1 && r.json.metrics[0].zillowViews === 430);

  // ---------- Activity ----------
  r = await call("POST", `/api/v1/listings/${L.id}/events`, { kind: "update", title: "" }, agent);
  check("event without a title is refused", r.status === 400 && fields(r) === "title", fields(r));
  r = await call("POST", `/api/v1/listings/${L.id}/events`, { kind: "offer", title: "Offer received: $520,000", body: "30-day close" }, agent);
  check("post an update", r.status === 201 && r.json.status === "published");
  const evId = r.json.id;
  r = await call("POST", `/api/v1/listings/${L.id}/events/showingtime`, { kind: "feedback", address: "1234 N Main St", answers: [], interest: "Somewhat", comments: "Nice but small", buyerAgent: "Bob (Acme)" }, agent);
  check("pasted ShowingTime feedback waits for review", r.status === 201 && r.json.status === "pending" && r.json.agentOnly?.includes("Bob"));
  const fbId = r.json.id;
  r = await call("PATCH", `/api/v1/listings/events/${fbId}`, { status: "published", body: "Buyers liked it" }, agent);
  check("publish feedback with an edited comment", r.status === 200 && r.json.status === "published" && r.json.body === "Buyers liked it");
  r = await call("PATCH", `/api/v1/listings/events/${evId}`, { status: "hidden" }, other);
  check("another agent can't change it", r.status === 404, `status ${r.status}`);
  r = await call("DELETE", `/api/v1/listings/events/${evId}`, null, agent);
  check("delete an event", r.status === 200);

  // ---------- Suggestions ----------
  r = await call("POST", `/api/v1/listings/${L.id}/suggestions/refresh`, null, agent);
  check("rules add drafts from the numbers", r.status === 200 && r.json.added >= 1, JSON.stringify(r.json));
  r = await call("POST", `/api/v1/listings/${L.id}/suggestions`, { title: "", why: "", action: "" }, agent);
  check("suggestion without a title is refused", r.status === 400, `status ${r.status}`);
  r = await call("POST", `/api/v1/listings/${L.id}/suggestions`, { title: "Stage the second bedroom", why: "Feedback", action: "Bring in staging" }, agent);
  check("add your own suggestion", r.status === 201 && r.json.status === "draft" && r.json.ruleKey === "custom");
  const sId = r.json.id;
  r = await call("PATCH", `/api/v1/listings/suggestions/${sId}`, { title: "Stage both bedrooms", status: "published" }, agent);
  check("edit + publish suggestion", r.status === 200 && r.json.status === "published" && r.json.title === "Stage both bedrooms");
  r = await call("GET", `/api/v1/listings/${L.id}/suggestions`, null, agent);
  check("suggestions list (with stillTrue)", r.status === 200 && r.json.items.some(s => s.id === sId && s.stillTrue === true));

  // ---------- Seller portal ----------
  r = await call("GET", `/api/v1/portal/${L.token}`);
  check("seller portal opens without login", r.status === 200 && r.json.address.startsWith("1234 N Main St") && r.json.sellerFirstName === "Jane");
  check("portal hides pending/hidden items and agent-only notes", !JSON.stringify(r.json).includes("Bob (Acme)") && r.json.suggestions.length === 1);
  check("portal never exposes the token or seller contact", !JSON.stringify(r.json).includes(L.token) && !JSON.stringify(r.json).includes("jane@example.com"));
  r = await call("POST", `/api/v1/portal/${L.token}/seen`);
  const [seen] = await sql`select seller_last_seen_at from listings where id = ${L.id}`;
  check("seller seen recorded", r.status === 200 && seen.seller_last_seen_at !== null);
  r = await call("POST", `/api/v1/portal/${L.token}/approve-plan`);
  r = await call("GET", `/api/v1/portal/${L.token}`);
  check("seller approves the plan", r.json.suggestions.every(s => s.approvedAt) && r.json.events.some(e => e.kind === "approval"));
  r = await call("GET", "/api/v1/portal/short");
  check("bad token → 404", r.status === 404, `status ${r.status}`);

  // ---------- Rotate + delete ----------
  r = await call("POST", `/api/v1/listings/${L.id}/rotate-link`, null, agent);
  check("reset link", r.status === 200 && r.json.token !== L.token);
  r = await call("GET", `/api/v1/portal/${L.token}`);
  check("old link stops working", r.status === 404, `status ${r.status}`);

  // ---------- Staff creates for another agent ----------
  r = await call("POST", "/api/v1/listings", { address: "50 W Elm St", sellerName: "Sam Lee", agentUserId: otherUser.id }, ops);
  check("ops creates a listing for another agent", r.status === 201 && r.json.agentEmail === OTHER && r.json.agentName === "Zz Other", JSON.stringify(r.json?.error ?? r.json?.agentEmail));
  const L2 = r.json.id;
  created.push(L2);
  r = await call("GET", `/api/v1/listings/${L2}`, null, other);
  check("that agent can open it", r.status === 200);

  for (const id of [L.id, L2]) {
    r = await call("DELETE", `/api/v1/listings/${id}`, null, id === L.id ? agent : ops);
    check(`delete listing ${id === L.id ? "(agent)" : "(ops)"}`, r.status === 200);
  }
  const [left] = await sql`select (select count(*) from listing_events where listing_id = ${L.id})::int + (select count(*) from listing_metrics where listing_id = ${L.id})::int + (select count(*) from listing_suggestions where listing_id = ${L.id})::int as n`;
  check("events, metrics and suggestions deleted with it", left.n === 0, `${left.n} left`);
} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  const emails = [AGENT, OTHER, OPS];
  const ids = [...new Set([...created, ...(await sql`select id from listings where agent_email in ${sql(emails)}`).map(r => r.id)])];
  if (ids.length) {
    await sql`delete from jobs where payload->>'listingId' in ${sql(ids)}`;
    await sql`delete from listings where id in ${sql(ids)}`;
  }
  await sql`delete from jobs where payload->>'email' in ${sql(emails)}`;
  await sql`delete from users where email in ${sql(emails)}`;
  await sql.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
