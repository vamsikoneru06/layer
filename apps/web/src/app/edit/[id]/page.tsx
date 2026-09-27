import { EditorScreen } from "@/components/editor/editor-screen";

export const metadata = { title: "Editor · VASH" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorScreen id={id} />;
}
