/** Appearance: follow the device, or force light or dark. Stored in a cookie so the server renders it without a flash. */
export type Theme = "system" | "light" | "dark";

export const THEME_COOKIE = "vash-theme";

/** The `data-theme` attribute for a cookie value; anything unknown means "follow the device". */
export function themeAttribute(value: string | undefined): "light" | "dark" | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** Applies a choice now and remembers it for a year (cleared for "system"). Browser only. */
export function setTheme(theme: Theme): void {
  const attr = themeAttribute(theme);
  if (attr) document.documentElement.dataset.theme = attr;
  else delete document.documentElement.dataset.theme;
  document.cookie = attr ? `${THEME_COOKIE}=${attr}; Path=/; Max-Age=31536000; SameSite=Lax` : `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** The current choice, read from the page. Browser only. */
export function currentTheme(): Theme {
  return themeAttribute(document.documentElement.dataset.theme) ?? "system";
}
