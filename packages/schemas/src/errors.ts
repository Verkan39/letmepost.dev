import { z } from "zod";

export const ErrorCode = z.enum([
  "validation_failed",
  "preflight_failed",
  "platform_auth_failed",
  "platform_rejected",
  "platform_unavailable",
  "internal_error",
  "unauthenticated",
  "unauthorized",
  "not_found",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    rule: z.string().optional().describe("The specific preflight rule or validator that failed"),
    platform: z.string().optional(),
    platformResponse: z.unknown().optional().describe("Raw upstream platform response, when available"),
    remediation: z.string().optional().describe("Actionable next step for the caller"),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
