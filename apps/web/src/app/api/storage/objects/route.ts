import { route } from "@/server/context";

export const GET = route((app) => app.storageFiles.get);
export const PUT = route((app) => app.storageFiles.put);
