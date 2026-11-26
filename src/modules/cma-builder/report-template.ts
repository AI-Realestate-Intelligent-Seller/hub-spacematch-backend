// Fills the seller presentation template (cma-export/sources/new.pdf) with a CMA's fields, in Node so it
// runs on Vercel. A port of cma-export/reference.py render_pdf(): the same field boxes, fonts, sizes,
// colours, alignment, shrink-to-fit and "CONTINUED · n OF m" overflow pages.
// The template's own text and photos are removed ahead of time by cma-export/build_template.py
// (template/blank.pdf + template/fields.json), because pdf-lib can't read or redact PDF text.
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

type Field = {
  page: number; field: string; rect: [number, number, number, number]; font: string; size: number; color: number;
  align: "left" | "right" | "center"; minimumSize: number | null; lineSpacing: number | null;
};
type FontInfo = { file: string; ascender: number; descender: number };
type Spec = { pages: Record<string, [number, number]>; fonts: Record<string, FontInfo>; fields: Field[] };

// Literal `new URL(..., import.meta.url)` paths so Vercel's file tracing bundles these assets.
const ASSETS = {
  blank: new URL("../../../cma-export/template/blank.pdf", import.meta.url),
  spec: new URL("../../../cma-export/template/fields.json", import.meta.url),
  fonts: {
    "Mada-Regular": new URL("../../../cma-export/template/fonts/Mada-Regular.ttf", import.meta.url),
    "Mada-Bold": new URL("../../../cma-export/template/fonts/Mada-Bold.ttf", import.meta.url),
    "GowunDodum-Regular": new URL("../../../cma-export/template/fonts/GowunDodum-Regular.ttf", import.meta.url),
  } as Record<string, URL>,
};

const NO_SUBSET = new Set(["GowunDodum-Regular"]);

let cache: Promise<{ blank: Uint8Array; spec: Spec; fontBytes: Record<string, Uint8Array> }> | undefined;
function assets() {
  cache ??= (async () => {
    const spec = JSON.parse(await readFile(ASSETS.spec, "utf8")) as Spec;
    const fontBytes: Record<string, Uint8Array> = {};
    for (const name of Object.keys(spec.fonts)) {
      const url = ASSETS.fonts[name];
      if (!url) throw new Error(`Template font ${name} is not bundled`);
      fontBytes[name] = await readFile(url);
    }
    return { blank: await readFile(ASSETS.blank), spec, fontBytes };
  })();
  cache.catch(() => (cache = undefined));
  return cache;
}

/** reference.derived(): fields built from other fields. */
export function derived(data: Record<string, string | null | undefined>) {
  const d: Record<string, string | null | undefined> = { ...data };
  const v = (k: string) => (data[k] == null || data[k] === "" ? "—" : String(data[k]));
  d.agent_eyebrow = v("agent_name") !== "—" ? "M E E T  " + [...v("agent_name").split(/\s+/)[0]!.toUpperCase()].join(" ") : "M E E T  Y O U R  A G E N T";
  d.cover_caption = data.cover_caption || `Prepared for ${v("seller_name")}  ·  ${v("property_address")}  ·  ${v("presentation_date")}`;
  d.subject_address = v("property_address").split(",")[0];
  d.subject_location = v("property_subtitle").split(" · ")[0]!.split("  ·  ")[0];
  d.property_caption = `${v("property_address")} · ${v("property_type")}`;
  d.objections_caption = v("objections") !== "—" ? v("objections") + " — things we plan for" : "—";
  d.market_summary = `Recent solds ${v("market_recent_solds")}   ·   Price reductions ${v("market_price_reductions")}   ·   Market direction ${v("market_trend")}`;
  d.market_source_caption = data.market_source_caption || `SOURCE: ${v("market_source")} · ${v("market_scope")} · AS OF ${v("market_as_of")} — never estimated; pulled live per property`;
  d.proof_financial_caption = v("proof_property_summary") + "\n" + v("proof_property_financials");
  d.comparables_summary_note = data.comparables_summary_note || v("comparables_source_note");
  d.agent_name = v("agent_name") !== "—" ? v("agent_name").toUpperCase().replace(/\.+$/, "") + "." : "—";
  return d;
}

type Measure = { width: (text: string, size: number) => number; ascender: number; descender: number };

/** reference.wrap(): greedy word wrap; words wider than the box are broken by character. */
export function wrap(text: string, m: Measure, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const trial = (line + " " + word).trim();
      if (m.width(trial, size) <= width) line = trial;
      else {
        if (line) {
          lines.push(line);
          line = "";
        }
        for (const ch of word) {
          if (line && m.width(line + ch, size) > width) {
            lines.push(line);
            line = "";
          }
          line += ch;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

type Piece = { size: number; lines: string[]; leading: number };

/** reference.layout(): shrink in 0.25 pt steps down to the minimum, then split into box-sized pieces. */
export function layout(f: Field, text: string, m: Measure): Piece[] {
  const [x0, y0, x1, y1] = f.rect;
  const w = x1 - x0;
  const h = y1 - y0;
  let size = f.size;
  const minimum = Math.min(size, f.minimumSize ?? 7);
  const metrics = m.ascender - m.descender;
  for (;;) {
    const lines = wrap(text, m, size, w);
    const leading = (f.lineSpacing ?? Math.max(1.18, metrics)) * size;
    const height = metrics * size + Math.max(0, lines.length - 1) * leading;
    if (height <= h + 0.1) return [{ size, lines, leading }];
    if (size <= minimum) {
      const capacity = Math.max(1, Math.floor((h - metrics * size + 0.1) / leading) + 1);
      const out: Piece[] = [];
      for (let i = 0; i < lines.length; i += capacity) out.push({ size, lines: lines.slice(i, i + capacity), leading });
      return out;
    }
    size = Math.max(minimum, size - 0.25);
  }
}

/** The seller template pages for `pages`, filled with `data` (render_pdf(..., pages, clear_missing_images=True)). */
export async function renderTemplate(data: Record<string, string>, pages: number[]): Promise<PDFDocument> {
  const { blank, spec, fontBytes } = await assets();
  const source = await PDFDocument.load(blank);
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const embedded = new Map<string, PDFFont>();
  const fontFor = async (name: string) => {
    let f = embedded.get(name);
    if (!f) {
      // pdf-lib's subsetter drops glyphs from GowunDodum (a large CJK font): embed that one whole.
      f = await out.embedFont(fontBytes[name]!, { subset: !NO_SUBSET.has(name) });
      embedded.set(name, f);
    }
    return f;
  };
  const helvetica = await out.embedFont(StandardFonts.Helvetica);
  const values = derived(data);

  type Entry = { f: Field; font: PDFFont; m: Measure; pieces: Piece[] };
  const continuations: { index: number; part: number; count: number }[] = [];
  for (const pageNumber of pages) {
    const entries: Entry[] = [];
    for (const f of spec.fields.filter(x => x.page === pageNumber)) {
      let text = values[f.field];
      text = text == null || !String(text).trim() ? "—" : String(text);
      const font = await fontFor(f.font);
      const info = spec.fonts[f.font]!;
      // Characters the font can't draw become "?" (as the Python exporter does).
      const glyphs = (font as unknown as { embedder: { font: { hasGlyphForCodePoint(c: number): boolean } } }).embedder.font;
      text = [...text].map(c => (/\s/.test(c) || glyphs.hasGlyphForCodePoint(c.codePointAt(0)!) ? c : "?")).join("");
      const m: Measure = { width: (t, s) => font.widthOfTextAtSize(t, s), ascender: info.ascender, descender: info.descender };
      entries.push({ f, font, m, pieces: layout(f, text, m) });
    }
    const count = Math.max(1, ...entries.map(e => e.pieces.length));
    for (let part = 0; part < count; part++) {
      const [page] = await out.copyPages(source, [pageNumber - 1]);
      out.addPage(page!);
      const height = page!.getHeight();
      if (part) continuations.push({ index: out.getPageCount() - 1, part: part + 1, count });
      for (const e of entries) {
        const piece = e.pieces.length === 1 ? e.pieces[0]! : part < e.pieces.length ? e.pieces[part]! : layout(e.f, "—", e.m)[0]!;
        const [x0, y0, x1] = e.f.rect;
        const c = e.f.color;
        const color = rgb(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
        piece.lines.forEach((line, i) => {
          const width = e.font.widthOfTextAtSize(line, piece.size);
          const x = e.f.align === "right" ? x1 - width : e.f.align === "center" ? x0 + (x1 - x0 - width) / 2 : x0;
          // PyMuPDF places the baseline at y0 + ascender·size from the top; PDF y runs bottom-up.
          const baseline = y0 + e.m.ascender * piece.size + i * piece.leading;
          if (line) page!.drawText(line, { x, y: height - baseline, size: piece.size, font: e.font, color });
        });
      }
    }
  }
  for (const c of continuations) {
    const page = out.getPage(c.index);
    page.drawText(`CONTINUED · ${c.part} OF ${c.count}`, { x: 64.8, y: page.getHeight() - 32, size: 8, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
  }
  return out;
}
