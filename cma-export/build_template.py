"""One-off build step (run locally, commit the output): turn sources/new.pdf into the assets the Node
exporter (src/modules/cma-builder/report-template.ts) uses on Vercel, where Python isn't available.

  template/blank.pdf    new.pdf with every bound text box, every bound photo (except the logo) and the
                        "N / 43" page footers already removed: exactly what reference.render_pdf erases.
  template/fields.json  per field: page, box, font, size, colour, alignment, shrink limits.
  template/fonts/*.ttf  the fonts those fields use (full TTFs, or the subset embedded in new.pdf).

Run:  .venv/bin/python -I cma-export/build_template.py     (needs PyMuPDF from requirements.txt)
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import pymupdf as pdf  # noqa: E402
import reference as ref  # noqa: E402

OUT = HERE / "template"
(OUT / "fonts").mkdir(parents=True, exist_ok=True)

doc = pdf.open(ref.SOURCE)
if len(doc) != 43:
    raise SystemExit("Expected the 43-page new.pdf source")
bindings = ref.bindings(doc)
images = ref.image_bindings(doc)

# ---- fonts: same lookup as reference.get_font ----
fonts = {}
for name in sorted({b["font"] for b in bindings}):
    full = HERE / "fonts" / f"{name}.ttf"
    if full.is_file():
        shutil.copyfile(full, OUT / "fonts" / f"{name}.ttf")
        buffer = full.read_bytes()
    else:
        buffer = None
        for page in doc:
            for xref, ext, kind, base, *_ in page.get_fonts(full=True):
                if base.split("+")[-1].replace("-", "") == name.replace("-", "") and xref:
                    extracted = doc.extract_font(xref)
                    if extracted[1] != "ttf" or not extracted[3]:
                        raise SystemExit(f"{name}: embedded font is {extracted[1]}, expected TrueType")
                    buffer = extracted[3]
                    break
            if buffer:
                break
        if not buffer:
            raise SystemExit(f"Font {name} not found")
        (OUT / "fonts" / f"{name}.ttf").write_bytes(buffer)
    f = pdf.Font(fontbuffer=buffer)
    fonts[name] = {"file": f"fonts/{name}.ttf", "ascender": f.ascender, "descender": f.descender}

# ---- blank template: erase what render_pdf would erase or replace ----
footer = re.compile(r"\s*\d+\s*/\s*43\s*")
for number, page in enumerate(doc, 1):
    page_bindings = [b for b in bindings if b["page"] == number]
    for b in page_bindings:
        for box in b["erase"]:
            page.add_redact_annot(pdf.Rect(box), fill=False, cross_out=False)
    spans = [s for blk in ref.blocks(page) for line in blk.get("lines", []) for s in line["spans"] if footer.fullmatch(s["text"])]
    for s in spans:
        page.add_redact_annot(pdf.Rect(s["bbox"]), fill=False, cross_out=False)
    if page_bindings or spans:
        page.apply_redactions(images=0, graphics=0)
    targets = [t for t in images if t["page"] == number and t["field"] != "logo_image"]
    for t in targets:
        for image in t["images"]:
            page.add_redact_annot(pdf.Rect(image["bbox"]), fill=False, cross_out=False)
    if targets:
        page.apply_redactions(images=1, graphics=0, text=1)
    if page.rotation or page.mediabox.x0 or page.mediabox.y0:
        raise SystemExit(f"Page {number}: rotated or offset page boxes are not supported")
doc.save(OUT / "blank.pdf", garbage=4, deflate=True)

fields = [
    {
        "page": b["page"], "field": b["field"], "rect": b["rect"], "font": b["font"], "size": b["size"],
        "color": b["color"], "align": b["align"], "minimumSize": b.get("minimum_size"), "lineSpacing": b.get("line_spacing"),
    }
    for b in bindings
]
pages = {str(i + 1): [doc[i].rect.width, doc[i].rect.height] for i in range(len(doc))}
(OUT / "fields.json").write_text(json.dumps({"source": "sources/new.pdf", "pages": pages, "fonts": fonts, "fields": fields}, indent=1))
print(f"blank.pdf {(OUT / 'blank.pdf').stat().st_size // 1024} KB, {len(fields)} fields, fonts: {', '.join(fonts)}")
