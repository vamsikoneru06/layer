import type { AppConfig } from "./config";
import type { Db } from "./db/types";
import type { Logger } from "./logging";

export interface CurrentUser {
  id: string;
  email: string;
  role: "user" | "admin";
  handle: string | null;
  /** Whether two-factor is set up, and when the current session last passed a code. */
  twoFactor: { enabled: boolean; verifiedAt: Date | null };
}

export interface Deps {
  db: Db;
  config: AppConfig;
  logger: Logger;
  now: () => Date;
  authenticate(req: Request): Promise<CurrentUser | null>;
}
