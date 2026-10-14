// Small modal dialogs, centered over the page, replacing window.prompt /
// window.confirm (which browsers pin to the window and can't be styled).
// Plain DOM on top of the Phaser canvas -- a text box needs a real <input>
// anyway. Styles are in src/style.css (.dialog-*).
//
// Enter confirms, Escape or a click outside the box cancels.

export interface DialogInputOptions {
  placeholder?: string;
  maxLength?: number;
  uppercase?: boolean;
}

interface OpenDialogOptions {
  title: string;
  message?: string;
  input?: DialogInputOptions;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

function openDialog({
  title,
  message,
  input,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
}: OpenDialogOptions): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";

    const box = document.createElement("div");
    box.className = "dialog-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const heading = document.createElement("h2");
    heading.className = "dialog-title";
    heading.textContent = title;
    box.append(heading);

    if (message) {
      const text = document.createElement("p");
      text.className = "dialog-message";
      text.textContent = message;
      box.append(text);
    }

    let field: HTMLInputElement | null = null;
    if (input) {
      field = document.createElement("input");
      field.className = "dialog-input";
      field.type = "text";
      field.autocomplete = "off";
      field.spellcheck = false;
      field.placeholder = input.placeholder ?? "";
      if (input.maxLength) field.maxLength = input.maxLength;
      if (input.uppercase) {
        const el = field;
        el.addEventListener("input", () => {
          el.value = el.value.toUpperCase();
        });
      }
      box.append(field);
    }

    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "dialog-button";
    cancel.textContent = cancelLabel;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = `dialog-button ${danger ? "dialog-button-danger" : "dialog-button-primary"}`;
    ok.textContent = confirmLabel;
    buttons.append(cancel, ok);
    box.append(buttons);

    backdrop.append(box);
    document.body.append(backdrop);

    const close = (result: string | boolean | null): void => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(result);
    };
    const confirm = (): void => {
      if (!field) return close(true);
      const value = field.value.trim();
      if (!value) {
        field.focus();
        return;
      }
      close(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      // Captured and stopped here so Phaser's keyboard handling never sees it.
      if (event.key === "Enter") confirm();
      else if (event.key === "Escape") close(field ? null : false);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };

    // Phaser listens for presses on the whole window (to track ones that start
    // outside the canvas), so without this a click on the dialog would also
    // press whatever game button sits underneath it. Stopping presses here
    // keeps them out of the game; the dialog's own click handlers still run.
    for (const type of ["pointerdown", "mousedown", "touchstart"]) {
      backdrop.addEventListener(type, (event) => event.stopPropagation());
    }

    ok.addEventListener("click", confirm);
    cancel.addEventListener("click", () => close(field ? null : false));
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) close(field ? null : false);
    });
    document.addEventListener("keydown", onKey, true);

    (field ?? ok).focus();
  });
}

export interface PromptDialogOptions {
  title: string;
  message?: string;
  placeholder?: string;
  maxLength?: number;
  uppercase?: boolean;
  confirmLabel?: string;
}

// Resolves to the trimmed text, or null if cancelled.
export function promptDialog({
  title,
  message,
  placeholder,
  maxLength,
  uppercase = false,
  confirmLabel = "OK",
}: PromptDialogOptions): Promise<string | null> {
  return openDialog({ title, message, input: { placeholder, maxLength, uppercase }, confirmLabel }) as Promise<
    string | null
  >;
}

export interface ConfirmDialogOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// Resolves to true / false.
export function confirmDialog({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
}: ConfirmDialogOptions): Promise<boolean> {
  return openDialog({ title, message, confirmLabel, cancelLabel, danger }) as Promise<boolean>;
}
