"use client";
// -----------------------------------------------------------------------------
// components/Session.jsx — who is signed in, which stores they can open, and
// what they may do in the current one.
//
// Fetched once at the console boundary rather than per screen; `can()` mirrors
// the server's role floors so the UI hides what the API would refuse anyway.
// The server remains the authority — this is presentation, not enforcement.
// -----------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/client/api";

const Ctx = createContext(null);

const RANK = { VIEWER: 0, OPERATOR: 1, ADMIN: 2, OWNER: 3 };

export function SessionProvider({ children, storeId }) {
  const [state, setState] = useState({ loading: true, user: null, stores: [] });

  const load = useCallback(async () => {
    try {
      const res = await api.get("/auth/me");
      setState({ loading: false, user: res.user, stores: res.stores });
    } catch {
      setState({ loading: false, user: null, stores: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const store = state.stores.find((s) => s.id === storeId) ?? null;
  const role = store?.role ?? (state.user?.isSuperAdmin ? "OWNER" : null);

  const can = useCallback(
    (needed) => role != null && RANK[role] >= RANK[needed],
    [role],
  );

  return (
    <Ctx.Provider value={{ ...state, store, role, can, reload: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
