import {
  bigint,
  index,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { generateMediaId } from "../../media/ids.js";
import { timestamps } from "./_shared.js";
import { organization } from "./auth.js";
import { profiles } from "./profiles.js";

/**
 * Media uploaded via `POST /v1/media`. The bytes live in S3; this row is
 * the metadata + tenancy anchor. Publishers reference media by id from the
 * post body (`media: [{ kind, mediaId }]`) and the resolver loads the row,
 * scope-checks (org + profile), and either streams from S3 or hands the
 * public URL to the upstream platform.
 *
 * `s3Key` stores the full bucket-relative key (`${env}/${orgId}/${id}.${ext}`)
 * so a future migration to a different prefix layout doesn't have to touch
 * any other column. Construct the public URL by joining `MEDIA_PUBLIC_BASE_URL`
 * + `/` + `s3Key`.
 *
 * No automatic deletion in v1. The bucket grows; lifecycle policy is a
 * follow-up if cost demands it.
 */
export const media = pgTable(
  "media",
  {
    /**
     * `med_` + 22 base62 chars. Unguessable; doubles as the public S3 key
     * basename. We deviate from the project's UUIDv7 PK convention here on
     * purpose: a monotonic timestamp prefix would leak ordering through the
     * public URL into third-party logs (Pinterest CDN, Meta audit trails).
     */
    id: text("id").primaryKey().$defaultFn(() => generateMediaId()),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Profile the upload landed under. Always set: `POST /v1/media` requires
     * a profile-scoped or profile-aware api key (mirrors `/v1/accounts` and
     * `/v1/posts` semantics).
     */
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    s3Key: text("s3_key").notNull(),
    ...timestamps,
  },
  (t) => ({
    byOrg: index("media_organization_id_idx").on(t.organizationId),
    byProfile: index("media_profile_id_idx").on(t.profileId),
  }),
);

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
