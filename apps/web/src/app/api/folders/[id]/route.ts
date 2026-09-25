import { route } from "@/server/context";

export const PATCH = route((app) => app.folders.rename);
export const DELETE = route((app) => app.folders.remove);
