import { useCallback, useSyncExternalStore } from "react";
import type { Mode } from "./types.ts";

/** What the URL hash points at: `#/<mode>/<stem>/<runId>`, each part after the mode optional. */
export interface Location {
  mode: Mode;
  stem: string | null;
  run: string | null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseLocation(hash: string): Location {
  const [mode, stem, run] = hash.replace(/^#/, "").split("/").filter(Boolean).map(decode);
  return { mode: mode === "view" ? "view" : "judge", stem: stem ?? null, run: run ?? null };
}

export function formatLocation({ mode, stem, run }: Location): string {
  const parts = [mode, stem, run].filter((part) => part !== null);
  return `/${parts.map(encodeURIComponent).join("/")}`;
}

const read = () => window.location.hash;

export function useLocation(): [Location, (value: Location) => void] {
  const hash = useSyncExternalStore(subscribe, read);
  const set = useCallback((value: Location) => {
    const next = formatLocation(value);
    if (window.location.hash.slice(1) !== next) window.location.hash = next;
  }, []);
  return [parseLocation(hash), set];
}
