"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react";

type AuthFieldProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** "password" renders a reveal toggle and starts masked. */
  type?: "text" | "email" | "password";
  icon?: LucideIcon;
  required?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
};

export default function AuthField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  icon: Icon,
  required = false,
  autoComplete,
  inputMode,
}: AuthFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  return (
    <div>
      {label && (
        <label htmlFor={id} className="auth-label">
          {label}
        </label>
      )}

      <div className="auth-input-wrap">
        {Icon && (
          <span className="auth-input-icon" aria-hidden="true">
            <Icon size={18} />
          </span>
        )}

        <input
          id={id}
          type={isPassword && revealed ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          inputMode={inputMode}
          /* Opts out of the app-wide caret sparks (`components/TypingSparks`).
             `type="password"` is excluded there automatically, but the reveal
             toggle above flips this field to `type="text"` — and sparks mark the
             caret, which is a visible character count on a secret the user just
             chose to show on screen. Marked on the field itself so it holds in
             both states. */
          data-no-sparks={isPassword || undefined}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="auth-reveal"
            tabIndex={-1}
            aria-label={revealed ? "Hide password" : "Show password"}
          >
            {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}
