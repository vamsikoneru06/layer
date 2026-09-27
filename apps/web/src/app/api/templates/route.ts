import { route } from "@/server/context";

export const GET = route((app) => app.templates.list);
export const POST = route((app) => app.templates.publish);
