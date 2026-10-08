import { createEmptyDoc, type Doc, type FormatKey } from "@vash/schema";

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

/** Saves a document made on this device to the account. With `id`, a repeat returns the design already saved. */
export const createDesignFromDoc = (doc: Doc, id?: string) => request<{ id: string }>("/api/designs", { method: "POST", json: id ? { id, doc } : { doc } });

export type Design = { id: string; title: string; version: number; folderId: string | null; doc: Doc; updatedAt: string };

export const getDesign = (id: string) => request<Design>(`/api/designs/${id}`);

/** Saves a new version; resolves to the version the server assigned. Rejects with status 409 on a conflict. */
export async function saveDesign(id: string, doc: Doc, version: number): Promise<number> {
  // The server answers without the document (often hundreds of KB) when asked; autosave only needs the version.
  return (await request<{ version: number }>(`/api/designs/${id}`, { method: "PUT", json: { doc, version }, headers: { prefer: "return=minimal" } })).version;
}

/** "Keep mine as a copy" after a conflict. */
export const saveDesignAsCopy = (doc: Doc, title: string) => request<{ id: string }>("/api/designs", { method: "POST", json: { doc, title } });

// Neither caller reads the design back, so the server can leave the document out of its answer.
const minimal = { prefer: "return=minimal" };
export const renameDesign = (id: string, title: string) => request<unknown>(`/api/designs/${id}`, { method: "PATCH", json: { title }, headers: minimal });
export const moveDesign = (id: string, folderId: string | null) => request<unknown>(`/api/designs/${id}`, { method: "PATCH", json: { folderId }, headers: minimal });

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

export const updateMe = (patch: { name?: string }) => request<Me>("/api/me", { method: "PATCH", json: patch });

export const deleteMe = (confirm: string) => request<void>("/api/me", { method: "DELETE", json: { confirm } });

export const signOut = () => request<unknown>("/api/auth/sign-out", { method: "POST", json: {} });

export type TemplateSort = "popular" | "new" | "featured";

export type TemplateItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  format: string;
  width: number;
  height: number;
  featured: boolean;
  usesCount: number;
  author: { handle: string | null; name: string | null } | null;
};

export type TemplateDetail = TemplateItem & { doc: Doc };

export function listTemplates(q: { q?: string; category?: string; format?: string; sort?: TemplateSort; cursor?: string | null; limit?: number } = {}): Promise<Page<TemplateItem>> {
  const params = new URLSearchParams({ limit: String(q.limit ?? 24), sort: q.sort ?? "popular" });
  if (q.q) params.set("q", q.q);
  if (q.category) params.set("category", q.category);
  if (q.format) params.set("format", q.format);
  if (q.cursor) params.set("cursor", q.cursor);
  return request(`/api/templates?${params}`);
}

export const getTemplate = (id: string) => request<TemplateDetail>(`/api/templates/${id}`);

/** Copies the template's current version into a new design of the signed-in user's. */
export const copyTemplate = (id: string) => request<{ id: string }>(`/api/templates/${id}/use`, { method: "POST", json: {} });

export type Photo = { id: string; kind: string; mime: string; bytes: number; width: number | null; height: number | null; createdAt: string };

export function listPhotos(cursor?: string | null): Promise<Page<Photo>> {
  // The API pages at most 50 items.
  const params = new URLSearchParams({ kind: "photo", limit: "48" });
  if (cursor) params.set("cursor", cursor);
  return request(`/api/assets?${params}`);
}

/** Short-lived URLs for showing assets (the documents and lists only ever hold ids). */
export const resolveAssets = (ids: string[]) =>
  request<{ assets: { id: string; url: string; expiresAt: string | null }[] }>("/api/assets/resolve", { method: "POST", json: { ids } });

export const deleteAsset = (id: string) => request<void>(`/api/assets/${id}`, { method: "DELETE" });

type UploadTicket = { asset: Photo; upload: { url: string; method: "PUT"; headers: Record<string, string> } };

export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/** Photos are sent at most this large; bigger ones are resized in the browser first. */
export const UPLOAD_MAX_SIDE = 2560;
/** Hosting platforms cap a request body at about 4.5 MB, so uploads stay under this. */
const DIRECT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The file to send: the original when it's small enough, otherwise a resized copy (JPEG stays JPEG;
 * PNG and WebP become WebP so transparency survives), stepping quality down until it fits.
 */
async function prepareUpload(file: File, bitmap: ImageBitmap): Promise<{ blob: Blob; width: number; height: number }> {
  const long = Math.max(bitmap.width, bitmap.height);
  if (long <= UPLOAD_MAX_SIDE && file.size <= DIRECT_MAX_BYTES) return { blob: file, width: bitmap.width, height: bitmap.height };
  const scale = Math.min(1, UPLOAD_MAX_SIDE / long);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
  for (const quality of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await canvas.convertToBlob({ type, quality });
    if (blob.size <= DIRECT_MAX_BYTES) return { blob, width, height };
  }
  throw new ApiError(413, `${file.name} is too detailed to upload, even resized.`);
}

/**
 * Uploads one photo: ask the API for a short-lived upload URL, send the file straight to storage,
 * then confirm it with its pixel size. Large photos are resized first. Throws an ApiError with a
 * readable message on any failure.
 */
export async function uploadPhoto(file: File): Promise<Photo> {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) throw new ApiError(415, `${file.name}: use a JPEG, PNG or WebP photo.`);
  if (file.size > UPLOAD_MAX_BYTES) throw new ApiError(413, `${file.name} is larger than 15 MB.`);
  let prepared: { blob: Blob; width: number; height: number };
  try {
    const bitmap = await createImageBitmap(file);
    try {
      prepared = await prepareUpload(file, bitmap);
    } finally {
      bitmap.close();
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(422, `${file.name} couldn't be read as an image.`);
  }
  const { blob, width, height } = prepared;
  const ticket = await request<UploadTicket>("/api/assets/uploads", { method: "POST", json: { kind: "photo", mime: blob.type, bytes: blob.size } });
  let put: Response;
  try {
    put = await fetch(ticket.upload.url, { method: ticket.upload.method, headers: ticket.upload.headers, body: blob });
  } catch {
    throw new ApiError(0, `${file.name} couldn't be uploaded. Check your connection and try again.`);
  }
  if (!put.ok) throw new ApiError(put.status, `${file.name} couldn't be uploaded (storage answered ${put.status}).`);
  return request<Photo>(`/api/assets/${ticket.asset.id}/complete`, { method: "POST", json: { width, height } });
}
