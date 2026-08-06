import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * Returns a callback whose identity never changes, but which always runs the
 * newest version of the function you passed.
 *
 * The problem it solves shows up wherever a handler is given to a memoized
 * child. `useCallback` only holds an identity while its dependencies hold, so a
 * handler that reads several pieces of state gets a new identity whenever any
 * of them changes — and every memoized child receiving it re-renders, which is
 * exactly what the memo was added to prevent. The chat thread is the clearest
 * case: handlers like "play this voice note" or "pin this message" close over
 * half the page's state, and they are handed to every bubble on screen.
 *
 * The alternative is rewriting each handler to depend on nothing, which is
 * possible but distorts the code — you end up threading values through
 * functional updaters purely to satisfy a dependency array. This keeps the
 * handler written the way it reads best and fixes the identity instead.
 *
 * Store the latest function in `useInsertionEffect` rather than `useEffect`:
 * insertion effects run before layout effects, so a child's layout effect can
 * safely call this during the same commit that changed it. Calling it *during*
 * render is still wrong — it would read a closure from the previous commit —
 * so that throws rather than returning a stale answer quietly.
 *
 * This is the same contract as React's own `useEffectEvent`, which is still
 * experimental; swap to it when it ships and delete this file.
 */
export function useEventCallback<Args extends unknown[], Return>(
  fn: (...args: Args) => Return
): (...args: Args) => Return {
  const ref = useRef<typeof fn>(() => {
    throw new Error("useEventCallback: cannot be called during render.");
  });

  useInsertionEffect(() => {
    ref.current = fn;
  }, [fn]);

  return useCallback((...args: Args) => ref.current(...args), []);
}

export default useEventCallback;
