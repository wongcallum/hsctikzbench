import { useCallback, useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function read(): string {
  const raw = window.location.hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function useHash(): [string, (value: string) => void] {
  const hash = useSyncExternalStore(subscribe, read);
  const setHash = useCallback((value: string) => {
    const encoded = encodeURIComponent(value);
    if (window.location.hash.slice(1) !== encoded) window.location.hash = encoded;
  }, []);
  return [hash, setHash];
}
