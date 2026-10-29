import type { Db } from "../db/types";
import { isUuid } from "../http/ids";
import { getTemplateCard, getTemplateVersion } from "./repository";
import { toTemplateJson } from "./view";

/**
 * A published template as its public page shows it, read directly for server rendering and metadata.
 * Hidden templates are null here even for their author; the page then falls back to the API, which checks who asks.
 */
export async function publicTemplate(db: Db, id: string) {
  if (!isUuid(id)) return null;
  const card = await getTemplateCard(db, id.toLowerCase());
  if (!card || card.status !== "published") return null;
  const version = await getTemplateVersion(db, card.id, card.currentVersion);
  return version ? { ...toTemplateJson(card), doc: version.doc } : null;
}
