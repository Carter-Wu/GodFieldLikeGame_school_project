import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement, type ReactNode } from "react";
import { changePassword, type Account } from "../online/authApi.ts";
import {
  changeUsername,
  fetchUsernameChangeStatus,
  removeAvatar,
  uploadAvatar,
  USERNAME_CHANGE_WINDOW_DAYS,
  USERNAME_CHANGES_PER_WINDOW,
  USERNAME_MAX,
  USERNAME_MIN,
  type UsernameChangeStatus,
} from "../online/profileApi.ts";
import type { MatchHistoryData } from "../online/historyApi.ts";
import { getVolume, setVolume } from "../fx/sound.ts";
import { PlayerAvatar } from "./PlayerAvatar.tsx";

const MIN_PASSWORD = 6; // Supabase Auth's default minimum (same as AuthScreen)

export interface AccountSettingsProps {
  account: Account;
  history: MatchHistoryData | null; // null while loading or unavailable
  onBack: () => void;
  onLogout: () => void;
}

type Status = { kind: "error" | "notice"; text: string } | null;

function StatusLine({ status }: { status: Status }): ReactElement | null {
  if (!status) return null;
  return (
    <p className={status.kind === "error" ? "auth-error" : "auth-notice"} role={status.kind === "error" ? "alert" : "status"}>
      {status.text}
    </p>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }): ReactElement {
  return (
    <section className="account-panel">
      <header className="account-panel-head">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

function memberSince(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Account settings screen (React shell), styled like the lobby: a profile
 * card on the left (clickable picture, name, record) and settings panels on
 * the right (display name, password, sound, log out).
 */
export function AccountSettings({ account, history, onBack, onLogout }: AccountSettingsProps): ReactElement {
  return (
    <div className="lobby account-page">
      <header className="lobby-topbar">
        <div className="lobby-brand">
          <img src="/ui/zenkake-emblem.svg" alt="" className="lobby-brand-mark" />
          <span className="lobby-brand-name">Zenkake</span>
        </div>
        <nav className="lobby-nav">
          <button type="button" className="lobby-nav-btn" onClick={onBack}>
            ← Back to menu
          </button>
        </nav>
      </header>

      <div className="lobby-heading">
        <span className="lobby-rule" aria-hidden="true" />
        <h1>Account settings</h1>
        <span className="lobby-rule" aria-hidden="true" />
      </div>

      <div className="account-layout">
        <ProfileCard account={account} history={history} />
        <div className="account-panels">
          <DisplayNamePanel account={account} />
          <PasswordPanel account={account} />
          <SoundPanel />
          <Panel title="Session" subtitle="Log out of Zenkake on this browser tab.">
            <button type="button" className="lobby-btn account-logout" onClick={onLogout}>
              Log out
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// --- Profile card: picture (click to change), name, email, record ---------

function ProfileCard({ account, history }: { account: Account; history: MatchHistoryData | null }): ReactElement {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const pick = (): void => {
    if (!busy) fileInput.current?.click();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = ""; // so picking the same file again still fires
    if (!file) return;
    setBusy("upload");
    setStatus(null);
    try {
      await uploadAvatar(account.id, file);
      setStatus({ kind: "notice", text: "Profile picture updated." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (busy) return;
    setBusy("remove");
    setStatus(null);
    try {
      await removeAvatar(account.id);
      setStatus({ kind: "notice", text: "Profile picture removed." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const record = history?.record ?? null;
  const total = record ? record.wins + record.draws + record.losses : 0;
  const winRate = record && total > 0 ? `${Math.round((record.wins / total) * 100)}%` : "—";
  const since = memberSince(account.createdAt);

  return (
    <aside className="account-card">
      <button
        type="button"
        className={`account-avatar-btn${busy === "upload" ? " busy" : ""}`}
        onClick={pick}
        disabled={busy !== null}
        aria-label="Change profile picture"
        title="Change profile picture"
      >
        <PlayerAvatar url={account.avatarUrl} className="xl" />
        <span className="account-avatar-overlay" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M9 4h6l1.6 2.4H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.4a1 1 0 0 1 1-1h3.4z" />
            <circle cx="12" cy="13" r="3.6" />
          </svg>
          <span>{busy === "upload" ? "Uploading…" : "Change"}</span>
        </span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => void onFile(e)}
      />
      <div className="account-avatar-actions">
        <button type="button" className="account-link" onClick={pick} disabled={busy !== null}>
          Upload picture
        </button>
        {account.avatarUrl ? (
          <>
            <span aria-hidden="true">·</span>
            <button type="button" className="account-link" onClick={() => void remove()} disabled={busy !== null}>
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          </>
        ) : null}
      </div>
      <StatusLine status={status} />

      <div className="account-card-name">{account.username}</div>
      <div className="account-card-email">{account.email}</div>
      {since ? <div className="account-card-since">Member since {since}</div> : null}

      <div className="account-record" aria-label="PvP record">
        <div className="account-record-title">PvP record</div>
        <div className="account-record-grid">
          <div className="account-stat win">
            <span className="account-stat-value">{record ? record.wins : "–"}</span>
            <span className="account-stat-label">Wins</span>
          </div>
          <div className="account-stat draw">
            <span className="account-stat-value">{record ? record.draws : "–"}</span>
            <span className="account-stat-label">Draws</span>
          </div>
          <div className="account-stat loss">
            <span className="account-stat-value">{record ? record.losses : "–"}</span>
            <span className="account-stat-label">Losses</span>
          </div>
          <div className="account-stat rate">
            <span className="account-stat-value">{winRate}</span>
            <span className="account-stat-label">Win rate</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

// --- Display name ---------------------------------------------------------

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DisplayNamePanel({ account }: { account: Account }): ReactElement {
  const [name, setName] = useState(account.username);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  // null while loading (or if the server doesn't have the limit yet).
  const [limit, setLimit] = useState<UsernameChangeStatus | null>(null);
  const trimmed = name.trim();
  const unchanged = trimmed === account.username;
  const outOfChanges = limit !== null && limit.changesLeft <= 0;

  useEffect(() => {
    let cancelled = false;
    fetchUsernameChangeStatus()
      .then((s) => {
        if (!cancelled) setLimit(s);
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus({ kind: "error", text: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || unchanged || outOfChanges) return;
    setBusy(true);
    setStatus(null);
    try {
      setLimit(await changeUsername(trimmed));
      setStatus({ kind: "notice", text: "Display name updated." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
      // The count may have moved on (another tab); show the real one.
      fetchUsernameChangeStatus().then(setLimit, () => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Display name"
      subtitle={`Shown in the menu and to your opponents, starting with your next match. You can change it ${USERNAME_CHANGES_PER_WINDOW} times every ${USERNAME_CHANGE_WINDOW_DAYS} days.`}
    >
      <form className="account-inline-form" onSubmit={(e) => void submit(e)}>
        <label className="auth-field account-grow">
          <span>Name</span>
          <input
            type="text"
            autoComplete="nickname"
            minLength={USERNAME_MIN}
            maxLength={USERNAME_MAX}
            required
            disabled={outOfChanges}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="lobby-btn account-save"
          disabled={busy || unchanged || outOfChanges || trimmed.length < USERNAME_MIN}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
      {limit ? (
        <div className={`account-name-limit${outOfChanges ? " out" : ""}`}>
          <span className="account-name-pips" aria-hidden="true">
            {Array.from({ length: USERNAME_CHANGES_PER_WINDOW }, (_, i) => (
              <span key={i} className={i < limit.changesLeft ? "left" : ""} />
            ))}
          </span>
          {outOfChanges
            ? `No changes left. ${limit.nextChangeAt ? `Your next change is available on ${formatDateTime(limit.nextChangeAt)}.` : ""}`
            : `${limit.changesLeft} of ${USERNAME_CHANGES_PER_WINDOW} changes left for this ${USERNAME_CHANGE_WINDOW_DAYS}-day period.`}
        </div>
      ) : null}
      <StatusLine status={status} />
    </Panel>
  );
}

// --- Password -------------------------------------------------------------

function PasswordPanel({ account }: { account: Account }): ReactElement {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setStatus(null);
    const fail = (text: string): void => setStatus({ kind: "error", text });
    if (!current) return fail("Enter your current password.");
    if (next.length < MIN_PASSWORD) return fail(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (next !== confirm) return fail("The new passwords don't match.");
    if (next === current) return fail("The new password must be different from the current one.");
    setBusy(true);
    try {
      await changePassword(account.email, current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ kind: "notice", text: "Password changed." });
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Password" subtitle={`Use at least ${MIN_PASSWORD} characters.`}>
      <form onSubmit={(e) => void submit(e)}>
        {/* For password managers: which account this form belongs to. */}
        <input type="email" autoComplete="username" value={account.email} readOnly hidden />
        <label className="auth-field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <div className="account-field-pair">
          <label className="auth-field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </div>
        <StatusLine status={status} />
        <button type="submit" className="lobby-btn account-save" disabled={busy}>
          {busy ? "Please wait…" : "Change password"}
        </button>
      </form>
    </Panel>
  );
}

// --- Sound ----------------------------------------------------------------

function SoundPanel(): ReactElement {
  const [volume, setLocalVolume] = useState(() => Math.round(getVolume() * 100));
  const change = (value: number): void => {
    setLocalVolume(value);
    setVolume(value / 100);
  };
  return (
    <Panel title="Sound" subtitle="Battle sound effects. Saved in this browser.">
      <div className="account-volume">
        <button
          type="button"
          className="account-mute"
          onClick={() => change(volume === 0 ? 100 : 0)}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
          title={volume === 0 ? "Unmute" : "Mute"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            {volume === 0 ? (
              <path d="M16 9l5 6M21 9l-5 6" className="stroke" />
            ) : (
              <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" className="stroke" />
            )}
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume}
          onChange={(e) => change(Number(e.target.value))}
          aria-label="Sound volume"
          style={{ ["--fill" as string]: `${volume}%` }}
        />
        <span className="account-volume-value">{volume}%</span>
      </div>
    </Panel>
  );
}
