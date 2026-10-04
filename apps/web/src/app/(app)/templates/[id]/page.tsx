import { TemplateDetail } from "@/components/templates/template-detail";

export const metadata = { title: "Template · VASH" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateDetail id={id} />;
}
