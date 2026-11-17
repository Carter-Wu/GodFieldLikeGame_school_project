import type { ReactElement } from "react";
import { findClassById } from "../model/catalog.ts";
import { RECENT_LIMIT, type HistoryEntry, type MatchHistoryData } from "../online/historyApi.ts";

const RESULT_LABEL: Record<HistoryEntry["result"], string> = { win: "W", draw: "D", loss: "L" };

function className(classId: string): string {
  try {
    return findClassById(classId).name;
  } catch {
    return classId; // a class that has since been removed from the catalog
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface MatchHistoryProps {
  username: string;
  history: MatchHistoryData | null; // null while loading
  error: string | null;
  onBack: () => void;
}

/** "My record" screen (React shell): all-time PvP record and the last few PvP games. Loaded by App. */
export function MatchHistory({ username, history, error, onBack }: MatchHistoryProps): ReactElement {
  return (
    <div className="shell-screen record-screen">
      <header className="record-header">
        <div className="record-heading">
          <h1 className="record-title">My Record</h1>
          <p className="record-subtitle">
            <span className="record-user">{username}</span>
            <span className="record-sep" aria-hidden="true" />
            <span>Random matches only</span>
          </p>
        </div>
        <button type="button" className="record-back" onClick={onBack}>
          ← Back
        </button>
      </header>
      {error ? (
        <p className="record-card record-error">Couldn&apos;t load your match history: {error}</p>
      ) : (
        <HistoryPanel history={history} />
      )}
    </div>
  );
}

function HistoryPanel({ history }: { history: MatchHistoryData | null }): ReactElement {
  const record = history?.record ?? null;
  const total = record ? record.wins + record.draws + record.losses : 0;
  const winRate = record && total > 0 ? Math.round((record.wins / total) * 1000) / 10 : null;
  const games = history?.recent ?? null;
  const share = (n: number): string => `${total > 0 ? (n / total) * 100 : 0}%`;

  return (
    <section className="history-panel">
      <div className="record-card history-record">
        <h2 className="record-card-head">PvP record</h2>
        {record ? (
          <>
            <div className="record-tally">
              <RecordStat kind="win" value={record.wins} unit="W" label="Wins" />
              <RecordStat kind="draw" value={record.draws} unit="D" label="Draws" />
              <RecordStat kind="loss" value={record.losses} unit="L" label="Losses" />
            </div>
            <div className="record-bar" aria-hidden="true">
              <span className="win" style={{ width: share(record.wins) }} />
              <span className="draw" style={{ width: share(record.draws) }} />
              <span className="loss" style={{ width: share(record.losses) }} />
            </div>
            <p className="history-rate">
              {winRate === null ? (
                "No games yet"
              ) : (
                <>
                  <strong>{winRate}%</strong> win rate · {total} games
                </>
              )}
            </p>
          </>
        ) : (
          <p className="history-rate">Loading…</p>
        )}
      </div>
      <div className="record-card history-recent">
        <h2 className="record-card-head">Last {RECENT_LIMIT} PvP games</h2>
        {games === null ? (
          <p className="history-empty">Loading…</p>
        ) : games.length === 0 ? (
          <p className="history-empty">No PvP games yet.</p>
        ) : (
          <ul className="history-list">
            {games.map((g) => (
              <li key={g.id} className="history-row">
                <span className={`history-result ${g.result}`}>{RESULT_LABEL[g.result]}</span>
                <span className="history-matchup">
                  {className(g.myClass)} <span className="history-vs">vs</span> {className(g.opponentClass)}
                  <span className="history-opponent"> · {g.opponentName}</span>
                </span>
                <span className="history-meta">
                  {g.rounds} rounds · {when(g.finishedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RecordStat({ kind, value, unit, label }: { kind: HistoryEntry["result"]; value: number; unit: string; label: string }): ReactElement {
  return (
    <div className={`record-stat ${kind}`}>
      <span className="record-num">
        {value}
        <span className="record-unit">{unit}</span>
      </span>
      <span className="record-stat-label">{label}</span>
    </div>
  );
}
