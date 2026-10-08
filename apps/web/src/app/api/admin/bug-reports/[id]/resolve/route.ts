import { route } from "@/server/context";

export const POST = route((app) => app.bugReports.resolve);
