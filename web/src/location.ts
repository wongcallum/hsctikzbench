import { useMemo, useSyncExternalStore } from "react";

/** judge: blind, own verdicts. resolve: unblinded, settling disputes. view: everything. */
export type Mode = "judge" | "resolve" | "view";

export interface JudgeLocation {
  mode: Mode;
  stem: string | null;
  run: string | null;
}

export type Route =
  | { page: "launch"; from: string | null }
  | { page: "batch"; name: string; stem: string | null }
  | { page: "assign" }
  | ({ page: "judge" } & JudgeLocation);

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decode);
  const [head, a, b] = parts;
  if (head === "batch" && a) return { page: "batch", name: a, stem: b || null };
  if (head === "new" && a) return { page: "launch", from: a };
  if (head === "assign") return { page: "assign" };
  if (head === "judge" || head === "resolve" || head === "view") {
    return { page: "judge", mode: head, stem: a || null, run: b || null };
  }
  return { page: "launch", from: null };
}

export function hrefFor(route: Route): string {
  const join = (...parts: (string | null)[]) =>
    `#/${parts
      .filter((p) => p !== null)
      .map(encodeURIComponent)
      .join("/")}`;
  switch (route.page) {
    case "launch":
      return route.from ? join("new", route.from) : "#/";
    case "batch":
      return join("batch", route.name, route.stem);
    case "assign":
      return "#/assign";
    case "judge":
      return join(route.mode, route.stem, route.stem && route.run);
  }
}

export const navigate = (route: Route) => {
  const next = hrefFor(route);
  if (window.location.hash !== next) window.location.hash = next;
};

let leaveGuard: (() => boolean) | null = null;
export const setLeaveGuard = (guard: (() => boolean) | null) => {
  leaveGuard = guard;
};
export const confirmLeave = () => leaveGuard?.() ?? true;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const read = () => window.location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, read);
  return useMemo(() => parseHash(hash), [hash]);
}
