"use client";

import { useCallback, useEffect, useState } from "react";

/** Fullscreen for the whole page (so toasts and dialogs stay visible), with whether the browser allows it and whether it is on now. */
export function useFullscreen() {
  const [active, setActive] = useState(false);
  const supported = typeof document !== "undefined" && document.fullscreenEnabled;

  useEffect(() => {
    const on = () => setActive(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const toggle = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }, []);

  return { supported, active, toggle };
}
