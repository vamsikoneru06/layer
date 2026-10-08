"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createDesignFromDoc, getMe, type Me } from "@/lib/api";
import { localDesigns, moveToAccount } from "@/lib/local-designs";

/** `moved`: designs made in this browser before signing in, moved to the account when this session started. */
export type Moved = { count: number; failed: number };
type Session = { status: "loading" } | { status: "guest" } | { status: "user"; me: Me; moved?: Moved } | { status: "error"; message: string };

/** Designs left in this browser go to the account before any screen lists the account's designs. */
async function moveLocalDesigns(): Promise<Moved | undefined> {
  try {
    const { moved, failed } = await moveToAccount(localDesigns, createDesignFromDoc);
    return moved.length || failed ? { count: moved.length, failed } : undefined;
  } catch {
    return undefined; // No site storage in this browser: nothing was kept here.
  }
}

const SessionContext = createContext<Session>({ status: "loading" });
const SetMeContext = createContext<(me: Me) => void>(() => {});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    let live = true;
    getMe()
      .then(async (me) => {
        if (!me) return live && setSession({ status: "guest" });
        const moved = await moveLocalDesigns();
        if (live) setSession({ status: "user", me, moved });
      })
      .catch((err: Error) => live && setSession({ status: "error", message: err.message }));
    return () => {
      live = false;
    };
  }, []);

  return (
    <SessionContext value={session}>
      <SetMeContext value={(me: Me) => setSession({ status: "user", me })}>{children}</SetMeContext>
    </SessionContext>
  );
}

export const useSession = () => useContext(SessionContext);

/** Replaces the signed-in profile everywhere it's shown (after the user edits it). */
export const useSetMe = () => useContext(SetMeContext);
