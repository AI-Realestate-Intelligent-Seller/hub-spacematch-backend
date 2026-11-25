// Builds the Express app. Kept separate from server.ts so tests (and Vercel)
// can import the app without opening a port.
import cors from "cors";
import express, { type Express, type RequestHandler } from "express";
import helmetExport from "helmet";
import { config } from "./config/index.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFoundHandler } from "./middlewares/not-found.js";
import { requestId } from "./middlewares/request-id.js";
import { requestLogger } from "./middlewares/request-logger.js";
import { requestTimeout } from "./middlewares/request-timeout.js";
import { authHandler } from "./modules/auth/auth.routes.js";
import { moduleRoutes } from "./modules/index.js";

type HelmetFactory = () => RequestHandler;

// Keep the import static for Vercel's file tracer and handle CommonJS interop.
function createHelmetMiddleware(helmet: HelmetFactory | { default: HelmetFactory }) {
  return (typeof helmet === "function" ? helmet : helmet.default)();
}

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Vercel's proxy: real client IP for rate limits

  app.use(requestId);
  app.use(requestLogger);
  app.use(requestTimeout);
  app.use(createHelmetMiddleware(helmetExport));
  app.use(
    cors({
      origin: config.cors.origins,
      credentials: true, // auth cookies
    }),
  );
  // Better Auth reads the raw body itself, so it is mounted before express.json().
  app.all("/api/v1/auth/{*any}", authHandler);

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1", moduleRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;
