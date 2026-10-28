"use client";

import { FONT_FAMILIES } from "@vash/schema";
import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { getBrandKit, listPhotos, resolveAssets, saveBrandKit, type BrandKit, type Photo } from "@/lib/api";
import { cn } from "@/lib/utils";

const MAX_COLORS = 12;
const MAX_FONTS = 4;
const same = (a: BrandKit, b: BrandKit) => JSON.stringify(a) === JSON.stringify(b);

/** Settings › Brand kit: colours, fonts and a logo to apply to any design in one step (from the editor's Design panel). */
export function BrandKitSection() {
  const id = useId();
  const toast = useToast();
  const [saved, setSaved] = useState<BrandKit | null>(null);
  const [kit, setKit] = useState<BrandKit>({ colors: [], fonts: [], logoAssetId: null });
  const [photos, setPhotos] = useState<(Photo & { url?: string })[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([getBrandKit(), listPhotos()]).then(
      async ([k, page]) => {
        if (!live) return;
        setSaved(k);
        setKit(k);
        const urls = page.items.length ? (await resolveAssets(page.items.map((p) => p.id))).assets : [];
        if (live) setPhotos(page.items.map((p) => ({ ...p, url: urls.find((u) => u.id === p.id)?.url })));
      },
      () => live && toast({ message: "Couldn’t load your brand kit. Reload to try again." }),
    );
    return () => {
      live = false;
    };
  }, [toast]);

  async function save() {
    setSaving(true);
    try {
      const next = await saveBrandKit(kit);
      setSaved(next);
      setKit(next);
      toast({ message: "Brand kit saved." });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn’t save. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const setColor = (i: number, color: string) => setKit((k) => ({ ...k, colors: k.colors.map((c, j) => (j === i ? color.toUpperCase() : c)) }));
  const fontSlots = Array.from({ length: Math.min(MAX_FONTS, kit.fonts.length + 1) }, (_, i) => kit.fonts[i] ?? "");
  const setFont = (i: number, family: string) =>
    setKit((k) => {
      const fonts = [...k.fonts];
      if (family) fonts[i] = family;
      else fonts.splice(i, 1);
      return { ...k, fonts: fonts.filter((f, j) => f && fonts.indexOf(f) === j) };
    });

  return (
    <section className="flex flex-col gap-5" aria-busy={saved === null}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Brand kit</h2>
        <p className="text-sm text-muted">Your colours, fonts and logo. In the editor, Apply brand kit restyles a design with them in one step.</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Colours</span>
        <ul className="flex flex-wrap gap-2">
          {kit.colors.map((color, i) => (
            <li key={i} className="relative">
              <label className="block size-11 cursor-pointer overflow-hidden rounded-xl shadow-[inset_0_0_0_.5px_var(--line)]" style={{ background: color }}>
                <span className="sr-only">Colour {i + 1}, {color}</span>
                <input type="color" value={color.toLowerCase()} onChange={(e) => setColor(i, e.target.value)} className="size-full cursor-pointer opacity-0" />
              </label>
              <button
                type="button"
                aria-label={`Remove colour ${color}`}
                onClick={() => setKit((k) => ({ ...k, colors: k.colors.filter((_, j) => j !== i) }))}
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-bg text-muted shadow-[0_0_0_.5px_var(--line)] hover:text-text"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
          {kit.colors.length < MAX_COLORS && (
            <li>
              {/* Adds one swatch to adjust; a colour input here would add one per drag step. */}
              <button
                type="button"
                aria-label="Add a colour"
                onClick={() => setKit((k) => ({ ...k, colors: [...k.colors, "#808080"] }))}
                className="flex size-11 items-center justify-center rounded-xl bg-field text-muted hover:text-text"
              >
                <Plus aria-hidden className="size-4" />
              </button>
            </li>
          )}
        </ul>
        <p className="text-[12px] text-muted">The first colour replaces the colour a design uses most, the second the next, and so on. Black and white stay.</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Fonts</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {fontSlots.map((family, i) => (
            <label key={i} className="flex flex-col gap-1 text-[12px] text-muted">
              {i === 0 ? "Headings" : i === 1 ? "Everything else" : `Font ${i + 1}`}
              <select className="field" value={family} onChange={(e) => setFont(i, e.target.value)} style={family ? { fontFamily: `"${family}", system-ui` } : undefined}>
                <option value="">{i === 0 ? "Keep the design’s fonts" : "None"}</option>
                {FONT_FAMILIES.filter((f) => f === family || !kit.fonts.includes(f)).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium">Logo</legend>
        {photos.length === 0 ? (
          <p className="text-[12px] text-muted">Upload a photo in Media to use it as your logo.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <label className={cn("flex size-16 cursor-pointer items-center justify-center rounded-xl bg-field text-[12px] text-muted", kit.logoAssetId === null && "outline-2 outline-text")}>
              <input type="radio" name={`${id}-logo`} className="sr-only" checked={kit.logoAssetId === null} onChange={() => setKit((k) => ({ ...k, logoAssetId: null }))} />
              No logo
            </label>
            {photos.map((p) => (
              <label key={p.id} className={cn("size-16 cursor-pointer overflow-hidden rounded-xl bg-field", kit.logoAssetId === p.id && "outline-2 outline-text")}>
                <input type="radio" name={`${id}-logo`} className="sr-only" checked={kit.logoAssetId === p.id} onChange={() => setKit((k) => ({ ...k, logoAssetId: p.id }))} />
                <span className="sr-only">Use this photo as the logo</span>
                {p.url && <img src={p.url} alt="" className="size-full object-cover" />}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div>
        <Button onClick={() => void save()} loading={saving} disabled={saved === null || same(kit, saved)}>
          {saving ? "Saving…" : "Save brand kit"}
        </Button>
      </div>
    </section>
  );
}
