import "server-only";
import { createAuth, createAuthRoute } from "./auth/auth";
import { createAuthenticator } from "./auth/current-user";
import { consoleMailer, resendMailer } from "./auth/mailer";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { designHandlers } from "./designs/handlers";
import { folderHandlers } from "./folders/handlers";
import type { Deps } from "./deps";
import { healthHandlers } from "./health/handlers";
import type { Handler } from "./http/types";
import { createLogger } from "./logging";

function build() {
  const config = loadConfig(process.env);
  const logger = createLogger();
  const { db } = createDb(config.databaseUrl);
  const now = () => new Date();
  const mailer = config.mail.kind === "resend" ? resendMailer(config.mail) : consoleMailer(logger);
  const auth = createAuth({ db, config, mailer, now });
  const deps: Deps = { db, config, logger, now, authenticate: createAuthenticator(auth, db) };
  return {
    auth: createAuthRoute(auth, config),
    health: healthHandlers(deps),
    folders: folderHandlers(deps),
    designs: designHandlers(deps),
  };
}

export type App = ReturnType<typeof build>;

let app: App | undefined;

/** Lazy, so `next build` never needs runtime env; built once per server instance on the first request. */
export function route(pick: (app: App) => Handler | ((req: Request) => Promise<Response>)): Handler {
  return (req, ctx) => pick((app ??= build()))(req, ctx);
}
