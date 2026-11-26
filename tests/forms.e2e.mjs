// Run against a migrated, isolated API with MAIL_MODE=off.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import "dotenv/config";
import { FORMS } from "../dist/modules/forms/form-catalog.js";

const base = process.argv[2] ?? "http://localhost:4100";
const db = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false });
const suffix = Date.now();
const domain = (process.env.AUTH_ALLOWED_DOMAINS ?? "example.com").split(",")[0];
const emails = [];
const listingIds = [];
const ids = [];

async function call(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { Origin: process.env.APP_URL ?? base, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}

async function agent(index) {
  const email = `zz-forms-${suffix}-${index}@${domain}`;
  const password = "Forms-test-password-123";
  emails.push(email);
  const signup = await call("/auth/sign-up/email", { method: "POST", body: { email, password, name: `Forms Agent ${index}` } });
  assert.equal(signup.status, 200, JSON.stringify(signup.data));
  await db`update users set email_verified = true, role = 'agent' where email = ${email}`;
  const login = await call("/auth/sign-in/email", { method: "POST", body: { email, password } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return login.cookie;
}

try {
  const owner = await agent(1);
  const other = await agent(2);
  const { data: listing, status } = await call("/listings", { method: "POST", cookie: owner, body: { address: "1532 Test St, Wheeling, IL 60090", sellerName: "Test Seller" } });
  assert.equal(status, 201, JSON.stringify(listing));
  listingIds.push(listing.id);
  const portal = () => call(`/portal/${listing.token}`);
  assert.equal((await portal()).data.counts.openHouse, 0);

  const form = "/forms/open-house-signin";
  const share = cookie => call(`${form}/share`, { method: "POST", cookie, body: { listingId: listing.id } });
  assert.equal((await share(other)).status, 404);
  const { data: { link } } = await share(owner);
  assert.ok(link);
  assert.match((await call(`${form}/context?link=${encodeURIComponent(link)}`)).data.address, /1532 Test St/i);
  assert.equal((await call(`${form}/context?link=${encodeURIComponent(link + "x")}`)).status, 404);

  const submissionId = randomUUID();
  ids.push(submissionId);
  const visit = { submissionId, link, answers: { fullName: "Test Visitor", email: "private-visitor@example.com", propertyAddress: "Wrong listing" } };
  const send = body => call(`${form}/submissions`, { method: "POST", body });
  const retries = await Promise.all([send(visit), send(visit)]);
  assert.deepEqual(retries.map(r => r.status), [200, 200]);
  const seller = (await portal()).data;
  assert.equal(seller.counts.openHouse, 1);
  assert.ok(!JSON.stringify(seller).includes("private-visitor@example.com"));
  assert.ok(!JSON.stringify(seller).includes("Test Visitor"));
  const { data: details } = await call(`/listings/${listing.id}`, { cookie: owner });
  assert.equal(details.openHouse[0].name, "Test Visitor");
  const inbox = (await call("/forms/inbox", { cookie: owner })).data.rows;
  assert.match(inbox.find(row => row._id === submissionId).answers.propertyAddress, /1532 Test St/i);
  assert.ok(!(await call("/forms/inbox", { cookie: other })).data.rows.some(row => row._id === submissionId));
  assert.equal((await call(`/forms/inbox/${submissionId}`, { method: "PATCH", cookie: other, body: { status: "done" } })).status, 404);
  assert.equal((await call(`/forms/inbox/${submissionId}`, { method: "PATCH", cookie: owner, body: { status: "contacted", notes: "Followed up" } })).data.status, "contacted");

  const { data: intake } = await call("/forms/seller-intake/share", { method: "POST", cookie: owner, body: { listingId: listing.id } });
  const intakeId = randomUUID();
  ids.push(intakeId);
  const received = await call("/forms/seller-intake/submissions", { method: "POST", body: {
    submissionId: intakeId, link: intake.link, answers: { fullName: "Test Seller", email: "private-seller@example.com", timeline: "ASAP" },
  } });
  assert.equal(received.status, 200, JSON.stringify(received.data));
  assert.ok((await call("/forms/inbox", { cookie: owner })).data.rows.some(row => row._id === intakeId && row.listingId === listing.id));
  assert.equal((await portal()).data.counts.openHouse, 1);
  assert.equal((await db`select count(*)::int as total from jobs where kind = 'forms.received' and payload->>'submissionId' = ${submissionId}`)[0].total, 1);

  for (const def of FORMS.filter(f => !["open-house-signin", "seller-intake"].includes(f.id))) {
    const share = await call(`/forms/${def.id}/share`, { method: "POST", cookie: owner, body: {} });
    assert.equal(share.status, 200, def.id);
    const answers = {};
    for (const field of def.fields) {
      if (!field.required && field.id !== "email") continue;
      answers[field.id] = field.options?.[0] ?? ({
        email: "test@example.com", tel: "3125550198", date: "2026-11-26", number: "2", money: "1200", rating: "4", agent: "Forms Agent 1",
      })[field.type] ?? "Test value";
    }
    if (def.audience === "client" && !answers.email && !answers.phone) answers.phone = "3125550198";
    const submissionId = randomUUID();
    ids.push(submissionId);
    const result = await call(`/forms/${def.id}/submissions`, { method: "POST", body: { submissionId, link: share.data.link, answers } });
    assert.equal(result.status, 200, `${def.id}: ${JSON.stringify(result.data)}`);
  }

  if (process.env.FORMS_BROWSER_EXECUTABLE) {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ executablePath: process.env.FORMS_BROWSER_EXECUTABLE });
    const ui = process.env.APP_URL;
    try {
      const agentPage = await browser.newPage();
      const login = await agentPage.request.post(`${ui}/api/v1/auth/sign-in/email`, {
        headers: { Origin: ui },
        data: { email: emails[0], password: "Forms-test-password-123" },
      });
      assert.equal(login.status(), 200);
      await agentPage.goto(`${ui}/forms?open=open-house-signin&listing=${encodeURIComponent(listing.id)}`);
      const share = agentPage.getByRole("button", { name: "Create share link" });
      await share.click();
      await agentPage.getByAltText("QR code").waitFor();
      const visitorUrl = await agentPage.getByRole("link", { name: "Preview" }).getAttribute("href");

      const sellerPage = await browser.newPage();
      await sellerPage.goto(`${ui}/s/${listing.token}`);
      const counter = sellerPage.getByText("visitors signed in").locator("..");
      await counter.getByText("1", { exact: true }).waitFor();

      const visitorPage = await browser.newPage();
      await visitorPage.goto(visitorUrl);
      await visitorPage.getByLabel("Full name").fill("Browser Visitor");
      await visitorPage.getByLabel("Email").fill("browser-visitor@example.com");
      assert.match(await visitorPage.getByLabel("Open house address").inputValue(), /1532 Test St/i);
      await visitorPage.getByRole("button", { name: "Submit" }).click();
      await visitorPage.getByRole("heading", { name: "Thank you!" }).waitFor();
      await counter.getByText("2", { exact: true }).waitFor({ timeout: 25000 });
      console.log("Browser passed: share link, QR, visitor submission, and automatic seller count refresh.");
    } finally {
      await browser.close();
      const rows = await db`select id from form_submissions where listing_id = ${listing.id} and contact_email = 'browser-visitor@example.com'`;
      ids.push(...rows.map(row => row.id));
    }
  }
  console.log("Forms passed: all catalog forms, signed links, retries, seller count, intake, inbox access and notification queue.");
} finally {
  for (const id of ids) {
    await db`delete from jobs where payload->>'submissionId' = ${id}`;
    await db`delete from form_submissions where id = ${id}`;
  }
  for (const id of listingIds) {
    await db`delete from jobs where payload->>'listingId' = ${id}`;
    await db`delete from listings where id = ${id}`;
  }
  for (const email of emails) await db`delete from users where email = ${email}`;
  await db.end();
}
