import type { ReportContent, SubjectProperty } from "../cma-builder/cma-builder.types.js";

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
  return facts.length || sales.length || assessments.length ? { collectedAt: r.collectedAt, facts, sales, assessments } : null;
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
