// Player accounts: sign up / log in / log out with email + password
// (Supabase Auth). The username is kept in the user's metadata and only
// used for display. The metadata also carries `tutorial_seen`: false on a
// fresh account until the player picks "Start tutorial" or "Skip" (absent on
// accounts made before the tutorial existed, which aren't asked), and
// `avatar_url`: the player's profile picture, if they've set one
// (profileApi.ts).

import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient.ts";

export interface Account {
  id: string;
  email: string;
  username: string;
  needsTutorialPrompt: boolean; // new account that hasn't answered the tutorial prompt yet
  avatarUrl: string | null; // profile picture; null = the default silhouette
  createdAt: string | null; // ISO time the account was made
}

export function toAccount(user: User | null | undefined): Account | null {
  if (!user || user.is_anonymous) return null;
  const email = user.email ?? "";
  const username = (user.user_metadata?.["username"] as string | undefined) || email.split("@")[0] || "Player";
  const needsTutorialPrompt = user.user_metadata?.["tutorial_seen"] === false;
  const avatarUrl = (user.user_metadata?.["avatar_url"] as string | undefined) || null;
  return { id: user.id, email, username, needsTutorialPrompt, avatarUrl, createdAt: user.created_at ?? null };
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
    options: { data: { username, tutorial_seen: false } },
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

// Called once the player has answered the new-account tutorial prompt, so it
// isn't shown again (on any device).
export async function markTutorialSeen(): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { tutorial_seen: true } });
  if (error) throw new Error(error.message);
}

// Change the logged-in player's password. The current password is checked
// first by logging in with it again (Supabase's updateUser alone doesn't ask
// for it), which also counts as a fresh login for projects that require one
// before a password change.
export async function changePassword(email: string, currentPassword: string, newPassword: string): Promise<void> {
  const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (checkError) {
    throw new Error(/invalid login credentials/i.test(checkError.message) ? "Your current password is wrong." : checkError.message);
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (/should be different/i.test(error.message)) throw new Error("The new password must be different from the current one.");
    throw new Error(error.message);
  }
}
