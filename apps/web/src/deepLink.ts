/**
 * Deep links that answer HTTP 200 on GitHub Pages. Pages has no rewrite rules: /pet/gen/1969
 * is served by 404.html (a copy of index.html) with status 404, which link previews and some
 * in-app browsers treat as a dead page. `/?p=/pet/gen/1969` is the site root, always 200; the
 * app turns it back into the route at boot (main.tsx) and on in-app navigation (App.tsx).
 */

/** `/pet/gen/1969` -> `/?p=/pet/gen/1969` (a query inside the path is escaped, `/card/gen/1969%3Fdemo`). */
export function deepLink(path: string): string {
  if (path === "/" || path === "") return "/";
  return `/?p=${path.replace(/[%?&#+]/g, (c) => encodeURIComponent(c))}`;
}

/**
 * The route a `?p=` search asks for, with any other parameters kept; null when there is none
 * or when it is not a same-site path (`//evil.example`, `https:`...).
 */
export function resolveDeepLink(search: string): string | null {
  const params = new URLSearchParams(search);
  const p = params.get("p");
  if (p === null || !p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return null;
  params.delete("p");
  const rest = params.toString();
  if (!rest) return p;
  return `${p}${p.includes("?") ? "&" : "?"}${rest}`;
}
