import { useEffect, useState, type ReactElement } from "react";

export interface DialogInput {
  placeholder?: string;
  maxLength?: number;
  uppercase?: boolean;
}

interface BaseDialog {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptDialog extends BaseDialog {
  kind: "prompt";
  input?: DialogInput;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export interface ConfirmDialogProps extends BaseDialog {
  kind: "confirm";
  onConfirm: () => void;
  onCancel: () => void;
}

export type DialogProps = PromptDialog | ConfirmDialogProps;

/** Centered modal over the page (menus/popups live in React now, not canvas). */
export function Dialog(props: DialogProps): ReactElement {
  const { title, message, confirmLabel = "OK", cancelLabel = "Cancel", danger = false } = props;
  const [value, setValue] = useState("");

  const confirm = (): void => {
    if (props.kind === "prompt") {
      const trimmed = value.trim();
      if (!trimmed) return;
      props.onConfirm(props.input?.uppercase ? trimmed.toUpperCase() : trimmed);
    } else {
      props.onConfirm();
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirm();
      } else if (event.key === "Escape") {
        event.preventDefault();
        props.onCancel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [value]);

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div className="dialog-box" role="dialog" aria-modal="true">
        <h2 className="dialog-title">{title}</h2>
        {message ? <p className="dialog-message">{message}</p> : null}
        {props.kind === "prompt" ? (
          <input
            className="dialog-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder={props.input?.placeholder ?? ""}
            maxLength={props.input?.maxLength}
            value={value}
            onChange={(e) =>
              setValue(props.input?.uppercase ? e.target.value.toUpperCase() : e.target.value)
            }
          />
        ) : null}
        <div className="dialog-buttons">
          <button type="button" className="dialog-button" onClick={props.onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`dialog-button ${danger ? "dialog-button-danger" : "dialog-button-primary"}`}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useDialog(): [DialogProps | null, (d: DialogProps | null) => void] {
  return useState<DialogProps | null>(null);
}
