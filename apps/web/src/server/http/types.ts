export interface RouteContext {
  params: Promise<Record<string, string>>;
}

export type Handler = (req: Request, ctx: RouteContext) => Promise<Response>;
