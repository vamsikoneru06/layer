/** A PDF point is 1/72 inch; the editor works in CSS pixels at 96 per inch. */
export function pointsFromPixels(px: number): number {
  return px * 0.75;
}

const encoder = new TextEncoder();

/** Plain PDF numbers: two decimals at most, never an exponent. */
function num(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, "") || "0";
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function stream(dict: string, data: Uint8Array): Uint8Array {
  return concat([encoder.encode(`${dict}\nstream\n`), data, encoder.encode("\nendstream")]);
}

/**
 * A one-page PDF 1.4 document with one JPEG stretched over the whole page.
 * `image` is the JPEG's pixel size; `page` is the page size in points.
 */
export function jpegToPdf(
  jpeg: Uint8Array,
  image: { width: number; height: number },
  page: { width: number; height: number },
): Uint8Array {
  const w = num(page.width);
  const h = num(page.height);
  const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);

  // Objects 1..5, in order. Object N is written as "N 0 obj ... endobj".
  const objects: Uint8Array[] = [
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
    ),
    stream(`<< /Length ${content.length} >>`, content),
    stream(
      `<< /Type /XObject /Subtype /Image /Width ${Math.round(image.width)} ` +
        `/Height ${Math.round(image.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg,
    ),
  ];

  // Binary comment line tells transfer tools this file holds non-ASCII bytes.
  const header = concat([encoder.encode("%PDF-1.4\n%"), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]);
  const parts: Uint8Array[] = [header];
  let position = header.length;
  const offsets: number[] = [];

  objects.forEach((body, i) => {
    offsets.push(position);
    const chunk = concat([encoder.encode(`${i + 1} 0 obj\n`), body, encoder.encode("\nendobj\n")]);
    parts.push(chunk);
    position += chunk.length;
  });

  const xrefPosition = position;
  const size = objects.length + 1;
  const entries = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  parts.push(
    encoder.encode(
      `xref\n0 ${size}\n0000000000 65535 f \n${entries}` +
        `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`,
    ),
  );

  return concat(parts);
}
