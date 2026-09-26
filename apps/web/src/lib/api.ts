import { createEmptyDoc, type FormatKey } from "@vash/schema";

/** Browser client for the app's own JSON API. Errors carry the problem+json detail when there is one. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.json === undefined ? init?.headers : { "content-type": "application/json", ...init?.headers },
      body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
    });
  } catch {
    throw new ApiError(0, "Couldn’t reach VASH. Check your connection and try again.");
  }
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(res.status, problem?.detail ?? "Something went wrong. Please try again.");
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

type Page<T> = { items: T[]; nextCursor: string | null };

export type Me = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  handle: string | null;
  role: string;
  onboardedAt: string | null;
};

export type DesignItem = {
  id: string;
  title: string;
  folderId: string | null;
  version: number;
  format: string;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
};

export type Folder = { id: string; name: string };

/** `null` means a guest: the API answers 401 without a session. */
export async function getMe(): Promise<Me | null> {
  try {
    return await request<Me>("/api/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function listDesigns(q: { cursor?: string | null; folderId?: string | null; limit?: number } = {}): Promise<Page<DesignItem>> {
  const params = new URLSearchParams({ limit: String(q.limit ?? 50) });
  if (q.cursor) params.set("cursor", q.cursor);
  if (q.folderId) params.set("folderId", q.folderId);
  return request(`/api/designs?${params}`);
}

export function createDesign(format: FormatKey, size?: { width: number; height: number }): Promise<{ id: string }> {
  // The server stamps its own id onto the document.
  const doc = createEmptyDoc({ id: crypto.randomUUID(), kind: "design", title: "Untitled design", format, size });
  return request("/api/designs", { method: "POST", json: { doc } });
}

export const renameDesign = (id: string, title: string) => request<unknown>(`/api/designs/${id}`, { method: "PATCH", json: { title } });
export const moveDesign = (id: string, folderId: string | null) => request<unknown>(`/api/designs/${id}`, { method: "PATCH", json: { folderId } });

type FullDesign = Omit<DesignItem, "format" | "width" | "height"> & { doc: { meta: { format: string }; artboard: { width: number; height: number } } };

/** Single-design responses carry the whole document; cards only need its format and size. */
function toItem({ doc, ...d }: FullDesign): DesignItem {
  return { ...d, format: doc.meta.format, width: doc.artboard.width, height: doc.artboard.height };
}

export const duplicateDesign = async (id: string) => toItem(await request<FullDesign>(`/api/designs/${id}/duplicate`, { method: "POST" }));
export const deleteDesign = (id: string, keepalive = false) => request<void>(`/api/designs/${id}`, { method: "DELETE", keepalive });

export async function listAllFolders(): Promise<Folder[]> {
  const all: Folder[] = [];
  let cursor: string | null = null;
  do {
    const params: URLSearchParams = new URLSearchParams({ limit: "50", ...(cursor ? { cursor } : {}) });
    const page: Page<Folder> = await request(`/api/folders?${params}`);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export const createFolder = (name: string) => request<Folder>("/api/folders", { method: "POST", json: { name } });
export const renameFolder = (id: string, name: string) => request<Folder>(`/api/folders/${id}`, { method: "PATCH", json: { name } });
export const deleteFolder = (id: string) => request<void>(`/api/folders/${id}`, { method: "DELETE" });

export const signOut = () => request<unknown>("/api/auth/sign-out", { method: "POST", json: {} });
