"use client";

import { categoryLabel } from "@vash/schema";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { getTemplate, type TemplateDetail as Template } from "@/lib/api";
import { openTemplate } from "@/lib/open-template";
import { DocPreview } from "./doc-preview";
import { formatLabel } from "./templates-view";

/** `initial`: the template as the server rendered it; null when it isn't public (a hidden one opens for its author through the API). */
export function TemplateDetail({ id, initial = null }: { id: string; initial?: Template | null }) {
  const router = useRouter();
  const session = useSession();
  const [template, setTemplate] = useState<Template | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (initial) return;
    let live = true;
    getTemplate(id)
      .then((t) => live && setTemplate(t))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [id, initial]);

  async function use() {
    setUsing(true);
    setError(null);
    try {
      if (!template) return;
      router.push(`/edit/${await openTemplate(template, session.status === "user")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open this template. Try again.");
      setUsing(false);
    }
  }

  const back = (
    <Link href="/templates" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-text">
      <ArrowLeft aria-hidden className="size-4" />
      Templates
    </Link>
  );

  if (!template) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : (
          <div className="aspect-square w-full max-w-[560px] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-[20px] bg-field" />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="flex aspect-square w-full max-w-[640px] items-center justify-center rounded-[20px] bg-bg2 p-6 sm:p-10">
          <DocPreview doc={template.doc} box={{ width: 720, height: 720 }} />
        </div>
        <div className="flex max-w-[400px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="text-[clamp(26px,4vw,34px)] leading-[1.05] font-bold tracking-[-0.03em]">{template.title}</h1>
            {template.description && <p className="text-sm text-muted">{template.description}</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Size</dt>
            <dd>
              {formatLabel(template.format)}, {template.width} × {template.height}
            </dd>
            <dt className="text-muted">Category</dt>
            <dd>{categoryLabel(template.category)}</dd>
            {template.author && (
              <>
                <dt className="text-muted">By</dt>
                <dd>{template.author.handle ? `@${template.author.handle}` : template.author.name}</dd>
              </>
            )}
          </dl>
          {template.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {template.tags.map((tag) => (
                <li key={tag} className="rounded-md bg-field px-2 py-0.5 text-[12px] text-muted">
                  {tag}
                </li>
              ))}
            </ul>
          )}
          {session.status === "loading" ? null : (
            <div className="flex flex-col gap-2">
              <Button onClick={() => void use()} loading={using} className="w-full sm:w-fit">
                {using ? "Opening…" : "Use this template"}
              </Button>
              {session.status !== "user" && (
                <p className="text-[13px] text-muted">
                  No account needed. Your design is saved in this browser until you{" "}
                  <Link href="/signin" className="font-medium text-text underline-offset-4 hover:underline">
                    sign in
                  </Link>
                  .
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
