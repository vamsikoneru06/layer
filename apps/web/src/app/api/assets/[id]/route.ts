import { route } from "@/server/context";

export const DELETE = route((app) => app.assets.remove);
