import type { ShapeGeometry } from "@vash/schema";

/**
 * Built-in shapes and lines for the Shapes panel, as plain data. `path` geometry is drawn in a 0 to 1 unit box
 * that is stretched to `width` by `height`, so every coordinate must stay within 0..1.
 */
export interface CatalogShape {
  id: string;
  name: string;
  geometry: ShapeGeometry;
  width: number;
  height: number;
  fill: boolean;
  strokeWidth: number | null;
}

/** Filled shapes. */
export const SHAPES: readonly CatalogShape[] = [
  { id: "rectangle", name: "Rectangle", geometry: { kind: "rect", cornerRadius: 0 }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "rounded-rectangle", name: "Rounded rectangle", geometry: { kind: "rect", cornerRadius: 45 }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "circle", name: "Circle", geometry: { kind: "ellipse" }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "triangle", name: "Triangle", geometry: { kind: "polygon", sides: 3 }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "diamond", name: "Diamond", geometry: { kind: "path", d: "M0.5 0L1 0.5L0.5 1L0 0.5Z" }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "pentagon", name: "Pentagon", geometry: { kind: "polygon", sides: 5 }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "hexagon", name: "Hexagon", geometry: { kind: "polygon", sides: 6 }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "octagon", name: "Octagon", geometry: { kind: "polygon", sides: 8 }, width: 300, height: 300, fill: true, strokeWidth: null },
  {
    id: "star",
    name: "Star",
    geometry: {
      kind: "path",
      d: "M0.5 0L0.624 0.374L1 0.382L0.7 0.621L0.809 1L0.5 0.774L0.191 1L0.3 0.621L0 0.382L0.376 0.374Z",
    },
    width: 300,
    height: 300,
    fill: true,
    strokeWidth: null,
  },
  {
    id: "heart",
    name: "Heart",
    geometry: {
      kind: "path",
      d: "M0.5 1C0.2 0.722 0 0.5 0 0.278C0 0.111 0.12 0 0.27 0C0.38 0 0.46 0.089 0.5 0.2C0.54 0.089 0.62 0 0.73 0C0.88 0 1 0.111 1 0.278C1 0.5 0.8 0.722 0.5 1Z",
    },
    width: 300,
    height: 300,
    fill: true,
    strokeWidth: null,
  },
  { id: "plus", name: "Plus", geometry: { kind: "path", d: "M0.335 0H0.665V0.335H1V0.665H0.665V1H0.335V0.665H0V0.335H0.335Z" }, width: 300, height: 300, fill: true, strokeWidth: null },
  { id: "arrow-right", name: "Right arrow", geometry: { kind: "path", d: "M0 0.3H0.55V0L1 0.5L0.55 1V0.7H0Z" }, width: 300, height: 180, fill: true, strokeWidth: null },
  { id: "arrow-left", name: "Left arrow", geometry: { kind: "path", d: "M1 0.3H0.45V0L0 0.5L0.45 1V0.7H1Z" }, width: 300, height: 180, fill: true, strokeWidth: null },
  { id: "arrow-up", name: "Up arrow", geometry: { kind: "path", d: "M0.3 1V0.45H0L0.5 0L1 0.45H0.7V1Z" }, width: 180, height: 300, fill: true, strokeWidth: null },
  { id: "arrow-down", name: "Down arrow", geometry: { kind: "path", d: "M0.3 0V0.55H0L0.5 1L1 0.55H0.7V0Z" }, width: 180, height: 300, fill: true, strokeWidth: null },
  { id: "arrow-double", name: "Double arrow", geometry: { kind: "path", d: "M0 0.5L0.3 0V0.3H0.7V0L1 0.5L0.7 1V0.7H0.3V1Z" }, width: 300, height: 180, fill: true, strokeWidth: null },
  { id: "chevron", name: "Chevron", geometry: { kind: "path", d: "M0 0H0.6L1 0.5L0.6 1H0L0.4 0.5Z" }, width: 300, height: 300, fill: true, strokeWidth: null },
  {
    id: "speech-bubble",
    name: "Speech bubble",
    geometry: {
      kind: "path",
      d: "M0.15 0H0.85A0.15 0.2 0 0 1 1 0.2V0.6A0.15 0.2 0 0 1 0.85 0.8H0.35L0.2 1V0.8H0.15A0.15 0.2 0 0 1 0 0.6V0.2A0.15 0.2 0 0 1 0.15 0Z",
    },
    width: 300,
    height: 240,
    fill: true,
    strokeWidth: null,
  },
  {
    id: "cloud",
    name: "Cloud",
    geometry: {
      kind: "path",
      d: "M0.25 1H0.75C0.9 1 1 0.9 1 0.72C1 0.5 0.9 0.42 0.74 0.42C0.74 0.18 0.64 0 0.48 0C0.3 0 0.22 0.16 0.22 0.42C0.1 0.42 0 0.56 0 0.72C0 0.9 0.1 1 0.25 1Z",
    },
    width: 300,
    height: 220,
    fill: true,
    strokeWidth: null,
  },
  { id: "half-circle", name: "Half circle", geometry: { kind: "path", d: "M0 1A0.5 1 0 0 1 1 1Z" }, width: 300, height: 150, fill: true, strokeWidth: null },
  { id: "parallelogram", name: "Parallelogram", geometry: { kind: "path", d: "M0.25 0H1L0.75 1H0Z" }, width: 300, height: 200, fill: true, strokeWidth: null },
  { id: "trapezoid", name: "Trapezoid", geometry: { kind: "path", d: "M0.2 0H0.8L1 1H0Z" }, width: 300, height: 200, fill: true, strokeWidth: null },
];

/** Unfilled lines and arrows, drawn with a 4 px stroke. */
export const LINES: readonly CatalogShape[] = [
  { id: "line", name: "Line", geometry: { kind: "path", d: "M0 0.5H1" }, width: 300, height: 40, fill: false, strokeWidth: 4 },
  {
    id: "line-arrow-end",
    name: "Line with arrow",
    geometry: { kind: "path", d: "M0 0.5H1M0.955 0.1L1 0.5L0.955 0.9" },
    width: 300,
    height: 40,
    fill: false,
    strokeWidth: 4,
  },
  {
    id: "line-arrow-both",
    name: "Line with arrows at both ends",
    geometry: { kind: "path", d: "M0 0.5H1M0.955 0.1L1 0.5L0.955 0.9M0.045 0.1L0 0.5L0.045 0.9" },
    width: 300,
    height: 40,
    fill: false,
    strokeWidth: 4,
  },
  {
    id: "line-circle-end",
    name: "Line with circle end",
    geometry: { kind: "path", d: "M0 0.5H0.954M1 0.5A0.023 0.175 0 1 1 0.954 0.5A0.023 0.175 0 1 1 1 0.5" },
    width: 300,
    height: 40,
    fill: false,
    strokeWidth: 4,
  },
  { id: "line-elbow", name: "Elbow line", geometry: { kind: "path", d: "M0 0V1H1" }, width: 300, height: 150, fill: false, strokeWidth: 4 },
];
