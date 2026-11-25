// Seller Launch Portal emails (was convex/listingMail.ts): feedback-to-review alert, "seller approved
// the plan", Monday numbers reminder (agents), Tuesday nudge (ops), Monday weekly report (sellers).
import { esc, hubLink, shell, table, textTable } from "../../integrations/email/layout.js";
import { sendMail } from "../../integrations/email/mailer.js";

/** To the listing agent: ShowingTime feedback is waiting for review (hidden from the seller until published). */
export async function mailFeedbackToReview(l: { id: string; address: string; agentEmail: string }, pending: number) {
  const title = "New showing feedback to review";
  const line = `ShowingTime feedback came in for ${l.address}. It stays hidden from your seller until you tap Publish.`;
  await sendMail({
    to: l.agentEmail,
    subject: `New showing feedback · ${l.address}`,
    html: shell(title, `<p style="font-size:15px;color:#333">${esc(line)}</p><p style="font-size:14px;color:#6b665d">${pending} item(s) waiting.</p>`, { href: hubLink(`/listings/${l.id}`), label: "Review feedback" }),
    text: `${title}\n\n${line}\n${pending} item(s) waiting.\n\nReview feedback: ${hubLink(`/listings/${l.id}`)}`,
    tag: "listing:feedback-to-review",
  });
}

/** To the listing agent: the seller tapped "Approve plan". */
export async function mailPlanApproved(l: { id: string; address: string; agentEmail: string }, titles: string[]) {
  const title = "Your seller approved the plan";
  await sendMail({
    to: l.agentEmail,
    subject: `Seller approved the plan · ${l.address}`,
    html: shell(
      title,
      `<p style="font-size:15px;color:#333">The seller for <b>${esc(l.address)}</b> approved what we'd do next:</p><ul style="font-size:15px;color:#333">${titles.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`,
      { href: hubLink(`/listings/${l.id}`), label: "Open the listing" },
    ),
    text: `${title}\n\nThe seller for ${l.address} approved what we'd do next:\n${titles.map(t => `- ${t}`).join("\n")}\n\nOpen the listing: ${hubLink(`/listings/${l.id}`)}`,
    tag: "listing:plan-approved",
  });
}

export type DigestRow = {
  id: string;
  address: string;
  agentEmail: string;
  agentName: string;
  sellerName: string;
  sellerEmail: string | null;
  weeklyEmail: boolean;
  token: string;
  hasThisWeek: boolean;
  showings7: number;
  feedback7: number;
  stepsDone: number;
  stepsTotal: number;
  last: { zillowViews: number | null; zillowSaves: number | null; mlsSaved: number | null; mlsMaybe: number | null; mlsNotInterested: number | null; adViews: number | null } | null;
};

/** Monday morning: each agent with live listings missing this week's numbers. */
export async function mailMondayReminders(rows: DigestRow[]) {
  const byAgent = new Map<string, DigestRow[]>();
  for (const r of rows.filter(x => !x.hasThisWeek)) byAgent.set(r.agentEmail, [...(byAgent.get(r.agentEmail) ?? []), r]);
  const line = "Your sellers see these on their launch page. Open each listing and fill in Zillow views/saves and MLS saved / maybe / not interested.";
  for (const [email, ls] of byAgent) {
    const items = ls.map(l => `<li style="margin:6px 0"><a href="${esc(hubLink(`/listings/${l.id}`))}" style="color:#9C7434;font-weight:700">${esc(l.address)}</a></li>`).join("");
    await sendMail({
      to: email,
      subject: "30 seconds: this week's listing numbers",
      html: shell("Update your sellers' numbers", `<p style="font-size:15px;color:#333">${esc(line)}</p><ul style="padding-left:18px">${items}</ul>`, { href: hubLink("/listings"), label: "Open my listings" }),
      text: `Update your sellers' numbers\n\n${line}\n\n${ls.map(l => `- ${l.address}: ${hubLink(`/listings/${l.id}`)}`).join("\n")}`,
      tag: "listing:monday-reminder",
    });
  }
  return { agents: byAgent.size };
}

/** Tuesday morning: ops get the list of live listings still missing this week's numbers. */
export async function mailTuesdayNudge(rows: DigestRow[], ops: string[]) {
  const missing = rows.filter(x => !x.hasThisWeek);
  if (!missing.length || !ops.length) return { missing: missing.length };
  const list: [string, string][] = missing.map(r => [r.agentName, r.address]);
  for (const to of ops) {
    await sendMail({
      to,
      subject: `${missing.length} listing(s) still missing weekly numbers`,
      html: shell("Weekly numbers still missing", table(list), { href: hubLink("/listings"), label: "Open listings" }),
      text: `Weekly numbers still missing\n\n${textTable(list)}\n\nOpen listings: ${hubLink("/listings")}`,
      tag: "listing:tuesday-nudge",
    });
  }
  return { missing: missing.length };
}

/** Monday evening: the weekly report to sellers who have it switched on. */
export async function mailSellerWeekly(rows: DigestRow[]) {
  const send = rows.filter(r => r.weeklyEmail && r.sellerEmail);
  for (const r of send) {
    const n = r.last;
    const stats: [string, string][] = [
      ["Launch steps complete", `${r.stepsDone} of ${r.stepsTotal}`],
      ["Showings (last 7 days)", String(r.showings7)],
      ["New buyer feedback", String(r.feedback7)],
      ...(n && (n.zillowViews != null || n.zillowSaves != null) ? [["Zillow views / saves", `${n.zillowViews ?? "–"} / ${n.zillowSaves ?? "–"}`] as [string, string]] : []),
      ...(n && (n.mlsSaved != null || n.mlsMaybe != null) ? [["MLS buyers: saved / maybe / not", `${n.mlsSaved ?? 0} / ${n.mlsMaybe ?? 0} / ${n.mlsNotInterested ?? 0}`] as [string, string]] : []),
      ...(n?.adViews != null ? [["Ad views", String(n.adViews)] as [string, string]] : []),
    ];
    const first = r.sellerName.split(/\s+/)[0] ?? r.sellerName;
    const line = `Hi ${first}, here's how ${r.address} did this week. Your live page has the full timeline and buyer feedback.`;
    const link = hubLink(`/s/${r.token}`);
    await sendMail({
      to: r.sellerEmail!,
      subject: `Weekly report · ${r.address}`,
      html: shell(
        "Your weekly listing report",
        `<p style="font-size:15px;color:#333">${esc(line)}</p>${table(stats)}<p style="font-size:14px;color:#6b665d;margin-top:14px">Questions? Reply to ${esc(r.agentName)} directly.</p>`,
        { href: link, label: "Open my listing page" },
        "SPACEMATCH",
      ),
      text: `Your weekly listing report\n\n${line}\n\n${textTable(stats)}\n\nOpen your listing page: ${link}\nQuestions? Reply to ${r.agentName} directly.`,
      tag: "listing:seller-weekly",
    });
  }
  return { sent: send.length };
}
