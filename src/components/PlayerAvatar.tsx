import { useState, type ReactElement } from "react";

export interface PlayerAvatarProps {
  url: string | null; // null = the default silhouette
  className?: string;
}

/** A player's profile picture in a round frame, or a silhouette when they haven't set one. */
export function PlayerAvatar({ url, className = "" }: PlayerAvatarProps): ReactElement {
  // A picture that fails to load (deleted file, offline) falls back to the silhouette.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && url !== failedUrl;
  return (
    <span className={`player-avatar ${className}`.trim()} aria-hidden="true">
      {showImage ? (
        <img src={url} alt="" draggable={false} onError={() => setFailedUrl(url)} />
      ) : (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="8.5" r="4.5" />
          <path d="M3.5 22c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8z" />
        </svg>
      )}
    </span>
  );
}
