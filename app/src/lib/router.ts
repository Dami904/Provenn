import { useEffect, useState } from "react";

/** Minimal history-API router: "/" (landing) and "/dashboard" (app). */
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

/**
 * Internal links (leaderboard row -> agent profile, "back to leaderboard",
 * the wordmark home link) are written as bare paths like "/dashboard" — they
 * don't know whether the visitor is currently in demo mode. Carry the
 * `?demo` flag across in-app navigation so clicking around inside a demo
 * view doesn't silently drop back to live data.
 */
export function navigate(to: string): void {
  const demoActive = new URLSearchParams(window.location.search).has("demo");
  const alreadyHasDemo = /[?&]demo\b/.test(to);
  let finalTo = to;
  if (demoActive && !alreadyHasDemo) {
    finalTo = to + (to.includes("?") ? "&demo" : "?demo");
  } else if (!demoActive && alreadyHasDemo) {
    finalTo = to.replace(/[?&]demo\b/, "").replace(/\?$/, "");
  }
  window.history.pushState(null, "", finalTo);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Click handler for internal <a> links — keeps cmd/ctrl-click behavior. */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute("href") ?? "/");
}
