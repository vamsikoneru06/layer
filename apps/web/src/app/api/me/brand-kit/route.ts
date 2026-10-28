import { route } from "@/server/context";

export const GET = route((app) => app.brandKit.get);
export const PUT = route((app) => app.brandKit.put);
