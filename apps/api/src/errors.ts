import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { ErrorCode, ErrorResponse } from "@letmepost/schemas";

export class LetmepostError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly rule?: string;
  readonly platform?: string;
  readonly platformVersion?: string;
  readonly platformResponse?: unknown;
  readonly remediation?: string;

  constructor(params: {
    code: ErrorCode;
    status: number;
    message: string;
    rule?: string;
    platform?: string;
    platformVersion?: string;
    platformResponse?: unknown;
    remediation?: string;
  }) {
    super(params.message);
    this.name = "LetmepostError";
    this.code = params.code;
    this.status = params.status;
    if (params.rule !== undefined) this.rule = params.rule;
    if (params.platform !== undefined) this.platform = params.platform;
    if (params.platformVersion !== undefined) this.platformVersion = params.platformVersion;
    if (params.platformResponse !== undefined) this.platformResponse = params.platformResponse;
    if (params.remediation !== undefined) this.remediation = params.remediation;
  }
}

function toResponseBody(
  err: LetmepostError,
  ctx: { requestId?: string; traceId?: string },
): ErrorResponse {
  const body: ErrorResponse = {
    error: {
      code: err.code,
      message: err.message,
    },
  };
  if (err.rule) body.error.rule = err.rule;
  if (err.platform) body.error.platform = err.platform;
  if (err.platformVersion) body.error.platformVersion = err.platformVersion;
  if (err.platformResponse !== undefined) body.error.platformResponse = err.platformResponse;
  if (err.remediation) body.error.remediation = err.remediation;
  if (ctx.requestId) body.error.requestId = ctx.requestId;
  if (ctx.traceId) body.error.traceId = ctx.traceId;
  return body;
}

function readContext(c: Context): { requestId?: string; traceId?: string } {
  const requestId = c.get("requestId") as string | undefined;
  const traceId = c.get("traceId") as string | undefined;
  const out: { requestId?: string; traceId?: string } = {};
  if (requestId) out.requestId = requestId;
  if (traceId) out.traceId = traceId;
  return out;
}

export const onError: ErrorHandler = (err, c: Context) => {
  const ctx = readContext(c);

  if (err instanceof LetmepostError) {
    return c.json(toResponseBody(err, ctx), err.status as Parameters<Context["json"]>[1]);
  }
  if (err instanceof ZodError) {
    const lp = new LetmepostError({
      code: "validation_failed",
      status: 400,
      message: "Request body failed validation.",
      rule: err.issues[0]?.path.join(".") || "body",
      platformResponse: err.issues,
      remediation: "Check the request body matches the documented schema.",
    });
    return c.json(toResponseBody(lp, ctx), 400);
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error("[letmepost] unhandled error", err);
  const fallback = new LetmepostError({
    code: "internal_error",
    status: 500,
    message: "An unexpected error occurred.",
  });
  return c.json(toResponseBody(fallback, ctx), 500);
};
