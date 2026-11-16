// Account settings that change the player's profile: the profile picture and
// the display name. Both live in the user's auth metadata (see authApi.ts),
// so useAuth picks up the change on its own (Supabase fires USER_UPDATED /
// TOKEN_REFRESHED). The display name can only be changed through the
// change_username database function, at most 3 times per 30 days.
//
// The picture itself is a file in the public `avatars` Storage bucket at
// <user id>/avatar.jpg (supabase/migrations/*_avatars.sql). The browser crops
// and shrinks whatever the player picks to a small square JPEG first, so any
// photo size works and the upload stays tiny.

import { supabase } from "./supabaseClient.ts";

const BUCKET = "avatars";
const AVATAR_SIZE = 256; // px, square
const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // the picked file, before shrinking
export const USERNAME_MIN = 2; // same limits as sign up (AuthScreen)
export const USERNAME_MAX = 20;

const avatarPath = (userId: string): string => `${userId}/avatar.jpg`;

// Center-crop to a square and scale down to AVATAR_SIZE.
async function toAvatarJpeg(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file couldn't be read as an image. Try a PNG, JPEG or WebP.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Your browser couldn't process the image.");
  g.fillStyle = "#14161f"; // behind transparent PNGs
  g.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  g.imageSmoothingQuality = "high";
  g.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Your browser couldn't process the image.");
  return blob;
}

/** Upload a new profile picture for the logged-in player; returns its URL. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file (PNG, JPEG, WebP or GIF).");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is too large. Pick one under 15 MB.");
  const blob = await toAvatarJpeg(file);
  const path = avatarPath(userId);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
  if (uploadError) {
    if (/bucket not found/i.test(uploadError.message)) {
      throw new Error("Profile pictures aren't set up on the server yet (missing the avatars bucket).");
    }
    throw new Error(uploadError.message);
  }
  // Same path every time, so add a version to get past browser/CDN caches.
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  const { error } = await supabase.auth.updateUser({ data: { avatar_url: url } });
  if (error) throw new Error(error.message);
  return url;
}

/** Go back to the default silhouette and delete the uploaded picture. */
export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { avatar_url: null } });
  if (error) throw new Error(error.message);
  // Best-effort: the account no longer points at the file either way.
  await supabase.storage.from(BUCKET).remove([avatarPath(userId)]);
}

// Display name changes are limited (enforced by the database:
// supabase/migrations/*_username_change_limit.sql -- keep these in sync).
export const USERNAME_CHANGES_PER_WINDOW = 3;
export const USERNAME_CHANGE_WINDOW_DAYS = 30;

export interface UsernameChangeStatus {
  changesLeft: number;
  nextChangeAt: string | null; // ISO time a change frees up; null while changes are left
}

interface StatusRow {
  changes_left: number;
  next_change_at: string | null;
}

function toStatus(data: unknown): UsernameChangeStatus {
  const row = (Array.isArray(data) ? data[0] : data) as StatusRow | undefined;
  return {
    changesLeft: row?.changes_left ?? USERNAME_CHANGES_PER_WINDOW,
    nextChangeAt: row?.next_change_at ?? null,
  };
}

function rpcError(message: string): Error {
  if (/could not find the function|does not exist/i.test(message)) {
    return new Error("Display name changes aren't set up on the server yet (missing the username change migration).");
  }
  return new Error(message);
}

/** How many display name changes the logged-in player has left right now. */
export async function fetchUsernameChangeStatus(): Promise<UsernameChangeStatus> {
  const { data, error } = await supabase.rpc("username_change_status");
  if (error) throw rpcError(error.message);
  return toStatus(data);
}

/**
 * Change the display name shown in the menu and to opponents (from the next
 * match). Counts toward the limit; the database refuses it once it's used up.
 */
export async function changeUsername(username: string): Promise<UsernameChangeStatus> {
  const name = username.trim();
  if (name.length < USERNAME_MIN) throw new Error(`Pick a name of at least ${USERNAME_MIN} characters.`);
  if (name.length > USERNAME_MAX) throw new Error(`Keep the name to ${USERNAME_MAX} characters or fewer.`);
  const { data, error } = await supabase.rpc("change_username", { new_name: name });
  if (error) throw rpcError(error.message);
  // The name lives in the login's user metadata: refresh the session so the
  // app (useAuth) picks up the new one.
  await supabase.auth.refreshSession();
  return toStatus(data);
}
