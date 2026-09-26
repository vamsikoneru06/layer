import { Suspense } from "react";
import { DesignsView } from "@/components/designs/designs-view";

export const metadata = { title: "Designs · VASH" };

export default function DesignsPage() {
  // DesignsView reads the folder and search from the URL.
  return (
    <Suspense>
      <DesignsView />
    </Suspense>
  );
}
