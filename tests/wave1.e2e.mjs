// End-to-end test for vendors, help requests and email templates. Usage (from backend/):
// start the API with MAIL_MODE=off, then
//   node tests/wave1.e2e.mjs http://localhost:4000
// Creates throwaway zz-e2e-* accounts and rows and deletes everything it creates. Never run against production.
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
const ADMIN = `zz-e2e-admin-${ts}@${DOMAIN}`;
const OPS = `zz-e2e-ops-${ts}@${DOMAIN}`;
const PW = "Test-password-123";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: "require" });

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failures++; };
async function call(method, path, body, cookie) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, cookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ") };
}
const fields = r => (r.json?.error?.details ?? []).map(d => d.path).join(",");
async function account(email, name, role) {
  await call("POST", "/api/v1/auth/sign-up/email", { name, email, password: PW });
  await sql`update users set email_verified = true, role = ${role} where email = ${email}`;
  const r = await call("POST", "/api/v1/auth/sign-in/email", { email, password: PW });
  if (r.status !== 200) throw new Error(`sign-in failed for ${email}: ${r.status}`);
  return r.cookie;
}
const vendorBase = { name: "Pat Lender", company: "Acme Mortgage", category: "Lenders", subcategory: "Jumbo", description: "Fast closes", phone: "(312) 555-0100", email: "pat@acme.com", website: "acme.com", address: null, areas: "Chicago", languages: "English", perk: "10% off", private: false };

try {
  const agent = await account(AGENT, "Zz Agent", "agent");
  const other = await account(OTHER, "Zz Other", "agent");
  const admin = await account(ADMIN, "Zz Admin", "admin");
  const ops = await account(OPS, "Zz Ops", "ops");

  // ================= Vendors =================
  let r = await call("GET", "/api/v1/vendors");
  check("vendors: signed-out is refused", r.status === 401);
  r = await call("POST", "/api/v1/vendors", { ...vendorBase, name: "", phone: null, email: null, website: null }, agent);
  check("vendors: empty name + no contact refused", r.status === 400 && fields(r).includes("name") && fields(r).includes("phone"), fields(r));
  r = await call("POST", "/api/v1/vendors", { ...vendorBase, phone: "555-12", email: "pat@", website: "not a site", category: "Bakers" }, agent);
  check("vendors: bad phone/email/website/category refused", r.status === 400 && ["phone", "email", "website", "category"].every(f => fields(r).includes(f)), fields(r));
  r = await call("POST", "/api/v1/vendors", { ...vendorBase, description: "x".repeat(2001) }, agent);
  check("vendors: description over 2000 refused", r.status === 400 && fields(r) === "description", fields(r));
  r = await call("POST", "/api/v1/vendors", { ...vendorBase, phone: "312.555.0100", email: "PAT@Acme.com" }, agent);
  check("vendors: add", r.status === 201, JSON.stringify(r.json?.error ?? ""));
  const V = r.json;
  check("vendors: phone formatted, email lower-cased, website gets https://", V.phone === "(312) 555-0100" && V.email === "pat@acme.com" && V.website === "https://acme.com", `${V.phone} ${V.email} ${V.website}`);
  r = await call("POST", "/api/v1/vendors", { ...vendorBase, name: "Secret Sam", private: true }, agent);
  const P = r.json;
  r = await call("GET", "/api/v1/vendors", null, other);
  check("vendors: others see team vendors but not private ones", r.json.items.some(x => x.id === V.id) && !r.json.items.some(x => x.id === P.id));
  r = await call("GET", "/api/v1/vendors", null, admin);
  check("vendors: admin sees private ones too", r.json.items.some(x => x.id === P.id) && r.json.viewer.isAdmin === true);
  r = await call("PUT", `/api/v1/vendors/${V.id}`, { ...vendorBase, name: "Hacked" }, other);
  check("vendors: another agent can't edit", r.status === 403, `status ${r.status}`);
  r = await call("PUT", `/api/v1/vendors/${V.id}`, { ...vendorBase, name: "Pat Lender Jr", areas: "" }, agent);
  check("vendors: owner edits (blank clears a field)", r.status === 200 && r.json.name === "Pat Lender Jr" && r.json.areas === null);
  r = await call("PATCH", `/api/v1/vendors/${V.id}/moderation`, { preferred: true }, agent);
  check("vendors: agent can't mark Preferred", r.status === 403);
  r = await call("PATCH", `/api/v1/vendors/${V.id}/moderation`, { preferred: true, onWebsite: false }, admin);
  check("vendors: admin marks Preferred / off website", r.status === 200 && r.json.preferred === true && r.json.onWebsite === false);
  r = await call("PUT", `/api/v1/vendors/${V.id}/rating`, { rating: 6 }, other);
  check("vendors: rating 6 refused", r.status === 400 && fields(r) === "rating");
  r = await call("PUT", `/api/v1/vendors/${V.id}/rating`, { rating: 4, note: "Great" }, other);
  await call("PUT", `/api/v1/vendors/${V.id}/rating`, { rating: 2 }, agent);
  r = await call("GET", "/api/v1/vendors", null, other);
  const rated = r.json.items.find(x => x.id === V.id);
  check("vendors: average rating, my rating, notes", rated.rating === 3 && rated.ratingCount === 2 && rated.myRating === 4 && rated.notes[0]?.note === "Great", JSON.stringify({ r: rated.rating, c: rated.ratingCount, m: rated.myRating }));
  r = await call("GET", "/api/v1/public/pros");
  check("vendors: public list hides off-website and private vendors, no contact details", r.status === 200 && !r.json.items.some(x => x.id === V.id || x.id === P.id) && !JSON.stringify(r.json).includes("acme.com"));
  r = await call("DELETE", `/api/v1/vendors/${V.id}`, null, other);
  check("vendors: another agent can't remove", r.status === 403);
  for (const id of [V.id, P.id]) await call("DELETE", `/api/v1/vendors/${id}`, null, agent);
  const [vleft] = await sql`select count(*)::int as n from vendor_reviews where vendor_id = ${V.id}`;
  check("vendors: remove deletes ratings too", vleft.n === 0);

  // ================= Help requests =================
  r = await call("POST", "/api/v1/help-requests", { toEmail: "nobody@example.com", topic: "x", details: "", urgency: "today" }, agent);
  check("help: unknown support person refused", r.status === 400);
  r = await call("POST", "/api/v1/help-requests", { toEmail: "smm@spacematchinc.com", topic: "", details: "x".repeat(2001), urgency: "soon" }, agent);
  check("help: empty topic / long details / bad urgency refused", r.status === 400 && ["topic", "details", "urgency"].every(f => fields(r).includes(f)), fields(r));
  r = await call("POST", "/api/v1/help-requests", { toEmail: "smm@spacematchinc.com", topic: "MLS input", details: "1234 N Main St", urgency: "now" }, agent);
  check("help: create", r.status === 201 && r.json.status === "new" && r.json.toName === "Cris Castillo");
  const H = r.json;
  r = await call("GET", "/api/v1/help-requests", null, agent);
  check("help: shows under my requests", r.json.mine.some(x => x.id === H.id) && r.json.canHandle === false && r.json.support.length === 5);
  r = await call("GET", "/api/v1/help-requests", null, ops);
  check("help: ops sees the whole board", r.json.toMe.some(x => x.id === H.id) && r.json.isAdmin === true);
  r = await call("PATCH", `/api/v1/help-requests/${H.id}/status`, { status: "in_progress" }, other);
  check("help: an unrelated agent can't touch it", r.status === 404);
  r = await call("PATCH", `/api/v1/help-requests/${H.id}/status`, { status: "waiting" }, agent);
  check("help: asker can't set 'waiting'", r.status === 403);
  r = await call("PATCH", `/api/v1/help-requests/${H.id}/status`, { status: "in_progress", reply: "x".repeat(1001) }, ops);
  check("help: note over 1000 refused", r.status === 400 && fields(r) === "reply");
  r = await call("PATCH", `/api/v1/help-requests/${H.id}/status`, { status: "in_progress", reply: "On it" }, ops);
  check("help: ops moves it with a note", r.status === 200 && r.json.status === "in_progress" && r.json.reply === "On it" && r.json.statusBy === "Zz Ops");
  r = await call("PATCH", `/api/v1/help-requests/${H.id}/assignee`, { toEmail: "tc@spacematchinc.com" }, agent);
  check("help: agent can't reassign", r.status === 403);
  r = await call("PATCH", `/api/v1/help-requests/${H.id}/assignee`, { toEmail: "tc@spacematchinc.com" }, admin);
  check("help: admin reassigns", r.status === 200 && r.json.toName.includes("Atom"));
  r = await call("PATCH", `/api/v1/help-requests/${H.id}/status`, { status: "done" }, agent);
  check("help: asker closes it", r.status === 200 && r.json.status === "done" && r.json.doneAt);

  // ================= Email templates =================
  const tpl = { title: "Open house follow-up", segment: "open-house", subject: "Thanks for coming, {first_name}", body: "Hi {first_name},\n\nThanks for stopping by the open house today." };
  r = await call("POST", "/api/v1/email-templates", { ...tpl, subject: "", body: "short", segment: "aliens" }, agent);
  check("templates: empty subject / short body / bad segment refused", r.status === 400 && ["subject", "body", "segment"].every(f => fields(r).includes(f)), fields(r));
  r = await call("POST", "/api/v1/email-templates", { ...tpl, body: "Hi {firstname}, thanks for stopping by today!" }, agent);
  check("templates: unknown merge field refused", r.status === 400 && fields(r) === "body", r.json?.error?.details?.[0]?.message);
  r = await call("POST", "/api/v1/email-templates", tpl, agent);
  check("templates: create", r.status === 201 && r.json.status === "mine");
  const T = r.json;
  r = await call("PUT", `/api/v1/email-templates/${T.id}`, { ...tpl, title: "Hacked" }, other);
  check("templates: another agent can't edit", r.status === 404);
  r = await call("POST", `/api/v1/email-templates/${T.id}/suggest`, null, agent);
  check("templates: suggest for team", r.status === 200 && r.json.status === "suggested");
  r = await call("GET", "/api/v1/email-templates", null, ops);
  check("templates: ops sees it to review", r.json.canReview === true && r.json.review.some(x => x.id === T.id));
  r = await call("POST", `/api/v1/email-templates/${T.id}/review`, { approve: true }, agent);
  check("templates: agent can't approve", r.status === 403);
  r = await call("POST", `/api/v1/email-templates/${T.id}/review`, { approve: true }, ops);
  check("templates: ops approves", r.status === 200 && r.json.status === "team");
  r = await call("GET", "/api/v1/email-templates", null, other);
  check("templates: everyone sees team templates", r.json.team.some(x => x.id === T.id) && r.json.canReview === false);
  r = await call("PUT", `/api/v1/email-templates/${T.id}`, { ...tpl, body: tpl.body + " See you soon." }, agent);
  check("templates: owner editing a team template sends it back for review", r.status === 200 && r.json.status === "suggested");
  r = await call("PUT", "/api/v1/email-templates/rate", { ratePct: 6.85 }, agent);
  check("templates: agent can't set the team rate", r.status === 403);
  r = await call("PUT", "/api/v1/email-templates/rate", { ratePct: 20 }, ops);
  check("templates: rate 20% refused", r.status === 400 && fields(r) === "ratePct");
  r = await call("PUT", "/api/v1/email-templates/rate", { ratePct: 6.85 }, ops);
  check("templates: ops sets the team rate", r.status === 200 && r.json.ratePct === 6.85);
  r = await call("GET", "/api/v1/email-templates", null, agent);
  check("templates: rate shows for everyone", r.json.rate.ratePct === 6.85);
  r = await call("DELETE", `/api/v1/email-templates/${T.id}`, null, agent);
  check("templates: owner deletes", r.status === 200);
} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  const emails = [AGENT, OTHER, ADMIN, OPS];
  await sql`delete from vendors where added_by_email in ${sql(emails)}`;
  await sql`delete from help_requests where from_email in ${sql(emails)}`;
  await sql`delete from email_templates where owner_email in ${sql(emails)}`;
  await sql`delete from app_settings where key = 'emails:rate' and updated_by in ${sql(emails)}`;
  await sql`delete from users where email in ${sql(emails)}`;
  await sql.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
