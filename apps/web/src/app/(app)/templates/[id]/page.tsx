import { FORMATS, type Doc } from "@vash/schema";
import type { Metadata } from "next";
import { TemplateDetail } from "@/components/templates/template-detail";
import { server } from "@/server/context";

type Props = { params: Promise<{ id: string }> };

const load = async (id: string) => server().publicTemplate(id);

/** Real titles and descriptions, so a shared or searched-for template says what it is. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await load((await params).id);
  if (!t) return { title: "Template · VASH" };
  const format = t.format in FORMATS ? FORMATS[t.format as keyof typeof FORMATS].label : "Custom size";
  const description = t.description || `${format} template, ${t.width} × ${t.height}. Edit the text and colours in your browser and export a PNG. Free.`;
  const title = `${t.title}: ${format} template · VASH`;
  return {
    title,
    description,
    alternates: { canonical: `/templates/${t.id}` },
    openGraph: { title, description, type: "website", url: `/templates/${t.id}`, siteName: "VASH" },
  };
}

export default async function TemplatePage({ params }: Props) {
  const { id } = await params;
  const t = await load(id);
  return <TemplateDetail id={id} initial={t && { ...t, doc: t.doc as Doc }} />;
}
