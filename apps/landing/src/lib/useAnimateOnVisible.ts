import { useEffect, useRef } from "react";

export function useAnimateOnVisible<T extends HTMLElement>(
  initial = false,
  rootMargin = "200px",
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.dataset.animate = initial ? "true" : "false";

    if (typeof IntersectionObserver === "undefined") {
      el.dataset.animate = "true";
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          (entry.target as HTMLElement).dataset.animate = entry.isIntersecting
            ? "true"
            : "false";
        }
      },
      { rootMargin, threshold: 0 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [initial, rootMargin]);

  return ref;
}
