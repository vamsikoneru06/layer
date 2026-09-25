import { route } from "@/server/context";

export const GET = route((app) => app.me.get);
export const PATCH = route((app) => app.me.patch);
export const DELETE = route((app) => app.me.remove);
