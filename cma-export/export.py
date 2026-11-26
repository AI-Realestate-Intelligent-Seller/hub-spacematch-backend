"""Render the listing-specific template pages and append the full CMA analysis."""
import json
import sys
from pathlib import Path

import pymupdf

from reference import preview_pptx, render_pdf

directory = Path(sys.argv[1])
payload = json.loads((directory / "report.json").read_text(encoding="utf-8"))
template = render_pdf(payload["fields"], directory / "template.pdf", base=directory,
                      pages=payload["pages"], clear_missing_images=True)
output = directory / "report.pdf"
with pymupdf.open(template) as report, pymupdf.open(directory / "analysis.pdf") as analysis:
    report.insert_pdf(analysis, links=False)
    report.set_metadata({"title": "Comparative Market Analysis", "author": "SpaceMatch Inc."})
    report.save(output, garbage=4, deflate=True)
preview_pptx(output, directory / "report.pptx")
