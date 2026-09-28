import "server-only";
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
import { shareHandlers } from "./shares/handlers";
import { s3Storage } from "./storage/s3";
import { templateHandlers } from "./templates/handlers";
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
  const storage = config.storage ? s3Storage(config.storage) : null;
  return {
    auth: createAuthRoute(auth, config),
    health: healthHandlers(deps),
    folders: folderHandlers(deps),
    designs: designHandlers(deps),
    me: meHandlers(deps),
    templates: templateHandlers(deps, storage),
    shares: shareHandlers(deps, storage),
    users: userHandlers(deps),
    assets: assetHandlers(deps, storage),
    cron: cronHandlers(deps, storage, config.cronSecret),
  };
}

export type App = ReturnType<typeof build>;

let app: App | undefined;

/** Lazy, so `next build` never needs runtime env; built once per server instance on the first request. */
export function route(pick: (app: App) => Handler | ((req: Request) => Promise<Response>)): Handler {
  return (req, ctx) => pick((app ??= build()))(req, ctx);
}
