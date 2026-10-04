import { notFound } from "next/navigation";
import { FiltersLab } from "./filters-lab";

export const metadata = { title: "Filters lab · VASH" };

/** Development-only: see photo filters on a real photo and time a slider drag (spec §11.1: ≤ 1 frame). */
export default function FiltersPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FiltersLab />;
}
