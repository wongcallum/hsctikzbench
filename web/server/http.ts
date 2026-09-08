import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string
  ) {
    super(message);
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch (e) {
    throw new HttpError(400, `invalid JSON: ${errorMessage(e)}`);
  }
}
