import type { Me } from "@/lib/api";

function initials(me: Me): string {
  const source = me.name.trim() || me.email;
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function Avatar({ me, size = 32 }: { me: Me; size?: number }) {
  // Initials rather than the provider photo: img-src is 'self' only.
  return (
    <span
      aria-hidden
      className="glass-primary flex flex-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(me)}
    </span>
  );
}
