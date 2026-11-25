// All database queries for Market myself. Only market-me.service.ts calls this file.
import { and, desc, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type AgentMarketingRow, agentMarketing, type MarketStatRow, marketStats, type ReviewRequestRow, reviewRequests } from "./market-me.model.js";

// ---------- Settings ----------

export async function findSettings(email: string): Promise<AgentMarketingRow | undefined> {
  const [row] = await getOrm().select().from(agentMarketing).where(eq(agentMarketing.email, email)).limit(1);
  return row;
}

export async function upsertSettings(email: string, patch: { reviewUrl?: string | null; areas?: string[] }): Promise<AgentMarketingRow> {
  const [row] = await getOrm()
    .insert(agentMarketing)
    .values({ email, reviewUrl: patch.reviewUrl ?? null, areas: patch.areas ?? [] })
    .onConflictDoUpdate({ target: agentMarketing.email, set: { ...patch, updatedAt: new Date() } })
    .returning();
  return row!;
}

// ---------- Review requests ----------

export async function findReviewByToken(token: string): Promise<ReviewRequestRow | undefined> {
  const [row] = await getOrm().select().from(reviewRequests).where(eq(reviewRequests.token, token)).limit(1);
  return row;
}

export async function insertReview(values: Omit<typeof reviewRequests.$inferInsert, "id">): Promise<ReviewRequestRow> {
  const [row] = await getOrm()
    .insert(reviewRequests)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function listReviewsForAgent(email: string, limit = 200): Promise<ReviewRequestRow[]> {
  return getOrm().select().from(reviewRequests).where(eq(reviewRequests.agentEmail, email)).orderBy(desc(reviewRequests.createdAt)).limit(limit);
}

export async function listAllReviews(limit = 2000): Promise<ReviewRequestRow[]> {
  return getOrm().select().from(reviewRequests).orderBy(desc(reviewRequests.createdAt)).limit(limit);
}

export async function updateReview(id: string, patch: Partial<Omit<typeof reviewRequests.$inferInsert, "id" | "createdAt">>): Promise<void> {
  await getOrm()
    .update(reviewRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(reviewRequests.id, id));
}

// ---------- Market stats ----------

export async function recentStats(area: string, limit = 30): Promise<MarketStatRow[]> {
  return getOrm().select().from(marketStats).where(eq(marketStats.area, area)).orderBy(desc(marketStats.month)).limit(limit);
}

export async function findAgentStat(area: string, month: string, email: string): Promise<MarketStatRow | undefined> {
  const [row] = await getOrm()
    .select()
    .from(marketStats)
    .where(and(eq(marketStats.area, area), eq(marketStats.month, month), eq(marketStats.source, "agent"), eq(marketStats.enteredBy, email)))
    .limit(1);
  return row;
}

export async function insertStat(values: Omit<typeof marketStats.$inferInsert, "id">): Promise<void> {
  await getOrm()
    .insert(marketStats)
    .values({ id: newId(), ...values });
}

export async function updateStat(id: string, patch: Partial<Omit<typeof marketStats.$inferInsert, "id" | "createdAt">>): Promise<void> {
  await getOrm()
    .update(marketStats)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(marketStats.id, id));
}
