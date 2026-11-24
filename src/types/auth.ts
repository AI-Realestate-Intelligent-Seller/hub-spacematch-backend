// Shared auth types. The users module and auth middleware fill these in.

/** Who someone is in the Hub. Replaces the hard-coded email lists in convex/agentsData.ts. */
export const ROLES = ["admin", "ops", "agent", "guest"] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
