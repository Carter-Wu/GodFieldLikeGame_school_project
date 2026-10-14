// The browser's one Supabase client, shared by online PvP (matchApi.ts) and
// the game-catalog load (main entry).
//
// Sign-in sessions live in sessionStorage rather than localStorage, so every
// browser tab is its own player -- two tabs on one machine can play each
// other for testing.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const onlineAvailable = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase: SupabaseClient = onlineAvailable
  ? createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { storage: window.sessionStorage } })
  : (null as unknown as SupabaseClient);
