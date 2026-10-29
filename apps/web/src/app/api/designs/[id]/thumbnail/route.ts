import { route } from "@/server/context";

export const PUT = route((app) => app.designs.setThumbnail);
