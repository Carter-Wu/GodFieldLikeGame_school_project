import { useEffect, useState } from "react";
import { supabase, onlineAvailable } from "../online/supabaseClient.ts";
import { toAccount, type Account } from "../online/authApi.ts";

export interface AuthState {
  ready: boolean; // false until the stored session (if any) has been read
  account: Account | null;
}

/** The logged-in account, kept in sync with Supabase Auth (log in / out / token refresh). */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ ready: !onlineAvailable, account: null });

  useEffect(() => {
    if (!onlineAvailable) return;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState({ ready: true, account: toAccount(data.session?.user) });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setState({ ready: true, account: toAccount(session?.user) });
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
