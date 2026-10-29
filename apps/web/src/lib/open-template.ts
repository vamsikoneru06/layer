import { copyTemplate, type TemplateDetail } from "./api";
import { docFromTemplate, localDesigns, newLocalDesign } from "./local-designs";

/**
 * Starts a design from a template and returns its id: in the account when signed in, otherwise in this
 * browser (guest mode). The editor opens either at /edit/{id}.
 */
export async function openTemplate(template: Pick<TemplateDetail, "id" | "doc">, signedIn: boolean): Promise<string> {
  if (signedIn) return (await copyTemplate(template.id)).id;
  const doc = docFromTemplate(template.doc);
  if (!doc) throw new Error("Couldn't open this template. Try again.");
  await localDesigns.put(newLocalDesign(doc));
  return doc.id;
}
