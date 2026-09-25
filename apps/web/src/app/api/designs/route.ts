import { route } from "@/server/context";

export const GET = route((app) => app.designs.list);
export const POST = route((app) => app.designs.create);
