// All database queries for the CMA Builder. Only cma-builder services call this file.
import { and, desc, eq, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { listings } from "../listings/listing.model.js";
import {
  type CmaComparableRow,
  type CmaLogRow,
  type CmaMarketSnapshotRow,
  type CmaReportRow,
  cmaComparables,
  cmaLogs,
  cmaMarketSnapshots,
  cmaReports,
  type NewCmaComparableRow,
  type NewCmaReportRow,
} from "./cma-builder.model.js";
import { OPEN_STATUSES, type ReportStatus } from "./cma-builder.types.js";

type ReportPatch = Partial<Omit<NewCmaReportRow, "id" | "listingId" | "createdAt">>;

// ---------- Reports ----------

export async function insertReport(values: Omit<NewCmaReportRow, "id">): Promise<CmaReportRow> {
  const [row] = await getOrm()
    .insert(cmaReports)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export function copyReport(values: Omit<NewCmaReportRow, "id">, sourceId: string) {
  return getOrm().transaction(async tx => {
    const [report] = await tx.insert(cmaReports).values({ id: newId(), ...values }).returning();
    const source = await tx.select().from(cmaComparables).where(eq(cmaComparables.reportId, sourceId));
    if (source.length) {
      await tx.insert(cmaComparables).values(source.map(({ id: _id, reportId: _reportId, createdAt: _created, updatedAt: _updated, ...comp }) => ({
        ...comp, id: newId(), reportId: report!.id,
      })));
    }
    return report!;
  });
}

export async function findReport(id: string): Promise<CmaReportRow | undefined> {
  const [row] = await getOrm().select().from(cmaReports).where(eq(cmaReports.id, id)).limit(1);
  return row;
}

/** Updates only while the report is in one of `onlyIf` (when given). Returns undefined if it wasn't. */
export async function updateReport(id: string, patch: ReportPatch, onlyIf?: ReportStatus[]): Promise<CmaReportRow | undefined> {
  const [row] = await getOrm()
    .update(cmaReports)
    .set({ ...patch, updatedAt: new Date() })
    .where(onlyIf ? and(eq(cmaReports.id, id), inArray(cmaReports.status, onlyIf)) : eq(cmaReports.id, id))
    .returning();
  return row;
}

export function listRequestSummaries(agentEmail?: string) {
  return getOrm().select({
    id: cmaReports.id,
    listingId: cmaReports.listingId,
    address: sql<string>`${cmaReports.subject}->>'address'`,
    status: cmaReports.status,
    provider: cmaReports.provider,
    version: cmaReports.version,
    requestedByName: cmaReports.requestedByName,
    createdAt: cmaReports.createdAt,
  }).from(cmaReports)
    .innerJoin(listings, eq(listings.id, cmaReports.listingId))
    .where(agentEmail === undefined ? undefined : eq(listings.agentEmail, agentEmail))
    .orderBy(desc(cmaReports.createdAt), desc(cmaReports.id));
}

export async function listReports(listingId: string): Promise<CmaReportRow[]> {
  return getOrm().select().from(cmaReports).where(eq(cmaReports.listingId, listingId)).orderBy(desc(cmaReports.version));
}

export async function findOpenReport(listingId: string): Promise<CmaReportRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(cmaReports)
    .where(and(eq(cmaReports.listingId, listingId), inArray(cmaReports.status, OPEN_STATUSES)))
    .limit(1);
  return row;
}

export async function latestPublished(listingId: string): Promise<CmaReportRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(cmaReports)
    .where(and(eq(cmaReports.listingId, listingId), eq(cmaReports.status, "published")))
    .orderBy(desc(cmaReports.publishedAt))
    .limit(1);
  return row;
}

export async function nextVersion(listingId: string): Promise<number> {
  const [r] = await getOrm()
    .select({ v: sql<number>`coalesce(max(${cmaReports.version}), 0)::int` })
    .from(cmaReports)
    .where(eq(cmaReports.listingId, listingId));
  return (r?.v ?? 0) + 1;
}

/** The previous published version becomes "superseded" (kept for history). */
export async function supersedePublished(listingId: string, exceptId: string): Promise<void> {
  await getOrm()
    .update(cmaReports)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(and(eq(cmaReports.listingId, listingId), eq(cmaReports.status, "published"), ne(cmaReports.id, exceptId)));
}

/** Published reports on live listings (weekly refresh), skipping listings that already have an open report. */
export async function publishedOnLiveListings(): Promise<CmaReportRow[]> {
  const open = getOrm().select({ id: cmaReports.listingId }).from(cmaReports).where(inArray(cmaReports.status, OPEN_STATUSES));
  return getOrm()
    .select({ r: cmaReports })
    .from(cmaReports)
    .innerJoin(listings, eq(listings.id, cmaReports.listingId))
    .where(and(eq(cmaReports.status, "published"), inArray(listings.status, ["Coming soon", "Active"]), notInArray(cmaReports.listingId, open)))
    .then(rows => rows.map(x => x.r));
}

/** Reports stuck collecting for longer than `minutes` (a worker that died mid-job). */
export async function staleActive(minutes: number): Promise<CmaReportRow[]> {
  return getOrm()
    .select()
    .from(cmaReports)
    .where(and(inArray(cmaReports.status, ["collecting", "normalizing", "analyzing"]), lt(cmaReports.updatedAt, new Date(Date.now() - minutes * 60_000))));
}

// ---------- Comparables ----------

export async function listComps(reportId: string): Promise<CmaComparableRow[]> {
  return getOrm().select().from(cmaComparables).where(eq(cmaComparables.reportId, reportId)).orderBy(cmaComparables.createdAt);
}

export async function findComp(reportId: string, compId: string): Promise<CmaComparableRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(cmaComparables)
    .where(and(eq(cmaComparables.reportId, reportId), eq(cmaComparables.id, compId)))
    .limit(1);
  return row;
}

/** Inserts comparables; a property already on the report (same dedupe key) is skipped. Returns the inserted rows. */
export async function insertComps(values: Omit<NewCmaComparableRow, "id">[]): Promise<CmaComparableRow[]> {
  if (!values.length) return [];
  return getOrm()
    .insert(cmaComparables)
    .values(values.map(v => ({ id: newId(), ...v })))
    .onConflictDoNothing({ target: [cmaComparables.reportId, cmaComparables.dedupeKey] })
    .returning();
}

export async function updateComp(compId: string, patch: Partial<Omit<NewCmaComparableRow, "id" | "reportId" | "createdAt">>): Promise<CmaComparableRow | undefined> {
  const [row] = await getOrm()
    .update(cmaComparables)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(cmaComparables.id, compId))
    .returning();
  return row;
}

export async function setSelection(reportId: string, selectedIds: string[]): Promise<void> {
  await getOrm().transaction(async tx => {
    const now = new Date();
    await tx.update(cmaComparables).set({ selected: false, updatedAt: now }).where(eq(cmaComparables.reportId, reportId));
    if (selectedIds.length) {
      await tx
        .update(cmaComparables)
        .set({ selected: true, updatedAt: now })
        .where(and(eq(cmaComparables.reportId, reportId), inArray(cmaComparables.id, selectedIds)));
    }
  });
}

export async function deleteComp(compId: string): Promise<void> {
  await getOrm().delete(cmaComparables).where(eq(cmaComparables.id, compId));
}

/** Removes the collected (non-manual) comparables before a re-collection. Manual ones stay. */
export async function deleteCollectedComps(reportId: string): Promise<void> {
  await getOrm()
    .delete(cmaComparables)
    .where(and(eq(cmaComparables.reportId, reportId), eq(cmaComparables.manual, false)));
}

// ---------- Logs ----------

export async function insertLog(values: Omit<typeof cmaLogs.$inferInsert, "id">): Promise<void> {
  await getOrm()
    .insert(cmaLogs)
    .values({ id: newId(), ...values });
}

export async function listLogs(reportId: string, limit = 100): Promise<CmaLogRow[]> {
  return getOrm().select().from(cmaLogs).where(eq(cmaLogs.reportId, reportId)).orderBy(desc(cmaLogs.createdAt)).limit(limit);
}

// ---------- Market snapshots ----------

export async function insertSnapshot(values: Omit<typeof cmaMarketSnapshots.$inferInsert, "id">): Promise<void> {
  await getOrm()
    .insert(cmaMarketSnapshots)
    .values({ id: newId(), ...values });
}

export async function listSnapshots(listingId: string, limit = 52): Promise<CmaMarketSnapshotRow[]> {
  return getOrm().select().from(cmaMarketSnapshots).where(eq(cmaMarketSnapshots.listingId, listingId)).orderBy(desc(cmaMarketSnapshots.createdAt)).limit(limit);
}

export async function snapshotForReport(reportId: string): Promise<CmaMarketSnapshotRow | undefined> {
  const [row] = await getOrm().select().from(cmaMarketSnapshots).where(eq(cmaMarketSnapshots.reportId, reportId)).orderBy(desc(cmaMarketSnapshots.createdAt)).limit(1);
  return row;
}
