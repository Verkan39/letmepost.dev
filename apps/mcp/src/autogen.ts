// Autogen MCP tool surface.
//
// Reads an OpenAPI 3.1 document at runtime and projects every documented
// operation into an MCP tool. One tool per (method, path). Input schemas are
// merged from path/query parameters and the JSON request body. $ref entries
// inside `#/components/...` are resolved inline so MCP clients see a flat,
// self-describing JSON schema.
//
// The goal is to keep this file the single source of truth for the tool
// surface — both the stdio binary (apps/mcp) and the hosted HTTP route
// (apps/api/src/routes/mcp.ts) call into here. When the OpenAPI spec
// changes, both servers pick up the diff on next restart.

import { readFileSync } from "node:fs";

export type ClientConfig = {
  apiKey: string;
  baseUrl: string;
};

export type ToolExecuteContext = {
  apiKey: string;
  baseUrl: string;
  /**
   * Optional override for the underlying fetch implementation. Useful when an
   * adapter wants to shortcut to a loopback or in-process Hono app instead of
   * the public network.
   */
  fetch?: typeof fetch;
  /** Optional idempotency key override; otherwise a UUID is generated. */
  idempotencyKey?: string;
};

export type AutogenTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolExecuteContext,
  ) => Promise<unknown>;
};

// Minimal OpenAPI types — we only read the bits we need.
type OpenApiDoc = {
  paths?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    parameters?: Record<string, Parameter>;
    requestBodies?: Record<string, RequestBody>;
  };
};

type PathItem = Record<string, Operation | unknown>;

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<Parameter | Ref>;
  requestBody?: RequestBody | Ref;
};

type Ref = { $ref: string };

type Parameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema | Ref;
};

type RequestBody = {
  required?: boolean;
  description?: string;
  content?: Record<string, { schema?: JsonSchema | Ref }>;
};

type JsonSchema = Record<string, unknown>;

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
] as const);
type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

// Paths that should never become MCP tools even if they appear in the spec.
// Defence in depth — the canonical spec already omits these.
const SKIP_PATH_PREFIXES = [
  "/api/auth",
  "/oauth",
  "/.well-known",
  "/health",
  "/data-deletion",
  "/mcp",
];

// Content types we can't reasonably express as an MCP input schema. Multipart
// uploads need a file pointer that doesn't survive a JSON-only protocol, so
// we skip them rather than ship a half-broken tool.
const SKIP_REQUEST_CONTENT_TYPES = new Set(["multipart/form-data"]);

/**
 * Read the OpenAPI document from disk. The path is resolved by the caller —
 * the stdio server and the API process bundle their own copy via a build
 * step. Returns the parsed JSON. Throws if the file is missing or invalid.
 */
export function loadOpenApiFromFile(filePath: string): OpenApiDoc {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as OpenApiDoc;
}

/**
 * Walk through a JSON schema-ish value and replace `$ref` entries that point
 * into the local document. Returns a fresh tree — the input is not mutated.
 * Cycles are broken by a visited set keyed by ref path; the second visit
 * collapses to an empty object schema, which is rare in our spec but worth
 * guarding against.
 */
function resolveRefs(node: unknown, doc: OpenApiDoc, seen: Set<string>): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, doc, seen));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const obj = node as Record<string, unknown>;
  const ref = obj["$ref"];
  if (typeof ref === "string") {
    if (seen.has(ref)) {
      return {};
    }
    const target = lookupRef(ref, doc);
    if (target === undefined) {
      // Leave the original ref in place if we can't resolve it — the client
      // will see the raw $ref and at least know what was expected.
      return { $ref: ref };
    }
    const next = new Set(seen);
    next.add(ref);
    return resolveRefs(target, doc, next);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = resolveRefs(v, doc, seen);
  }
  return out;
}

function lookupRef(ref: string, doc: OpenApiDoc): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let cur: unknown = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * Convert `{method}_{path}` into a slug like `post_v1_posts` or
 * `get_v1_accounts_by_id` (path params get a `by_` prefix). Stable across
 * runs so MCP clients can pin tool names.
 */
function deriveToolName(
  method: HttpMethod,
  pathTemplate: string,
  operationId: string | undefined,
): string {
  if (operationId && operationId.trim().length > 0) {
    return operationId
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  }
  const segments = pathTemplate.split("/").filter(Boolean);
  const slug = segments
    .map((seg) => {
      const match = seg.match(/^\{(.+)\}$/);
      if (match) return `by_${match[1]}`;
      return seg;
    })
    .join("_")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${method}_${slug}`;
}

function buildInputSchema(
  op: Operation,
  pathLevelParams: Array<Parameter | Ref>,
  doc: OpenApiDoc,
): { schema: Record<string, unknown>; supported: boolean; reason?: string } {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();

  // Merge path-level params first; the operation can shadow by (name, in).
  const seenParamKey = new Set<string>();
  const allParams: Parameter[] = [];
  const collectParam = (raw: Parameter | Ref) => {
    const resolved = resolveRefs(raw, doc, new Set()) as Parameter;
    if (!resolved || !resolved.name || !resolved.in) return;
    const key = `${resolved.in}:${resolved.name}`;
    if (seenParamKey.has(key)) return;
    seenParamKey.add(key);
    allParams.push(resolved);
  };
  for (const p of op.parameters ?? []) collectParam(p);
  for (const p of pathLevelParams) collectParam(p);

  for (const p of allParams) {
    if (p.in === "cookie") continue; // not supported via MCP

    // Skip the Idempotency-Key header — we inject it automatically.
    if (p.in === "header" && p.name.toLowerCase() === "idempotency-key") {
      continue;
    }

    const baseSchema =
      (resolveRefs(p.schema ?? {}, doc, new Set()) as JsonSchema) ?? {};
    const propSchema: Record<string, unknown> = { ...baseSchema };
    if (p.description && propSchema["description"] === undefined) {
      propSchema["description"] = p.description;
    }
    properties[p.name] = propSchema;
    if (p.required || p.in === "path") {
      required.add(p.name);
    }
  }

  // Merge JSON request body properties (if any).
  let supported = true;
  let reason: string | undefined;
  if (op.requestBody) {
    const body = resolveRefs(op.requestBody, doc, new Set()) as RequestBody;
    const content = body.content ?? {};
    const contentKeys = Object.keys(content);
    const jsonKey =
      contentKeys.find((k) => k === "application/json") ??
      contentKeys.find((k) => k.includes("json"));
    if (!jsonKey) {
      if (contentKeys.some((k) => SKIP_REQUEST_CONTENT_TYPES.has(k))) {
        supported = false;
        reason = `request body uses ${contentKeys.join(", ")} which is not supported by the MCP autogen layer`;
      }
    } else {
      const rawSchema = content[jsonKey]?.schema;
      if (rawSchema) {
        const bodySchema = resolveRefs(
          rawSchema,
          doc,
          new Set(),
        ) as JsonSchema;
        const bodyProps = (bodySchema["properties"] ?? {}) as Record<
          string,
          unknown
        >;
        for (const [k, v] of Object.entries(bodyProps)) {
          if (properties[k] === undefined) {
            properties[k] = v;
          }
        }
        if (Array.isArray(bodySchema["required"])) {
          for (const k of bodySchema["required"] as string[]) {
            required.add(k);
          }
        }
      }
    }
  }

  const schema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.size > 0) {
    schema["required"] = [...required];
  }
  return reason !== undefined
    ? { schema, supported, reason }
    : { schema, supported };
}

function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function applyPathTemplate(
  template: string,
  args: Record<string, unknown>,
  pathParamNames: Set<string>,
): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (!pathParamNames.has(key)) return `{${key}}`;
    const v = args[key];
    if (v === undefined || v === null) {
      throw new Error(`Missing required path parameter: ${key}`);
    }
    return encodeURIComponent(String(v));
  });
}

function buildQueryString(
  args: Record<string, unknown>,
  queryParamNames: Set<string>,
): string {
  const sp = new URLSearchParams();
  for (const name of queryParamNames) {
    const v = args[name];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        sp.append(name, String(item));
      }
    } else {
      sp.append(name, String(v));
    }
  }
  const qs = sp.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/**
 * Build the array of MCP tools from a parsed OpenAPI document. Pure — no
 * fetches happen until a tool's `execute()` is called.
 */
export function buildAutogenTools(doc: OpenApiDoc): AutogenTool[] {
  const tools: AutogenTool[] = [];
  const skipped: Array<{ method: string; path: string; reason: string }> = [];

  const paths = doc.paths ?? {};
  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    if (SKIP_PATH_PREFIXES.some((prefix) => pathTemplate.startsWith(prefix))) {
      skipped.push({
        method: "*",
        path: pathTemplate,
        reason: "skipped prefix",
      });
      continue;
    }

    const pathLevelParams = Array.isArray(
      (pathItem as { parameters?: unknown }).parameters,
    )
      ? ((pathItem as { parameters: Array<Parameter | Ref> }).parameters ?? [])
      : [];

    for (const [methodRaw, opRaw] of Object.entries(pathItem)) {
      const method = methodRaw.toLowerCase();
      if (!HTTP_METHODS.has(method as HttpMethod)) continue;
      const op = opRaw as Operation | undefined;
      if (!op || typeof op !== "object") continue;

      const name = deriveToolName(
        method as HttpMethod,
        pathTemplate,
        op.operationId,
      );

      const built = buildInputSchema(op, pathLevelParams, doc);
      if (!built.supported) {
        skipped.push({
          method,
          path: pathTemplate,
          reason: built.reason ?? "unsupported",
        });
        continue;
      }

      const description = composeDescription(op, method, pathTemplate);

      // Pre-compute which arg keys are path vs query so execute() can
      // route them correctly.
      const pathParamNames = new Set<string>();
      const queryParamNames = new Set<string>();
      const headerParamNames = new Set<string>();
      const allOpParams = [
        ...(op.parameters ?? []).map(
          (p) => resolveRefs(p, doc, new Set()) as Parameter,
        ),
        ...pathLevelParams.map(
          (p) => resolveRefs(p, doc, new Set()) as Parameter,
        ),
      ];
      for (const p of allOpParams) {
        if (!p || !p.name) continue;
        if (p.in === "path") pathParamNames.add(p.name);
        else if (p.in === "query") queryParamNames.add(p.name);
        else if (p.in === "header") headerParamNames.add(p.name);
      }

      const hasJsonBody = op.requestBody !== undefined;
      const httpMethod = method.toUpperCase();

      tools.push({
        name,
        description,
        inputSchema: built.schema,
        execute: async (args, ctx) => {
          const merged = args ?? {};
          const resolvedPath = applyPathTemplate(
            pathTemplate,
            merged,
            pathParamNames,
          );
          const qs = buildQueryString(merged, queryParamNames);
          const url = `${ctx.baseUrl}${resolvedPath}${qs}`;

          const headers = new Headers();
          headers.set("Authorization", `Bearer ${ctx.apiKey}`);
          headers.set("Accept", "application/json");
          for (const hn of headerParamNames) {
            const v = merged[hn];
            if (v !== undefined && v !== null) {
              headers.set(hn, String(v));
            }
          }

          const init: RequestInit = { method: httpMethod, headers };
          if (httpMethod !== "GET" && httpMethod !== "DELETE") {
            if (hasJsonBody) {
              // Body is everything that wasn't a path/query/header param.
              const bodyShape: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(merged)) {
                if (
                  pathParamNames.has(k) ||
                  queryParamNames.has(k) ||
                  headerParamNames.has(k)
                ) {
                  continue;
                }
                bodyShape[k] = v;
              }
              headers.set("Content-Type", "application/json");
              init.body = JSON.stringify(bodyShape);
            }
            if (!headers.has("Idempotency-Key")) {
              headers.set(
                "Idempotency-Key",
                ctx.idempotencyKey ?? newIdempotencyKey(),
              );
            }
          }

          const doFetch = ctx.fetch ?? fetch;
          const res = await doFetch(url, init);
          const text = await res.text();
          let body: unknown = text;
          if (text.length > 0) {
            try {
              body = JSON.parse(text);
            } catch {
              // Leave as text.
            }
          }
          return {
            status: res.status,
            ok: res.ok,
            body,
          };
        },
      });
    }
  }

  return tools;
}

function composeDescription(
  op: Operation,
  method: string,
  pathTemplate: string,
): string {
  const summary = op.summary?.trim();
  const description = op.description?.trim();
  if (summary && description) return `${summary}\n\n${description}`;
  if (summary) return summary;
  if (description) return description;
  return `${method.toUpperCase()} ${pathTemplate}`;
}

/**
 * Convenience wrapper: read the spec from disk and build the tool list in one
 * step. Mostly used by the stdio binary which has a single fixed path.
 */
export function loadAutogenTools(specPath: string): AutogenTool[] {
  const doc = loadOpenApiFromFile(specPath);
  return buildAutogenTools(doc);
}
