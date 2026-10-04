import { notFound } from "next/navigation";
import { Bench } from "./bench";

export const metadata = { title: "Engine benchmark · VASH" };

/** Development-only: the M1 exit check (spec §11.1, ≤ 16 ms per frame while dragging with 150 layers). */
export default function BenchPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Bench />;
}
