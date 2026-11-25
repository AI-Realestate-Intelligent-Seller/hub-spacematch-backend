// All database queries for listings and their events, metrics, suggestions and the
// ShowingTime inbox. Only the listings services call this file.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import {
  type ListingEventRow,
  type ListingMetricRow,
  type ListingRow,
  type ListingSuggestionRow,
  listingEvents,
  listingMetrics,
  listings,
  listingSuggestions,
  type NewListingRow,
  type ShowingInboxRow,
  showingInbox,
} from "./listing.model.js";

const LIST_LIMIT = 300;

// ---------- Listings ----------

export async function insertListing(values: Omit<NewListingRow, "id">): Promise<ListingRow> {
  const [row] = await getOrm()
    .insert(listings)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function findListingById(id: string): Promise<ListingRow | undefined> {
  const [row] = await getOrm().select().from(listings).where(eq(listings.id, id)).limit(1);
  return row;
}

export async function findListingByToken(token: string): Promise<ListingRow | undefined> {
  const [row] = await getOrm().select().from(listings).where(eq(listings.token, token)).limit(1);
  return row;
}

/** Newest first. Pass agentEmail for one agent's listings; omit for the whole team. */
export async function listListings(filter: { agentEmail?: string } = {}): Promise<ListingRow[]> {
  return getOrm()
    .select()
    .from(listings)
    .where(filter.agentEmail ? eq(listings.agentEmail, filter.agentEmail) : undefined)
    .orderBy(desc(listings.createdAt))
    .limit(LIST_LIMIT);
}

/** Listings that are on the market (Coming soon / Active), for the weekly emails. */
export async function listLive(): Promise<ListingRow[]> {
  return getOrm().select().from(listings).where(inArray(listings.status, ["Coming soon", "Active"]));
}

export async function updateListing(id: string, patch: Partial<Omit<NewListingRow, "id" | "createdAt">>): Promise<ListingRow | undefined> {
  const [row] = await getOrm()
    .update(listings)
    .set({ updatedAt: new Date(), ...patch }) // pass updatedAt to keep it (e.g. "seller seen")
    .where(eq(listings.id, id))
    .returning();
  return row;
}

/** Bumps updated_at (the seller page shows "updated …"). */
export async function touchListing(id: string): Promise<void> {
  await getOrm().update(listings).set({ updatedAt: new Date() }).where(eq(listings.id, id));
}

/** Events, metrics and suggestions go with it (ON DELETE CASCADE). */
export async function deleteListing(id: string): Promise<void> {
  await getOrm().delete(listings).where(eq(listings.id, id));
}

// ---------- Events ----------

export async function listEvents(listingId: string): Promise<ListingEventRow[]> {
  return getOrm().select().from(listingEvents).where(eq(listingEvents.listingId, listingId)).orderBy(desc(listingEvents.createdAt));
}

/** Kind + status of every event for many listings at once (list-page counters). */
export async function eventSummaries(listingIds: string[]): Promise<Pick<ListingEventRow, "listingId" | "kind" | "status">[]> {
  if (!listingIds.length) return [];
  return getOrm()
    .select({ listingId: listingEvents.listingId, kind: listingEvents.kind, status: listingEvents.status })
    .from(listingEvents)
    .where(inArray(listingEvents.listingId, listingIds));
}

export async function insertEvent(values: Omit<typeof listingEvents.$inferInsert, "id">): Promise<ListingEventRow> {
  const [row] = await getOrm()
    .insert(listingEvents)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function findEventById(id: string): Promise<ListingEventRow | undefined> {
  const [row] = await getOrm().select().from(listingEvents).where(eq(listingEvents.id, id)).limit(1);
  return row;
}

export async function updateEvent(id: string, patch: Partial<Pick<ListingEventRow, "status" | "body">>): Promise<ListingEventRow | undefined> {
  const [row] = await getOrm()
    .update(listingEvents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(listingEvents.id, id))
    .returning();
  return row;
}

export async function deleteEvent(id: string): Promise<void> {
  await getOrm().delete(listingEvents).where(eq(listingEvents.id, id));
}

// ---------- Weekly metrics ----------

export async function listMetrics(listingId: string): Promise<ListingMetricRow[]> {
  return getOrm().select().from(listingMetrics).where(eq(listingMetrics.listingId, listingId)).orderBy(asc(listingMetrics.weekOf));
}

export async function metricsForWeek(listingIds: string[], weekOf: string): Promise<ListingMetricRow[]> {
  if (!listingIds.length) return [];
  return getOrm()
    .select()
    .from(listingMetrics)
    .where(and(inArray(listingMetrics.listingId, listingIds), eq(listingMetrics.weekOf, weekOf)));
}

export async function findMetric(listingId: string, weekOf: string): Promise<ListingMetricRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(listingMetrics)
    .where(and(eq(listingMetrics.listingId, listingId), eq(listingMetrics.weekOf, weekOf)))
    .limit(1);
  return row;
}

type MetricValues = Omit<typeof listingMetrics.$inferInsert, "id" | "listingId" | "weekOf" | "createdAt" | "updatedAt">;

/** Replaces the whole row for that week (same as Convex's db.replace). */
export async function upsertMetric(listingId: string, weekOf: string, values: MetricValues): Promise<void> {
  const full = {
    zillowViews: null, zillowSaves: null, mlsSaved: null, mlsMaybe: null, mlsNotInterested: null,
    adViews: null, adClicks: null, reelViews: null, tiktokViews: null, fbViews: null, youtubeViews: null,
    auto: [], zillowDays: null,
    ...values,
  };
  await getOrm()
    .insert(listingMetrics)
    .values({ id: newId(), listingId, weekOf, ...full })
    .onConflictDoUpdate({ target: [listingMetrics.listingId, listingMetrics.weekOf], set: { ...full, updatedAt: new Date() } });
}

// ---------- Suggestions ----------

export async function listSuggestions(listingId: string): Promise<ListingSuggestionRow[]> {
  return getOrm()
    .select()
    .from(listingSuggestions)
    .where(eq(listingSuggestions.listingId, listingId))
    .orderBy(asc(listingSuggestions.createdAt));
}

export async function insertSuggestions(values: Omit<typeof listingSuggestions.$inferInsert, "id">[]): Promise<ListingSuggestionRow[]> {
  if (!values.length) return [];
  return getOrm()
    .insert(listingSuggestions)
    .values(values.map(v => ({ id: newId(), ...v })))
    .returning();
}

export async function findSuggestionById(id: string): Promise<ListingSuggestionRow | undefined> {
  const [row] = await getOrm().select().from(listingSuggestions).where(eq(listingSuggestions.id, id)).limit(1);
  return row;
}

export async function updateSuggestion(
  id: string,
  patch: Partial<Pick<ListingSuggestionRow, "title" | "why" | "action" | "status" | "approvedAt">>,
): Promise<ListingSuggestionRow | undefined> {
  const [row] = await getOrm()
    .update(listingSuggestions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(listingSuggestions.id, id))
    .returning();
  return row;
}

export async function approveSuggestions(ids: string[], at: Date): Promise<void> {
  if (!ids.length) return;
  await getOrm().update(listingSuggestions).set({ approvedAt: at, updatedAt: at }).where(inArray(listingSuggestions.id, ids));
}

export async function deleteSuggestion(id: string): Promise<void> {
  await getOrm().delete(listingSuggestions).where(eq(listingSuggestions.id, id));
}

// ---------- ShowingTime inbox ----------

export async function listInbox(limit = 50): Promise<ShowingInboxRow[]> {
  return getOrm().select().from(showingInbox).orderBy(desc(showingInbox.createdAt)).limit(limit);
}

export async function findInboxById(id: string): Promise<ShowingInboxRow | undefined> {
  const [row] = await getOrm().select().from(showingInbox).where(eq(showingInbox.id, id)).limit(1);
  return row;
}

export async function deleteInbox(id: string): Promise<void> {
  await getOrm().delete(showingInbox).where(eq(showingInbox.id, id));
}
