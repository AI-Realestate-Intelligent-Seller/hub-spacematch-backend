// An error that carries an HTTP status and a stable machine-readable code.
// Services throw these; the error-handler middleware turns them into responses.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Please sign in.") =>
  new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to this.") =>
  new HttpError(403, "forbidden", message);
export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const serviceUnavailable = (message: string) =>
  new HttpError(503, "service_unavailable", message);
