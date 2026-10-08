import { relations, sql, type SQL } from "drizzle-orm";
import { boolean, check, customType, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Doc } from "@vash/schema";

/** Millisecond precision so keyset cursors round-trip through JavaScript Dates exactly. */
const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const emptyTextArray = sql`'{}'::text[]`;

// ── Better Auth core ─────────────────────────────────────────────────────────
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Better Auth's two-factor plugin (not settable from any request body).
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    // VASH extensions. Deliberately NOT declared to Better Auth, so sign-up bodies can never set them.
    handle: text("handle").unique(),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    interests: text("interests").array().notNull().default(emptyTextArray),
    onboardedAt: ts("onboarded_at"),
  },
  (t) => [check("user_role_check", sql`${t.role} in ('user', 'admin')`)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    // VASH: when this session last passed a two-factor code (admin tools need a recent one). Not declared to Better Auth.
    twoFactorVerifiedAt: ts("two_factor_verified_at"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Better Auth's two-factor plugin: the TOTP secret and backup codes, both encrypted with BETTER_AUTH_SECRET. */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
  },
  (t) => [index("two_factor_user_idx").on(t.userId)],
);

/** Lets Better Auth read a session and its user in one joined query (`advanced.database.joins`). */
export const sessionRelations = relations(session, ({ one }) => ({ user: one(user, { fields: [session.userId], references: [user.id] }) }));
export const userRelations = relations(user, ({ many }) => ({ sessions: many(session) }));

export const authSchema = { user, session, account, verification, twoFactor };

// ── VASH domain ─────────────────────────────────────────────────────────────
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("folders_owner_idx").on(t.ownerId, t.createdAt, t.id)],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = system asset (seed stickers, seed template photos). */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["photo", "thumbnail", "sticker"] }).notNull(),
    visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
    status: text("status", { enum: ["pending", "ready"] }).notNull().default("pending"),
    storageKey: text("storage_key").notNull().unique(),
    mime: text("mime", { enum: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"] }).notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Set on the system-owned public copies a published template uses; they go when it goes. */
    templateId: uuid("template_id").references((): AnyPgColumn => templates.id, { onDelete: "cascade" }),
    /** The original a published copy was made from, so a republish can reuse the copy. No FK: the original may be deleted. */
    sourceAssetId: uuid("source_asset_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("assets_owner_idx").on(t.ownerId, t.createdAt, t.id),
    index("assets_template_idx").on(t.templateId),
    check("assets_template_copy_check", sql`${t.templateId} is null or (${t.ownerId} is null and ${t.visibility} = 'public')`),
    index("assets_pending_idx").on(t.status, t.createdAt),
    check("assets_kind_check", sql`${t.kind} in ('photo', 'thumbnail', 'sticker')`),
    check("assets_visibility_check", sql`${t.visibility} in ('private', 'public')`),
    check("assets_status_check", sql`${t.status} in ('pending', 'ready')`),
    check("assets_mime_check", sql`${t.mime} in ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml')`),
    check("assets_bytes_check", sql`${t.bytes} > 0`),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = seed template. */
    authorId: text("author_id").references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    tags: text("tags").array().notNull().default(emptyTextArray),
    format: text("format").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    status: text("status", { enum: ["published", "hidden"] }).notNull().default("published"),
    featured: boolean("featured").notNull().default(false),
    currentVersion: integer("current_version").notNull().default(1),
    usesCount: integer("uses_count").notNull().default(0),
    /** title + tags, written by the service; the only full-text-indexed column (array_to_string is not immutable). */
    searchText: text("search_text").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("templates_search_idx").using("gin", sql`to_tsvector('simple', ${t.searchText})`),
    index("templates_gallery_idx").on(t.status, t.createdAt, t.id),
    index("templates_author_idx").on(t.authorId),
    index("templates_popular_idx").on(t.status, t.usesCount, t.id),
    check("templates_status_check", sql`${t.status} in ('published', 'hidden')`),
  ],
);

export const templateVersions = pgTable(
  "template_versions",
  {
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    doc: jsonb("doc").$type<Doc>().notNull(),
    thumbnailAssetId: uuid("thumbnail_asset_id").references(() => assets.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.version] })],
);

export const templateUses = pgTable(
  "template_uses",
  {
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.userId, t.day] })],
);

export const designs = pgTable(
  "designs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    doc: jsonb("doc").$type<Doc>().notNull(),
    // Kept by Postgres on every write, so design lists read them without loading whole documents (up to 1 MB each).
    format: text("format").generatedAlwaysAs((): SQL => sql`${designs.doc} -> 'meta' ->> 'format'`),
    width: integer("width").generatedAlwaysAs((): SQL => sql`round((${designs.doc} -> 'artboard' ->> 'width')::numeric)::int`),
    height: integer("height").generatedAlwaysAs((): SQL => sql`round((${designs.doc} -> 'artboard' ->> 'height')::numeric)::int`),
    version: integer("version").notNull().default(1),
    sourceTemplateId: uuid("source_template_id").references(() => templates.id, { onDelete: "set null" }),
    sourceTemplateVersion: integer("source_template_version"),
    thumbnailAssetId: uuid("thumbnail_asset_id").references(() => assets.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("designs_owner_idx").on(t.ownerId, t.updatedAt, t.id)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: ["spam", "inappropriate", "copyright", "privacy", "other"] }).notNull(),
    note: text("note").notNull().default(""),
    status: text("status", { enum: ["open", "actioned", "dismissed"] }).notNull().default("open"),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("reports_template_reporter_unique").on(t.templateId, t.reporterId),
    index("reports_queue_idx").on(t.status, t.createdAt, t.id),
    check("reports_reason_check", sql`${t.reason} in ('spam', 'inappropriate', 'copyright', 'privacy', 'other')`),
    check("reports_status_check", sql`${t.status} in ('open', 'actioned', 'dismissed')`),
  ],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designId: uuid("design_id").notNull().references(() => designs.id, { onDelete: "cascade" }),
    /** SHA-256 of the 128-bit token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("share_links_design_idx").on(t.designId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** No foreign key: entries must outlive the accounts they describe. */
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limits_window_idx").on(t.windowStart)],
);

export const storageDeletions = pgTable(
  "storage_deletions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucket: text("bucket", { enum: ["private", "public"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    /** Not processed before this time (upload URLs stay usable until they expire). */
    notBefore: ts("not_before").notNull().defaultNow(),
    /** Set for objects that count toward an uploader's quota until they're actually gone. No FKs: rows outlive both. */
    ownerId: text("owner_id"),
    assetId: uuid("asset_id"),
    bytes: integer("bytes"),
  },
  (t) => [
    check("storage_deletions_bucket_check", sql`${t.bucket} in ('private', 'public')`),
    index("storage_deletions_due_idx").on(t.notBefore, t.createdAt, t.id),
    index("storage_deletions_owner_idx").on(t.ownerId),
    index("storage_deletions_asset_idx").on(t.assetId),
  ],
);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (v) => (typeof Buffer !== "undefined" ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v),
  fromDriver: (v) => new Uint8Array(v),
});

/**
 * File bytes for the built-in storage used when no external object storage (S3 API) is configured:
 * photos live in the database itself, so uploads work with no extra service.
 */
export const storedObjects = pgTable(
  "stored_objects",
  {
    bucket: text("bucket", { enum: ["private", "public"] }).notNull(),
    key: text("key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.key] }), check("stored_objects_bucket_check", sql`${t.bucket} in ('private', 'public')`)],
);
