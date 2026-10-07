"use client";

import { CATEGORIES, FORMATS, type Doc } from "@vash/schema";
import { ChevronDown, LayoutTemplate, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getTemplate, listTemplates, type TemplateItem, type TemplateSort } from "@/lib/api";
import { galleryQuery, readGalleryParams } from "@/lib/gallery-params";
import { cn } from "@/lib/utils";
import { DocPreview } from "./doc-preview";

const CARD_BOX = { width: 260, height: 260 };

export const categoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
export const formatLabel = (f: string) => (f in FORMATS ? FORMATS[f as keyof typeof FORMATS].label : "Custom size");

/** Template documents, fetched once per page load and shared by every card and the detail page. */
const docs = new Map<string, Promise<Doc>>();
export function loadTemplateDoc(id: string): Promise<Doc> {
  let p = docs.get(id);
  if (!p) {
    p = getTemplate(id).then((t) => t.doc);
    p.catch(() => docs.delete(id));
    docs.set(id, p);
  }
  return p;
}

/** Loads a template's design once its card scrolls near the viewport, then draws it. */
function TemplatePreview({ t }: { t: TemplateItem }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Doc | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void loadTemplateDoc(t.id).then((d) => live && setDoc(d), () => {});
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [t.id]);

  return (
    <div ref={box} className="flex aspect-square items-center justify-center rounded-[14px] bg-bg2 p-5">
      {doc ? (
        <DocPreview doc={doc} box={CARD_BOX} />
      ) : (
        <div aria-hidden className="max-h-full max-w-full rounded-[3px] bg-field" style={{ aspectRatio: `${t.width} / ${t.height}`, height: t.height >= t.width ? "100%" : undefined, width: t.width > t.height ? "100%" : undefined }} />
      )}
    </div>
  );
}

function TemplateCard({ t }: { t: TemplateItem }) {
  return (
    <Link href={`/templates/${t.id}`} className="group flex flex-col gap-2.5 rounded-[16px] outline-offset-4">
      <div className="transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none">
        <TemplatePreview t={t} />
      </div>
      <div className="flex flex-col gap-0.5 px-1">
        <span className="truncate text-sm font-medium">{t.title}</span>
        <span className="text-[13px] text-muted">
          {formatLabel(t.format)} · {categoryLabel(t.category)}
        </span>
      </div>
    </Link>
  );
}

const SORTS: readonly { value: TemplateSort; label: string }[] = [
  { value: "popular", label: "Popular" },
  { value: "new", label: "Newest" },
  { value: "featured", label: "Featured" },
];

export function TemplatesView() {
  const router = useRouter();
  const params = useSearchParams();
  // Filters start from the URL, so /templates?category=food opens filtered.
  const [initial] = useState(() => readGalleryParams(params));
  const [q, setQ] = useState(initial.q);
  const [query, setQuery] = useState(initial.q);
  const [category, setCategory] = useState<string | null>(initial.category);
  const [format, setFormat] = useState(initial.format);
  const [sort, setSort] = useState<TemplateSort>(initial.sort);
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // ...and every change goes back into it (replace, so Back leaves the gallery instead of undoing filters).
  useEffect(() => {
    const next = `/templates${galleryQuery({ q: query, category, format, sort })}`;
    if (next !== `${window.location.pathname}${window.location.search}`) router.replace(next, { scroll: false });
  }, [query, category, format, sort, router]);

  useEffect(() => {
    let live = true;
    listTemplates({ q: query, category: category ?? undefined, format: format || undefined, sort })
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [query, category, format, sort]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listTemplates({ q: query, category: category ?? undefined, format: format || undefined, sort, cursor });
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load more templates.");
    } finally {
      setLoadingMore(false);
    }
  }

  const chip = (active: boolean) =>
    cn("h-8 flex-none rounded-lg px-3 text-[13px] font-medium", active ? "bg-text text-bg" : "bg-field text-text hover:bg-line");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <h1 className="text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">Templates</h1>
        <div className="flex flex-wrap items-center gap-3">
          <label className="glass-secondary flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-4 text-sm text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text sm:w-60 sm:flex-none">
            <Search aria-hidden className="size-4 flex-none" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" placeholder="Search" className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted" />
          </label>
          <label className="relative flex items-center text-sm text-muted">
            <span className="sr-only">Size</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="h-10 cursor-pointer appearance-none rounded-lg bg-transparent pr-6 pl-2 hover:text-text">
              <option value="">All sizes</option>
              {Object.entries(FORMATS).map(([key, f]) => (
                <option key={key} value={key}>
                  {f.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-1 size-3.5" />
          </label>
          <label className="relative flex items-center text-sm text-muted">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as TemplateSort)} className="h-10 cursor-pointer appearance-none rounded-lg bg-transparent pr-6 pl-2 hover:text-text">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-1 size-3.5" />
          </label>
        </div>
      </div>

      <div role="group" aria-label="Category" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)} className={chip(category === null)}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={chip(category === c)}>
            {categoryLabel(c)}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {items === null && !error ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="aspect-square animate-[shimmer_1.4s_ease-in-out_infinite] rounded-[14px] bg-field" />
          ))}
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState icon={<LayoutTemplate aria-hidden />} title="No templates match" body="Try another word, or clear the size and category filters." />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4">
          {items?.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </div>
      )}

      {cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
            {loadingMore ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}
