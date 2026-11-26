// CMA report files: the filled seller template (report-template.ts) followed by the full analysis
// (report-html.ts printed by Chromium), as one PDF, plus a PowerPoint with one picture per PDF page.
// All Node: runs on Vercel (serverless Chromium) as well as on a worker or a laptop.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type PptxGenJSModule from "pptxgenjs";
import { approvedResearch, PUBLIC_RECORDS } from "../property-intelligence/review.js";
import type { CmaComparableRow, CmaReportRow } from "./cma-builder.model.js";
import { finalValue, type ListingInfo } from "./cma-builder.view.js";
import { withBrowserPage } from "./providers/browser/browser-pool.js";
import { providerById } from "./providers/index.js";
import { renderReportHtml } from "./report-html.js";

export type ReportFormat = "pdf" | "pptx";
export const REPORT_EXPORT_LAYOUT = "seller-template-v1";
// Module-level code here runs at API start-up: keep it to plain values. Files and libraries are looked
// up inside the export functions, so a missing one can only fail an export, never the whole API.
const requireFrom = createRequire(import.meta.url);

/** pdf.js (rasterizes PDF pages for the PowerPoint inside Chromium). Literal `new URL(..., import.meta.url)`
 *  so Vercel's file tracing bundles both files. */
function pdfjsFiles() {
  return [
    new URL("../../../node_modules/pdfjs-dist/build/pdf.min.mjs", import.meta.url),
    new URL("../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
  ] as const;
}

const money = (value: number | null) => value == null ? "" : `$${Math.round(value).toLocaleString("en-US")}`;
const number = (value: number | null | undefined) => value == null ? "" : value.toLocaleString("en-US");
const year = (value: number | null | undefined) => value == null ? "" : String(value);
const acreage = (sqft: number | null | undefined) => sqft == null ? "" : `${(sqft / 43560).toFixed(2)} ac`;

export function reportExportKey(report: CmaReportRow) {
  const revision = report.publishedAt ? "published" : report.updatedAt.getTime();
  return `cma-reports/${report.listingId}/${report.id}-v${report.version}-${revision}-${REPORT_EXPORT_LAYOUT}`;
}

export function templateData(report: CmaReportRow, comps: CmaComparableRow[]) {
  const { subject, content } = report;
  const location = [subject.city, [subject.state, subject.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const type = subject.propertyType.replaceAll("_", " ");
  const sold = comps.filter(c => c.selected && c.status === "sold");
  const showAddress = content.showCompAddressesToSeller !== false;
  const redistributable = providerById(report.provider)?.redistributable === true;
  const date = (report.publishedAt ?? report.updatedAt).toISOString().slice(0, 10);
  const research = approvedResearch(content, subject);
  const { analysis } = report;
  const fields: Record<string, string> = {
    cover_caption: `${report.publishedAt ? "Comparative market analysis" : "CMA draft"} · ${subject.address} · ${date}`,
    property_address: subject.address,
    property_headline: subject.street ?? subject.address,
    property_subtitle: [location, type].filter(Boolean).join(" · "),
    property_type: type,
    property_beds: number(subject.beds),
    property_full_baths: number(subject.baths),
    property_baths_label: "BATHROOMS",
    property_sqft: number(subject.sqft),
    property_acres: acreage(subject.lotSqft),
    property_year_built: year(subject.yearBuilt),
    property_layout: content.propertyObservations ?? "",
    property_garage_lot: subject.garageSpaces == null ? acreage(subject.lotSqft) : `${subject.garageSpaces} garage spaces · ${acreage(subject.lotSqft) || "lot size unavailable"}`,
    property_tax_record: research?.assessments.slice(0, 2).map(item => `${item.year} assessed value · ${money(item.value)}`).join("\n") ?? "",
    property_listing_history: research?.sales.slice(0, 2).map(sale => `${sale.date} · ${money(sale.price)}`).join("\n") ?? "",
    property_source_note: research ? "Listing details and agent-approved Cook County records" : "Listing and agent-entered property details",
    subject_price: money(finalValue(report)),
    subject_baths: number(subject.baths),
    subject_lot: acreage(subject.lotSqft),
    subject_garage: number(subject.garageSpaces),
    comparables_source_note: "Selected closed sales. See the full CMA analysis for sources and details.",
    features: (subject.features ?? []).join(" · "),
    positioning: content.marketingRecommendations ?? "",
    strengths: content.executiveSummary ?? "",
    seller_goals: content.pricingRecommendation ?? "",
    market_active: number(analysis?.active.count),
    market_pending: number(analysis?.pending.count),
    market_dom: number(analysis?.soldAll.medianDom),
    market_recent_solds: number(analysis?.soldAll.count),
    market_source_caption: `CMA collection · ${report.params.radiusMi} mi search radius · ${report.params.soldWithinDays}-day sale window · ${date}`,
  };
  sold.slice(0, 6).forEach((comp, index) => {
    const prefix = `comp_${index + 1}_`;
    fields[prefix + "address"] = showAddress && (redistributable || comp.source === PUBLIC_RECORDS) ? comp.address : `Comparable ${index + 1}`;
    fields[prefix + "price"] = money(comp.soldPrice);
    fields[prefix + "closed_date"] = comp.soldDate ?? "";
    fields[prefix + "beds"] = number(comp.beds);
    fields[prefix + "baths"] = number(comp.baths);
    fields[prefix + "sqft"] = number(comp.sqft);
    fields[prefix + "price_per_sqft"] = money(comp.soldPrice && comp.sqft ? comp.soldPrice / comp.sqft : null);
    if (comp.source === PUBLIC_RECORDS || comp.source === "manual") {
      fields[prefix + "year_built"] = year(comp.yearBuilt);
      fields[prefix + "lot"] = acreage(comp.lotSqft);
      fields[prefix + "garage"] = number(comp.garageSpaces);
    }
  });
  const pages = [1, 3];
  if (content.sections?.comparables !== false && sold.length) pages.push(4);
  if (content.sections?.comparables !== false && sold.length > 3) pages.push(5);
  if (content.sections?.recommendations !== false && (fields.positioning || fields.strengths || fields.seller_goals)) pages.push(10);
  if (content.sections?.market !== false && analysis) pages.push(14);
  return { fields, pages };
}

/**
 * Export libraries load only when an export runs, never at API start-up: a problem in one of them must
 * not take the whole API down. pptxgenjs is loaded as CommonJS on purpose: its ES build is a ".js" file
 * in a package without "type": "module", which plain Node (and Vercel's runtime) refuses to load.
 */
async function exportLibs() {
  const [{ PDFDocument }, { renderTemplate }] = await Promise.all([import("pdf-lib"), import("./report-template.js")]);
  const PptxGenJS = requireFrom("pptxgenjs") as typeof PptxGenJSModule.default;
  return { PDFDocument, renderTemplate, PptxGenJS };
}

export async function renderReportFiles(report: CmaReportRow, comps: CmaComparableRow[], listing: ListingInfo) {
  const { PDFDocument, renderTemplate, PptxGenJS } = await exportLibs();
  const html = renderReportHtml({ report, comps, listing, audience: "seller", preview: !report.publishedAt });
  const { fields, pages } = templateData(report, comps);
  const signal = new AbortController().signal;
  return withBrowserPage({ allowedHosts: [], signal, label: "cma-export", timeoutMs: 120_000 }, async ({ page }) => {
    await page.setContent(html, { waitUntil: "load" });
    const analysis = await page.pdf({ format: "Letter", printBackground: true, margin: { top: "0.5in", bottom: "0.6in", left: "0.5in", right: "0.5in" } });

    // export.py: template pages first, then the full analysis.
    const doc = await renderTemplate(fields, pages);
    const extra = await PDFDocument.load(analysis);
    for (const p of await doc.copyPages(extra, extra.getPageIndices())) doc.addPage(p);
    doc.setTitle("Comparative Market Analysis");
    doc.setAuthor("SpaceMatch Inc.");
    const pdf = Buffer.from(await doc.save());

    // reference.preview_pptx: each PDF page as a picture (1.5× scale) on a 13.33 × 7.5 in slide.
    const [lib, worker] = await Promise.all(pdfjsFiles().map(file => readFile(file, "utf8")));
    await page.setContent("<!doctype html><title>render</title>");
    // Passed as a string: a compiled function can carry bundler helpers (e.g. tsx's __name) that don't
    // exist inside the page.
    const images = (await page.evaluate(`(async ({ lib, worker, data }) => {
      const url = code => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      const pdfjs = await import(url(lib));
      pdfjs.GlobalWorkerOptions.workerSrc = url(worker);
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const file = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
      const out = [];
      for (let i = 1; i <= file.numPages; i++) {
        const pg = await file.getPage(i);
        const viewport = pg.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await pg.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
        out.push({ png: canvas.toDataURL("image/png"), w: viewport.width, h: viewport.height });
      }
      return out;
    })(${JSON.stringify({ lib, worker, data: pdf.toString("base64") })})`)) as { png: string; w: number; h: number }[];
    const deck = new PptxGenJS();
    deck.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in
    for (const img of images) {
      const scale = Math.min(13.333 / img.w, 7.5 / img.h);
      const w = img.w * scale;
      const h = img.h * scale;
      deck.addSlide().addImage({ data: img.png, x: (13.333 - w) / 2, y: (7.5 - h) / 2, w, h });
    }
    const pptx = (await deck.write({ outputType: "nodebuffer" })) as Buffer;
    return { pdf, pptx };
  });
}
