import { S3Client } from "@aws-sdk/client-s3";

/**
 * Lazily-constructed singleton S3 client. Reads credentials from env at
 * first use so test runs that never touch S3 don't crash on boot.
 *
 * In production these are set on Railway's `apps/api` service. In dev the
 * same vars live in `apps/api/.env`. The bucket itself is configured
 * out-of-band (see plan.md Phase 7.5 for the bucket policy + IAM spec).
 */

let cachedClient: S3Client | null = null;

export function getS3Client(): S3Client {
  if (cachedClient) return cachedClient;
  const region = requireEnv("AWS_REGION");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");
  cachedClient = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

export function getBucketName(): string {
  return requireEnv("S3_BUCKET");
}

export function getPublicBaseUrl(): string {
  return requireEnv("MEDIA_PUBLIC_BASE_URL").replace(/\/+$/, "");
}

export function getEnvPrefix(): string {
  return requireEnv("MEDIA_ENV_PREFIX");
}

/** Force a re-read of env on next access — test-only. */
export function __resetS3CacheForTests(): void {
  cachedClient = null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} env var is required for the media upload service. See plan.md Phase 7.5.`,
    );
  }
  return value;
}

/**
 * Build the full S3 key for a media row: `${env}/${orgId}/${mediaId}.${ext}`.
 * Stored in the `s3Key` column verbatim so future prefix layout changes
 * touch one column.
 */
export function buildS3Key(args: {
  envPrefix: string;
  organizationId: string;
  mediaId: string;
  ext: string;
}): string {
  return `${args.envPrefix}/${args.organizationId}/${args.mediaId}.${args.ext}`;
}

export function buildPublicUrl(args: {
  publicBaseUrl: string;
  s3Key: string;
}): string {
  return `${args.publicBaseUrl}/${args.s3Key}`;
}

/**
 * Map a content-type to the file extension we tag onto the S3 key. Helps
 * platforms that sniff URL extensions (Pinterest historically, Meta sometimes)
 * even when our `Content-Type` header is correct.
 *
 * Conservative allowlist: the kinds we actually publish today. Unknown
 * types fall back to a `bin` extension and the upload still succeeds — the
 * platform-specific preflight is the right place to reject "we don't
 * publish video/x-flv to Pinterest", not this layer.
 */
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

export function extForContentType(contentType: string): string {
  const normalized = contentType.split(";")[0]!.trim().toLowerCase();
  return CONTENT_TYPE_TO_EXT[normalized] ?? "bin";
}
