// All database queries for feedback and votes. Only feedback.service.ts calls this file.
import { and, desc, eq } from "drizzle-orm";
import { getOrm } from "../../db/client.js";
import { newId } from "../../utils/id.js";
import { type FeedbackRow, feedback, feedbackVotes, type NewFeedbackRow } from "./feedback.model.js";

export async function listFeedback(limit = 400): Promise<FeedbackRow[]> {
  return getOrm().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(limit);
}

export async function listVotes(): Promise<{ feedbackId: string; userId: string }[]> {
  return getOrm().select({ feedbackId: feedbackVotes.feedbackId, userId: feedbackVotes.userId }).from(feedbackVotes);
}

export async function findFeedback(id: string): Promise<FeedbackRow | undefined> {
  const [row] = await getOrm().select().from(feedback).where(eq(feedback.id, id)).limit(1);
  return row;
}

export async function insertFeedback(values: Omit<NewFeedbackRow, "id">): Promise<FeedbackRow> {
  const [row] = await getOrm()
    .insert(feedback)
    .values({ id: newId(), ...values })
    .returning();
  return row!;
}

export async function updateFeedback(id: string, patch: Partial<Omit<NewFeedbackRow, "id" | "createdAt">>): Promise<FeedbackRow | undefined> {
  const [row] = await getOrm()
    .update(feedback)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(feedback.id, id))
    .returning();
  return row;
}

export async function deleteFeedback(id: string): Promise<void> {
  await getOrm().delete(feedback).where(eq(feedback.id, id));
}

export async function hasVote(feedbackId: string, userId: string): Promise<boolean> {
  const [row] = await getOrm()
    .select({ userId: feedbackVotes.userId })
    .from(feedbackVotes)
    .where(and(eq(feedbackVotes.feedbackId, feedbackId), eq(feedbackVotes.userId, userId)))
    .limit(1);
  return !!row;
}

export async function addVote(feedbackId: string, userId: string): Promise<void> {
  await getOrm().insert(feedbackVotes).values({ feedbackId, userId }).onConflictDoNothing();
}

export async function removeVote(feedbackId: string, userId: string): Promise<void> {
  await getOrm().delete(feedbackVotes).where(and(eq(feedbackVotes.feedbackId, feedbackId), eq(feedbackVotes.userId, userId)));
}

export const newShotId = newId;
