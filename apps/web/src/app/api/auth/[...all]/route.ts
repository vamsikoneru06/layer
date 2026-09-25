import { route } from "@/server/context";

export const GET = route((app) => app.auth.GET);
export const POST = route((app) => app.auth.POST);
