import type { Db } from "../db/types";
import { isUuid } from "../http/ids";
import { getTemplateWithDoc } from "./repository";
import { toTemplateJson } from "./view";

/**
 * A published template as its public page shows it, read directly for server rendering and metadata.
 * Hidden templates are null here even for their author; the page then falls back to the API, which checks who asks.
 */
export async function publicTemplate(db: Db, id: string) {
  if (!isUuid(id)) return null;
  const row = await getTemplateWithDoc(db, id.toLowerCase());
  if (!row || row.status !== "published" || !row.doc) return null;
  const { doc, ...card } = row;
  return { ...toTemplateJson(card), doc };
}
