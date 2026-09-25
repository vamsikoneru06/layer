import { route } from "@/server/context";

export const GET = route((app) => app.folders.list);
export const POST = route((app) => app.folders.create);
