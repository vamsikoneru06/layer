import "server-only";
import { adminHandlers } from "./admin/handlers";
import { assetHandlers } from "./assets/handlers";
import { createAuth, createAuthRoute } from "./auth/auth";
import { createAuthenticator } from "./auth/current-user";
import { consoleMailer, gmailMailer, resendMailer } from "./auth/mailer";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { cronHandlers } from "./cron/handlers";
import { designHandlers } from "./designs/handlers";
import { folderHandlers } from "./folders/handlers";
import type { Deps } from "./deps";
import { healthHandlers } from "./health/handlers";
import type { Handler } from "./http/types";
import { createLogger } from "./logging";
import { meHandlers } from "./me/handlers";
import { seoHandlers } from "./seo/handlers";
import { shareHandlers } from "./shares/handlers";
import { databaseStorage } from "./storage/database";
import { storageFileHandlers } from "./storage/handlers";
import { s3Storage } from "./storage/s3";
import { templateHandlers } from "./templates/handlers";
import { publicTemplate } from "./templates/public";
import { userHandlers } from "./users/handlers";

function build() {
  const config = loadConfig(process.env);
  const logger = createLogger();
  const { db } = createDb(config.databaseUrl, (err) => logger.error("db.idle_client_error", { err }));
  const now = () => new Date();
  const mailer =
    config.mail.kind === "resend" ? resendMailer(config.mail) : config.mail.kind === "gmail" ? gmailMailer(config.mail) : consoleMailer(logger);
  const auth = createAuth({ db, config, mailer, now });
  const deps: Deps = { db, config, logger, now, authenticate: createAuthenticator(auth, db) };
  // An S3-compatible bucket when configured; otherwise photos are kept in the database itself.
  const storage = config.storage ? s3Storage(config.storage) : databaseStorage({ db, secret: config.authSecret, origin: config.appOrigin, now });
  return {
    auth: createAuthRoute(auth, config),
    health: healthHandlers(deps),
    folders: folderHandlers(deps),
    designs: designHandlers(deps),
    me: meHandlers(deps),
    templates: templateHandlers(deps, storage),
    shares: shareHandlers(deps, storage),
    users: userHandlers(deps),
    admin: adminHandlers(deps),
    assets: assetHandlers(deps, storage),
    cron: cronHandlers(deps, storage, config.cronSecret),
    seo: seoHandlers(deps),
    storageFiles: storageFileHandlers(deps, !config.storage),
    publicTemplate: (id: string) => publicTemplate(db, id),
  };
}

export type App = ReturnType<typeof build>;

let app: App | undefined;

/** Lazy, so `next build` never needs runtime env; built once per server instance on the first request. */
export function route(pick: (app: App) => Handler | ((req: Request) => Promise<Response>)): Handler {
  return (req, ctx) => pick((app ??= build()))(req, ctx);
}

/** The same lazily built app, for server components that read data directly (template pages). */
export const server = (): App => (app ??= build());
