import { useState, type ReactElement } from "react";
import type { ClassDef } from "../model/classes.ts";
import { onlineAvailable } from "../online/supabaseClient.ts";

export interface ClassSelectProps {
  classes: ClassDef[];
  onPlayCpu: (classId: string) => void;
  onCreateOnline: (classId: string) => void;
  onJoinOnline: (classId: string) => void;
  onOpenGallery: () => void;
}

/** Class-select screen (React shell): one card per class + vs-CPU / online buttons. */
export function ClassSelect({ classes, onPlayCpu, onCreateOnline, onJoinOnline, onOpenGallery }: ClassSelectProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string>(classes[0]?.id ?? "");
  const selected = classes.find((c) => c.id === selectedId) ?? classes[0];

  return (
    <div className="shell-screen">
      <div className="shell-topbar">
        <span className="shell-title">Godfield-lite</span>
        <button type="button" className="shell-button" onClick={onOpenGallery}>
          Card gallery
        </button>
      </div>
      <p className="shell-subtitle">
        Class-based card battle: attack / defend / buff / debuff, synergies, and an ultimate meter.
        Every round both sides pick a card at the same time, then both resolve together.
      </p>
      <h2 className="shell-heading">Choose your class</h2>
      <div className="class-grid">
        {classes.map((classDef) => (
          <button
            key={classDef.id}
            type="button"
            className={`class-card${classDef.id === selectedId ? " selected" : ""}`}
            onClick={() => setSelectedId(classDef.id)}
          >
            <div className="class-name">{classDef.name}</div>
            <div className="class-stats">
              HP {classDef.baseStats.hp} DEF {classDef.baseStats.def} MR {classDef.baseStats.mr} ER{" "}
              {classDef.baseStats.er} UR {classDef.baseStats.ur}
            </div>
            <div className="class-synergy">Synergy: {classDef.synergyPool.map((s) => s.name).join(", ")}</div>
            <div className="class-ultimate">
              Ultimate: {classDef.ultimate.name} (cost {classDef.ultimate.cost}, {classDef.ultimate.damage}{" "}
              dmg)
            </div>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="shell-actions">
          <button type="button" className="shell-button primary" onClick={() => onPlayCpu(selected.id)}>
            Play vs CPU
          </button>
          <button
            type="button"
            className="shell-button gold"
            disabled={!onlineAvailable}
            onClick={() => onCreateOnline(selected.id)}
          >
            Create online room
          </button>
          <button
            type="button"
            className="shell-button gold"
            disabled={!onlineAvailable}
            onClick={() => onJoinOnline(selected.id)}
          >
            Join with code
          </button>
        </div>
      ) : null}
      {!onlineAvailable ? (
        <p className="shell-note">
          Online play is off: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY aren&apos;t set (see .env).
        </p>
      ) : null}
    </div>
  );
}
