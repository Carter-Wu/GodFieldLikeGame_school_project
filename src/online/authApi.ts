// Player accounts: sign up / log in / log out with email + password
// (Supabase Auth). The username is kept in the user's metadata and only
// used for display.

import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient.ts";

export interface Account {
  id: string;
  email: string;
  username: string;
}

export function toAccount(user: User | null | undefined): Account | null {
  if (!user || user.is_anonymous) return null;
  const email = user.email ?? "";
  const username = (user.user_metadata?.["username"] as string | undefined) || email.split("@")[0] || "Player";
  return { id: user.id, email, username };
}

// Supabase's messages are fine as-is except for a couple of common ones.
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first (check your inbox), then log in.";
  if (/already registered/i.test(message)) return "An account with that email already exists. Log in instead.";
  return message;
}

// Returns needsConfirmation = true when the project requires email
// confirmation: the account exists but there's no session until the link in
// the email is clicked.
export async function signUp(email: string, password: string, username: string): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw new Error(friendly(error.message));
  // With confirmation on, signing up an already-registered email "succeeds"
  // but returns a user with no identities.
  if (data.user && data.user.identities?.length === 0) throw new Error(friendly("already registered"));
  return { needsConfirmation: !data.session };
}

export async function logIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendly(error.message));
}

export async function logOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
