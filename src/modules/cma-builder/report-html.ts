import { ADJUSTMENT_CATEGORIES } from "./cma-builder.types.js";
import { providerById } from "./providers/index.js";
import { approvedResearch, PUBLIC_RECORDS, researchCounty } from "../property-intelligence/review.js";
// The full CMA report as one self-contained HTML page (no external files, fonts or scripts).
// Used by the legacy HTML endpoints and printed as the detail pages of the template export.
// All text from the report, the comparables and the agent is escaped.
import { esc } from "../../integrations/email/layout.js";
import type { CmaComparableRow, CmaReportRow } from "./cma-builder.model.js";
import { DISCLAIMER, finalValue, type ListingInfo, recommendedRange } from "./cma-builder.view.js";

const money = (n: number | null | undefined) => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const num = (n: number | null | undefined, digits = 0) => (n == null ? "–" : n.toLocaleString("en-US", { maximumFractionDigits: digits }));
const date = (d: string | Date | null | undefined) => (d ? new Date(typeof d === "string" && d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "–");
const para = (t?: string | null) => (t ? t.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("") : "");
const STATUS: Record<string, string> = { sold: "Sold", active: "Active", pending: "Pending", off_market: "Off market" };
const TYPE: Record<string, string> = { single_family: "Single-family", townhome: "Townhome", condo: "Condo", multi_2_4: "2–4 unit", land: "Land", other: "Other" };

/** Horizontal bars (inline SVG): one per comparable, the subject value as a dashed line. */
function barChart(rows: { label: string; value: number }[], marker: { label: string; value: number } | null, fmt: (n: number) => string): string {
  if (!rows.length) return "";
  const W = 640;
  const rowH = 22;
  const left = 190;
  const H = rows.length * rowH + 30;
  const max = Math.max(...rows.map(r => r.value), marker?.value ?? 0) * 1.08;
  const x = (v: number) => left + ((W - left - 70) * v) / max;
  const bars = rows
    .map((r, i) => {
      const y = 8 + i * rowH;
      return `<text x="${left - 8}" y="${y + 13}" text-anchor="end" font-size="10" fill="#57534e">${esc(r.label.slice(0, 32))}</text>
<rect x="${left}" y="${y + 3}" width="${Math.max(2, x(r.value) - left)}" height="13" rx="3" fill="#D9BC8C"/>
<text x="${x(r.value) + 5}" y="${y + 13}" font-size="10" fill="#0A0A0A">${esc(fmt(r.value))}</text>`;
    })
    .join("");
  const m = marker
    ? `<line x1="${x(marker.value)}" x2="${x(marker.value)}" y1="2" y2="${H - 20}" stroke="#9C7434" stroke-width="2" stroke-dasharray="4 3"/>
<text x="${x(marker.value)}" y="${H - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="#9C7434">${esc(marker.label)} ${esc(fmt(marker.value))}</text>`
    : "";
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="chart">${bars}${m}</svg>`;
}

export function renderReportHtml(opts: { report: CmaReportRow; comps: CmaComparableRow[]; listing: ListingInfo; audience: "agent" | "seller"; preview?: boolean }): string {
  const { report: r, audience } = opts;
  const a = r.analysis;
  const sections = r.content.sections ?? { overview: true, comparables: true, market: true, adjustments: true, recommendations: true };
  const value = finalValue(r);
  const range = recommendedRange(r);
  const selected = opts.comps.filter(c => c.selected && c.status !== "off_market");
  const sold = selected.filter(c => c.status === "sold");
  const competition = selected.filter(c => c.status !== "sold");
  const scoreOf = new Map((a?.scores ?? []).map(s => [s.id, s]));
  const redistributable = providerById(r.provider)?.redistributable === true;
  const showAddress = (c: CmaComparableRow) => audience === "agent" || (r.content.showCompAddressesToSeller !== false && (redistributable || c.source === PUBLIC_RECORDS));
  const addr = (c: CmaComparableRow, i: number) => showAddress(c) ? esc(c.address) : `Comparable ${i + 1}`;
  const canShowDetails = (c: CmaComparableRow) => audience === "agent" || c.source === PUBLIC_RECORDS || c.source === "manual";
  const preparer = r.publishedByName ?? r.reviewedByName ?? r.requestedByName;
  const chapter = (kicker: string, title: string, body: string) =>
    `<section class="chapter"><div class="chapter-brand">SpaceMatch Inc.</div><div class="eyebrow">${esc(kicker)}</div><h2>${esc(title)}</h2>${body}</section>`;
  const fixtures = opts.comps.some(c => c.selected && c.isFixture);
  const asking = r.askingPriceCents == null ? null : Math.round(r.askingPriceCents / 100);
  const subj = r.subject;
  const research = approvedResearch(r.content, r.subject);
  const sources = [...new Set(opts.comps.filter(c => c.selected).map(c => (c.source === PUBLIC_RECORDS ? `${researchCounty(r.content.research).name} Public Records` : c.source === "manual" ? "Entered by the agent" : c.source === "csv" ? "Imported by the agent (CSV)" : c.source === "reference-sample" ? "Supplied CMA reference PDF" : c.source)))];
  const stamp = r.publishedAt ? `Published ${date(r.publishedAt)}` : opts.preview ? "PREVIEW — not published" : `Draft ${date(r.updatedAt)}`;

  const compRows = (list: CmaComparableRow[], offset = 0) =>
    list
      .map((c, i) => {
        const s = scoreOf.get(c.id);
        return `<tr><td>${addr(c, i + offset)}${showAddress(c) && c.sourceRecordId && c.source !== PUBLIC_RECORDS ? `<div class="small muted">Record ${esc(c.sourceRecordId)}</div>` : ""}${c.status !== "sold" && audience === "agent" && c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ""}${c.isFixture ? ' <span class="fx">FIXTURE</span>' : ""}</td><td>${STATUS[c.status] ?? esc(c.status)}</td>
<td class="n">${money(c.status === "sold" ? c.soldPrice : c.listPrice)}</td><td>${c.status === "sold" ? date(c.soldDate) : "–"}</td>
<td class="n">${num(c.beds, 1)}/${num(c.baths, 1)}</td><td class="n">${num(c.sqft)}</td><td class="n">${s?.pricePerSqft ? `$${s.pricePerSqft}` : "–"}</td>
<td class="n">${c.distanceMi == null ? "–" : `${c.distanceMi.toFixed(2)} mi`}</td><td class="n">${num(c.daysOnMarket)}</td>${audience === "agent" ? `<td class="n">${s?.similarity ?? "–"}</td>` : ""}</tr>`;
      })
      .join("");

  const facts = [
    ["Property type", TYPE[subj.propertyType] ?? subj.propertyType],
    ["Bedrooms", num(subj.beds, 1)],
    ["Bathrooms", num(subj.baths, 1)],
    ["Living area reported to CMA", subj.sqft == null ? "–" : `${num(subj.sqft)} sq ft`],
    ["Year built", num(subj.yearBuilt)],
    ["Lot size", subj.lotSqft == null ? "–" : `${num(subj.lotSqft)} sq ft`],
    ["Garage spaces", num(subj.garageSpaces)],
    ["Condition", subj.condition ?? "–"],
  ];
  const profiles = sold.map((c, i) => {
    const score = scoreOf.get(c.id);
    const details = canShowDetails(c);
    return `<article class="profile"><h3>${addr(c, i)}</h3>
<p class="profile-price">${money(c.soldPrice)} · ${date(c.soldDate)}</p>
<p class="muted">${num(c.beds, 1)} beds · ${num(c.baths, 1)} baths · ${num(c.sqft)} sq ft · ${num(c.daysOnMarket)} DOM</p>
${details && c.features.length ? `<p>${esc(c.features.join(" · "))}</p>` : ""}
${audience === "agent" && c.notes ? para(c.notes) : ""}
${sections.adjustments && c.adjustments.length ? `<p>Adjusted indication <strong>${money(score?.adjustedValue)}</strong></p>` : ""}
</article>`;
  }).join("");
  const signedMoney = (n: number) => n === 0 ? "–" : `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`;
  const adjustments = Array.from({ length: Math.ceil(sold.length / 3) }, (_, index) => {
    const start = index * 3;
    const batch = sold.slice(start, start + 3);
    const categories = ADJUSTMENT_CATEGORIES.filter(category => batch.some(c => c.adjustments.some(x => x.category === category)));
    if (!categories.length) return "";
    const row = (label: string, cell: (c: CmaComparableRow) => string) =>
      `<tr><th scope="row">${esc(label)}</th>${batch.map(c => `<td>${cell(c)}</td>`).join("")}</tr>`;
    return `<table class="adjustment-grid"><thead><tr><th>Adjustment</th>${batch.map((c, i) => `<th>${addr(c, start + i)}</th>`).join("")}</tr></thead><tbody>
${row("Closed sale", c => money(c.soldPrice))}
${categories.map(category => row(category, c => {
  const entries = c.adjustments.filter(x => x.category === category);
  return entries.length ? entries.map(x => `<div><strong>${signedMoney(x.amount)}</strong> <span class="small muted">${esc(x.reason)}</span></div>`).join("") : "–";
})).join("")}
${row("Adjusted indication", c => money(scoreOf.get(c.id)?.adjustedValue))}
</tbody></table>`;
  }).join("");
  const reconciliation = a?.status === "ok" && sold.length ? `<div class="box">
<p><strong>Calculated indication</strong> ${money(a.estimatedValue)}</p>
<p><strong>Report market value</strong> ${money(value)} · <strong>Range</strong> ${range ? `${money(range.low)} – ${money(range.high)}` : "–"}</p>
<p class="small muted">The valuation weights reflect each selected sale’s similarity and apply to its adjusted price.</p>
</div>` : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CMA · ${esc(subj.address)}</title>
<style>
* { box-sizing: border-box; }
body { font-family: Helvetica, Arial, sans-serif; color: #0A0A0A; font-size: 11.5px; line-height: 1.45; margin: 0; background: #fff; }
.wrap { max-width: 820px; margin: 0 auto; padding: 24px; }
h1, h2, h3 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; margin: 0; }
h1 { font-size: 32px; } h2 { font-size: 20px; margin: 22px 0 8px; border-bottom: 1px solid #e7e5e4; padding-bottom: 4px; break-after: avoid; }
.brand { font-size: 10px; letter-spacing: 4px; color: #9C7434; font-weight: 700; }
.muted { color: #6b665d; } .n { text-align: right; white-space: nowrap; }
.hero { background: #0A0A0A; color: #fff; border-radius: 12px; padding: 20px 22px; margin: 12px 0 16px; }
.hero .muted { color: #D9BC8C; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
.kpi { border: 1px solid #e7e5e4; border-radius: 10px; padding: 9px 10px; break-inside: avoid; }
.kpi b { display: block; font-size: 16px; font-family: Georgia, serif; font-weight: 400; margin-top: 2px; }
.kpi span { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #78716c; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; }
thead { display: table-header-group; } tr { break-inside: avoid; }
th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .6px; color: #78716c; border-bottom: 1.5px solid #0A0A0A; padding: 5px 5px; }
td { border-bottom: 1px solid #f0eeea; padding: 5px; vertical-align: top; }
.fx { background: #fde68a; color: #78350f; font-size: 8px; padding: 1px 4px; border-radius: 3px; font-weight: 700; }
.warn { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
.box { background: #F7F5F1; border-radius: 10px; padding: 10px 12px; break-inside: avoid; }
.chapter { margin: 24px 0; }
.chapter h2 { margin-top: 3px; border-color: #b18949; }
.eyebrow { color: #77551e; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; break-after: avoid; }
.hero { border-top: 3px solid #b18949; border-radius: 0; padding: 28px 26px; }
.profile { border-top: 1px solid #b18949; padding: 10px 0; break-inside: avoid; }
.profile h3 { font-size: 15px; }
.profile-price { font-weight: 700; color: #77551e; margin-top: 4px; }
.adjustment-grid { table-layout: fixed; margin-bottom: 16px; }
.adjustment-grid th, .adjustment-grid td { overflow-wrap: anywhere; }
@page { size: Letter; margin: 0.5in 0.5in 0.6in; }
.chapter-brand { font-size: 9px; letter-spacing: 2.6px; text-transform: uppercase; color: #534633; font-weight: 700; margin-bottom: 24px; }
.cover-label { font-size: 10px; letter-spacing: 2px; color: #e5c996; margin: 30px 0 8px; }
.hero h1 { font-size: 38px; line-height: 1.1; overflow-wrap: anywhere; }
.hero { background: #141210; padding: 40px 32px; }
.hero .brand { color: #e5c996; }
.hero .warn { color: #78350f; }
.chapter h3 { break-after: avoid; margin: 16px 0 4px; }
@media screen {
  body { background: #f2f0ec; }
  .hero, .chapter { margin: 0 0 18px; }
  .chapter { padding: 28px; background: white; overflow-x: auto; }
  .hero { min-height: 32rem; }
  @media (max-width: 600px) { .wrap { padding: 8px; } .chapter, .hero { padding: 16px; } .hero h1 { font-size: 30px; } }
}
@media print {
  .wrap { padding: 0; }
  .hero { min-height: 9.25in; margin: 0; break-inside: avoid; }
  .chapter { break-before: page; margin: 0; padding: 12px 12px 0; }
}
.small { font-size: 9.5px; } p { margin: 0 0 7px; }
</style></head><body><div class="wrap">
<header class="hero">
<div class="brand">SPACEMATCH INC.</div>
<div class="cover-label">COMPARATIVE MARKET ANALYSIS</div>
  <div class="muted small">${esc(stamp)} · Version ${r.version}</div>
  <h1 style="margin-top:6px">${esc(subj.address)}</h1>
  <div style="margin-top:4px;color:#d6d3d1">${esc(TYPE[subj.propertyType] ?? subj.propertyType)} · ${num(subj.beds, 1)} bd · ${num(subj.baths, 1)} ba · ${num(subj.sqft)} sq ft${subj.yearBuilt ? ` · built ${subj.yearBuilt}` : ""}${subj.condition ? ` · ${esc(subj.condition)}` : ""}</div>
  <div style="display:flex;gap:28px;margin-top:14px;flex-wrap:wrap">
    <div><div class="muted small">ESTIMATED MARKET VALUE</div><div style="font-family:Georgia,serif;font-size:28px">${a?.status === "insufficient_data" && !r.override ? "Not enough data" : money(value)}</div></div>
    <div><div class="muted small">${range?.fromAgent ? "RECOMMENDED RANGE" : "INDICATED RANGE"}</div><div style="font-family:Georgia,serif;font-size:20px;margin-top:6px">${range ? `${money(range.low)} – ${money(range.high)}` : "–"}</div></div>
    ${r.content.recommendedListPrice ? `<div><div class="muted small">RECOMMENDED LIST PRICE</div><div style="font-family:Georgia,serif;font-size:20px;margin-top:6px">${money(r.content.recommendedListPrice)}</div></div>` : ""}
    <div><div class="muted small">CURRENT ASKING</div><div style="font-family:Georgia,serif;font-size:20px;margin-top:6px">${money(asking)}</div></div>
  </div>
  <div class="small" style="margin-top:10px;color:#a8a29e">Prepared by ${esc(preparer)} · SpaceMatch Inc.</div>
${fixtures ? '<div class="warn"><b>Development fixture data.</b> Some comparables in this report are test records, not real properties.</div>' : ""}
${r.override && audience === "agent" ? `<div class="warn"><b>Agent override:</b> ${money(r.override.value)} (engine estimate ${money(a?.estimatedValue)}). Reason: ${esc(r.override.reason)}</div>` : ""}
</header>
${r.content.executiveSummary ? chapter("A note from your agent", "Executive summary", `${para(r.content.executiveSummary)}<p class="muted">${esc(preparer)} · SpaceMatch Inc.</p>`) : ""}
${sections.overview ? chapter("Subject facts and sources", "Property at a glance", `<table><thead><tr><th>Item</th><th>Working fact</th><th>Source</th></tr></thead><tbody>${facts.map(([label, fact]) => `<tr><td>${esc(label!)}</td><td>${esc(fact!)}</td><td>${fact === "–" ? "Unavailable" : "CMA subject details"}</td></tr>`).join("")}</tbody></table>
${subj.features?.length ? `<p><strong>Reported features</strong> · ${esc(subj.features.join(" · "))}</p>` : ""}`) : ""}
${
  sections.overview && a
    ? chapter("Market evidence", "Market overview", `<div class="kpis">
<div class="kpi"><span>Sold comparables</span><b>${a.sold.count}</b></div>
<div class="kpi"><span>Median sold price</span><b>${money(a.sold.medianPrice)}</b></div>
<div class="kpi"><span>Median $/sq ft</span><b>${a.sold.medianPpsf ? `$${a.sold.medianPpsf}` : "–"}</b></div>
<div class="kpi"><span>Avg days on market</span><b>${num(a.sold.avgDom)}</b></div>
<div class="kpi"><span>Active competition</span><b>${a.active.count}</b></div>
<div class="kpi"><span>Pending</span><b>${a.pending.count}</b></div>
<div class="kpi"><span>Sold-to-list</span><b>${a.soldToListRatio ? `${(a.soldToListRatio * 100).toFixed(1)}%` : "–"}</b></div>
<div class="kpi"><span>Data quality</span><b>${esc(a.quality.grade)}</b></div></div>
${a.status === "insufficient_data" ? `<div class="warn">${esc(a.insufficientReason ?? "Not enough comparable sales for a value.")}</div>` : ""}`)
    : ""
}
${research ? chapter("Verified records", "Property research", `<p class="small muted">Records collected ${esc(research.collectedAt.slice(0, 10))}</p>
${research.facts.length ? `<table><thead><tr><th>Fact</th><th>Value</th><th>Source</th></tr></thead><tbody>${research.facts.map(f => `<tr><td>${esc(f.label)}</td><td>${esc(String(f.value))} ${esc(f.unit ?? "")}</td><td>${esc(f.provider)} · ${esc(f.dataset)} ${esc(f.effectiveDate ?? "")}</td></tr>`).join("")}</tbody></table>` : ""}
${research.sales.length ? `<h3>Recorded sales · ${esc(research.county.provider)}</h3><table><thead><tr><th>Date</th><th>Reported price</th><th>Deed type</th></tr></thead><tbody>${research.sales.map(s => `<tr><td>${esc(s.date)}</td><td>${money(s.price)}</td><td>${esc(s.deed)}</td></tr>`).join("")}</tbody></table>` : ""}
${research.assessments.length ? `<h3>${esc(research.county.valueLabel ?? "Assessed values")} · ${esc(research.county.provider)}</h3><table><thead><tr><th>Year</th><th>${esc(research.county.valueLabel ?? "Assessed value")}</th><th>Roll stage</th></tr></thead><tbody>${research.assessments.map(a => `<tr><td>${a.year}</td><td>${money(a.value)}</td><td>${esc(a.stage)}</td></tr>`).join("")}</tbody></table>` : ""}`) : ""}
${r.content.propertyObservations ? chapter("Condition and preparation", "Property observations", para(r.content.propertyObservations)) : ""}
${sections.comparables && sold.length ? chapter("Closed-sale evidence", "Comparable sales", `<table><thead><tr><th>Property</th><th>Status</th><th class="n">Price</th><th>Sold</th><th class="n">Bd/Ba</th><th class="n">Sq ft</th><th class="n">$/sq ft</th><th class="n">Distance</th><th class="n">DOM</th>${audience === "agent" ? '<th class="n">Match</th>' : ""}</tr></thead><tbody>${compRows(sold)}</tbody></table>${para(r.content.comparableNotes)}`) : ""}
${
  sections.market && sold.length
    ? chapter("Market analysis", "Price comparison", `${barChart(
        sold.map((c, i) => ({ label: showAddress(c) ? c.address : `Comparable ${i + 1}`, value: scoreOf.get(c.id)?.adjustedValue ?? c.soldPrice ?? 0 })),
        value ? { label: "Estimate", value } : null,
        money,
      )}
<div class="small muted">Bars show each sale's adjusted value (sold price plus the adjustments below).</div>
${(() => {
  const rows = sold.map((c, i) => ({ label: showAddress(c) ? c.address : `Comparable ${i + 1}`, value: scoreOf.get(c.id)?.pricePerSqft ?? 0 })).filter(x => x.value > 0);
  return rows.length ? `<h2>Price per square foot</h2>${barChart(rows, a?.subjectPositioning.askingPpsf ? { label: "Your asking", value: a.subjectPositioning.askingPpsf } : null, n => `$${Math.round(n)}`)}` : "";
})()}`)
    : ""
}
${sections.comparables && profiles ? chapter("Comparable sale profiles", "The homes behind the analysis", profiles) : ""}
${sections.adjustments && adjustments ? chapter("Adjustment grid", "Adjusting to the subject", `${adjustments}<p class="small muted">Positive amounts indicate a subject advantage. Negative amounts indicate a comparable advantage.</p>`) : ""}
${sections.adjustments && reconciliation ? chapter("Value conclusion", "Reconciling the evidence", reconciliation) : ""}
${sections.comparables ? chapter("Current competition", "Competition and market checks", competition.length ? `<table><thead><tr><th>Property</th><th>Status</th><th>Asking</th><th>Sale date</th><th>Bd/Ba</th><th>Sq ft</th><th>$/sq ft</th><th>Distance</th><th>DOM</th>${audience === "agent" ? "<th>Match</th>" : ""}</tr></thead><tbody>${compRows(competition, sold.length)}</tbody></table>` : '<p>No active or pending listings were selected for this version.</p>') : ""}
${sections.recommendations && r.content.pricingRecommendation ? chapter("Pricing strategy", "Pricing recommendation", para(r.content.pricingRecommendation)) : ""}
${sections.recommendations && r.content.marketingRecommendations ? chapter("Preparation, launch and follow-up", "Marketing recommendations", para(r.content.marketingRecommendations)) : ""}
${chapter("Source notes", "Method, sources and limitations", `<div class="small">
${(a?.method ?? []).map(m => `<p>• ${esc(m)}</p>`).join("")}
<p>• Data sources: ${esc(sources.join(", ") || "–")}. Data collected ${date(r.dataCollectedAt)}. Report ${r.publishedAt ? `published ${date(r.publishedAt)}` : "not yet published"}.</p>
${audience === "agent" && a?.quality.notes.length ? `<p>• Data quality (${esc(a.quality.grade)}, ${a.quality.score}/100): ${esc(a.quality.notes.join(" "))}</p>` : ""}
<p>• Comparable search settings: ${num(r.params.radiusMi, 1)} mi radius, ${num(r.params.soldWithinDays)} day sold lookback. ${sold.length} selected closed sale(s); ${competition.length} selected active or pending listing(s).</p>
<p class="muted" style="margin-top:8px">${esc(DISCLAIMER)}</p>
</div>`)}
</div></body></html>`;
}
