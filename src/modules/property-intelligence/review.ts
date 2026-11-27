import type { ReportContent, SubjectProperty } from "../cma-builder/cma-builder.types.js";
import type { Research, ResearchCounty } from "./research-shared.js";

export const PUBLIC_RECORDS = "public-records";
export const factSubjectField = { beds: "beds", baths: "baths", yearBuilt: "yearBuilt" } as const;

export function approvedResearch(content: ReportContent, subject?: SubjectProperty) {
  const r = content.research;
  const approved = new Set(content.researchApprovals);
  if (!r || !approved.size) return null;
  const facts = Object.entries(r.facts).flatMap(([key, fact]) => {
    const field = factSubjectField[key as keyof typeof factSubjectField];
    return approved.has(key) && (!field || subject?.[field] == null || subject[field] === fact.value) ? [{ ...fact, approval: "approved" as const }] : [];
  });
  const sales = approved.has("sales") ? r.sales : [];
  const assessments = approved.has("assessments") ? r.assessments : [];
  return facts.length || sales.length || assessments.length ? { collectedAt: r.collectedAt, facts, sales, assessments, county: researchCounty(r) } : null;
}

/** The county the records came from. Research saved before county adapters existed is Cook's. */
export function researchCounty(r: Pick<Research, "county"> | undefined): ResearchCounty {
  return r?.county ?? { name: "Cook County", provider: "Cook County Assessor", salesUrl: "https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json", assessmentsUrl: "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json" };
}

/** County records can fill gaps in analysis. Editable CMA facts remain under the agent's control. */
export function subjectForAnalysis(subject: SubjectProperty, content: ReportContent): SubjectProperty {
  const facts = content.research?.facts;
  if (!facts || content.research?.status === "clarification") return subject;
  const enriched = { ...subject };
  for (const [key, field] of Object.entries(factSubjectField)) {
    const value = facts[key]?.value;
    if (enriched[field] == null && typeof value === "number") enriched[field] = value;
  }
  return enriched;
}
