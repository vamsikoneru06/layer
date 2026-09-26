import { useId, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/*
 * Two rails of photo cards ride out of a vanishing point toward the viewer.
 * Card size, rails and turn are in container-query units, so the corridor scales with its box.
 */

const PATH = {
  perspective: 30,
  cardWidth: 18,
  cardHeight: 25,
  cardRadius: 0.4,
  birthHeight: 2.6,
  exitHeight: 46,
  railBirth: -11,
  railExit: 44,
  fan: 3.3,
  turnBirth: 6,
  turnExit: 28,
  stops: 24,
};

function keyframes(dir: 1 | -1, name: string): string {
  const p = PATH;
  const steps: string[] = [];
  for (let s = 0; s <= p.stops; s++) {
    const u = s / p.stops;
    const scale = (p.birthHeight / p.cardHeight) * Math.pow(p.exitHeight / p.birthHeight, u);
    const z = p.perspective * (1 - 1 / scale);
    const rail = p.railExit - (p.railExit - p.railBirth) * Math.pow(1 - u, p.fan);
    const turn = p.turnBirth + (p.turnExit - p.turnBirth) * u;
    steps.push(
      `${(u * 100).toFixed(2)}%{transform:translate3d(${(dir * rail).toFixed(2)}cqw,0,${z.toFixed(2)}cqw) rotateY(${(-dir * turn).toFixed(2)}deg)}`,
    );
  }
  return `@keyframes ${name}{${steps.join("")}}`;
}

export function ImageStreamHero({
  images,
  cards = 9,
  speed = 18,
  axis = 55,
  className,
}: {
  images: readonly string[];
  cards?: number;
  speed?: number;
  axis?: number;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rails = [`ish-r-${id}`, `ish-l-${id}`] as const;
  const card = `ish-c-${id}`;
  const css =
    keyframes(1, rails[0]) +
    keyframes(-1, rails[1]) +
    `@media(prefers-reduced-motion:reduce){.${card}{animation-play-state:paused}}`;

  const cardStyle = (rail: string, i: number): CSSProperties => ({
    left: "50%",
    top: `${axis}%`,
    width: `${PATH.cardWidth}cqw`,
    height: `${PATH.cardHeight}cqw`,
    marginLeft: `${-PATH.cardWidth / 2}cqw`,
    marginTop: `${-PATH.cardHeight / 2}cqw`,
    borderRadius: `${PATH.cardRadius}cqw`,
    animation: `${rail} ${speed}s linear infinite`,
    animationDelay: `${-(i * speed) / cards}s`,
    backfaceVisibility: "hidden",
  });

  return (
    <div className={cn("relative overflow-hidden", className)} style={{ containerType: "inline-size" }}>
      <style>{css}</style>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ perspective: `${PATH.perspective}cqw`, perspectiveOrigin: `50% ${axis}%` }}
      >
        <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
          {rails.map((rail) =>
            Array.from({ length: cards }, (_, i) => (
              <div key={`${rail}-${i}`} className={cn(card, "absolute overflow-hidden")} style={cardStyle(rail, i)}>
                <img src={images[i % images.length]} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}
