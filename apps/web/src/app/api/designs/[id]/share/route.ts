import { route } from "@/server/context";

export const GET = route((app) => app.shares.list);
export const POST = route((app) => app.shares.create);
