"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, type Me } from "@/lib/api";

type Session = { status: "loading" } | { status: "guest" } | { status: "user"; me: Me } | { status: "error"; message: string };

const SessionContext = createContext<Session>({ status: "loading" });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    let live = true;
    getMe()
      .then((me) => live && setSession(me ? { status: "user", me } : { status: "guest" }))
      .catch((err: Error) => live && setSession({ status: "error", message: err.message }));
    return () => {
      live = false;
    };
  }, []);

  return <SessionContext value={session}>{children}</SessionContext>;
}

export const useSession = () => useContext(SessionContext);
