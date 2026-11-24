// Fields our middlewares add to every request.
import type { AuthUser } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the request-id middleware; echoed back in the x-request-id header. */
      id: string;
      /** Set by the auth middleware once authentication is in place. */
      user?: AuthUser;
    }
  }
}

export {};
