import { useCallback, useSyncExternalStore } from "react";

/** Phone layout: sheets come up from the bottom as a drawer. Matches Tailwind's `md`. */
export const PHONE_QUERY = "(max-width: 767px)";
/** The desktop sidebar (and its bell) exists only from Tailwind's `lg` up. */
export const WIDE_QUERY = "(min-width: 1024px)";

/**
 * Live `matchMedia` result. Read synchronously on the first client render, so a phone never
 * mounts the desktop variant first (two bells, a dialog that flips into a drawer).
 * The server has no screen and answers `serverValue`.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
