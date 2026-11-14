import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { logIn, signUp } from "../online/authApi.ts";

const MIN_PASSWORD = 6; // Supabase Auth's default minimum

type Mode = "login" | "signup";

// title: logo centred + "Press any key". form: the logo rises to the top and
// the Log in / Sign up panel fades up from below it.
type Phase = "title" | "form";

/** Log in / sign up screen (React shell), shown until there's a logged-in account. */
export function AuthScreen(): ReactElement {
  const [phase, setPhase] = useState<Phase>("title");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
  };

  // Any key or click on the title screen opens the log in panel.
  useEffect(() => {
    if (phase !== "title") return;
    const next = (): void => setPhase("form");
    window.addEventListener("keydown", next);
    window.addEventListener("click", next);
    return () => {
      window.removeEventListener("keydown", next);
      window.removeEventListener("click", next);
    };
  }, [phase]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    const trimmedEmail = email.trim();
    if (mode === "signup") {
      if (username.trim().length < 2) return setError("Pick a username of at least 2 characters.");
      if (password.length < MIN_PASSWORD) return setError(`The password needs at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return setError("The passwords don't match.");
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await logIn(trimmedEmail, password);
        // useAuth() picks up the new session and App leaves this screen.
      } else {
        const { needsConfirmation } = await signUp(trimmedEmail, password, username.trim());
        if (needsConfirmation) {
          switchMode("login");
          setNotice(`Account created! Click the link we sent to ${trimmedEmail}, then log in.`);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`title-screen phase-${phase}`}>
      <div className="title-scene" aria-hidden="true">
        <div className="title-torch" style={{ left: "21.72%" }} />
        <div className="title-torch late" style={{ left: "78.28%" }} />
        <div className="title-fog" />
        <div className="title-fog slow" />
      </div>
      <div className="title-shade" aria-hidden="true" />
      <img className="title-logo" src="/ui/zenkake-title-logo.svg" alt="Zenkake: Strategy Card Battle" />
      <div className="title-press">Press any key to start</div>
      {phase === "form" ? (
        <div className="title-column">
          <div className="title-divider" aria-hidden="true" />
          <form className="title-panel" onSubmit={(e) => void submit(e)}>
            <div className="title-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`title-tab${mode === "login" ? " selected" : ""}`}
                onClick={() => switchMode("login")}
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`title-tab${mode === "signup" ? " selected" : ""}`}
                onClick={() => switchMode("signup")}
              >
                Sign up
              </button>
            </div>
            <label className="title-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {mode === "signup" ? (
              <label className="title-field">
                <span>Username</span>
                <input
                  type="text"
                  autoComplete="nickname"
                  maxLength={20}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
            ) : null}
            <label className="title-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {mode === "signup" ? (
              <label className="title-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            ) : null}
            {error ? <p className="auth-error">{error}</p> : null}
            {notice ? <p className="auth-notice">{notice}</p> : null}
            <button type="submit" className="title-submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
