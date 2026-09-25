import { route } from "@/server/context";

export const GET = route((app) => app.designs.get);
export const PUT = route((app) => app.designs.save);
export const PATCH = route((app) => app.designs.patch);
export const DELETE = route((app) => app.designs.remove);
