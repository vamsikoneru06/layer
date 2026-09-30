"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/** Fullscreen for one element, with whether the browser allows it and whether it is on now. */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const supported = typeof document !== "undefined" && document.fullscreenEnabled;

  useEffect(() => {
    const on = () => setActive(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const toggle = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ref.current?.requestFullscreen();
  }, [ref]);

  return { supported, active, toggle };
}
