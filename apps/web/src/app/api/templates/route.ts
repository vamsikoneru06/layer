import { route } from "@/server/context";

export const GET = route((app) => app.templates.list);
