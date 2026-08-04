"use client";

import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { tween } from "@/lib/motion";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: string;
  /** Shown below the field when there's no error. */
  hint?: string;
  error?: string | null;
  success?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  /**
   * Floating label sits inside the field and rises on focus/fill.
   * Falls back to a static label above the field when false.
   */
  floatingLabel?: boolean;
  containerClassName?: string;
};

/**
 * The app's text input.
 *
 * Generalises the `.auth-input-wrap` treatment (a focus glow on the wrapper
 * rather than the input) so validation state and the focus ring can render
 * outside the text box itself.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    success = false,
    icon,
    trailing,
    floatingLabel = true,
    containerClassName = "",
    className = "",
    id,
    value,
    defaultValue,
    placeholder,
    onFocus,
    onBlur,
    disabled,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const describedById = `${inputId}-desc`;

  const [focused, setFocused] = useState(false);
  // Tracked for uncontrolled use; controlled `value` takes precedence.
  const [hasContent, setHasContent] = useState(
    () => Boolean(defaultValue ?? value)
  );

  const filled = value !== undefined ? String(value).length > 0 : hasContent;
  const floating = floatingLabel && Boolean(label);
  const raised = floating && (focused || filled);

  const state = error ? "error" : success ? "success" : "default";

  const ringColor =
    state === "error"
      ? "var(--theme-error)"
      : state === "success"
        ? "var(--theme-success)"
        : "var(--theme-accent-purple)";

  return (
    <div className={`w-full ${containerClassName}`}>
      {label && !floating && (
        <label htmlFor={inputId} className="mb-1.5 block text-[0.8125rem] font-semibold theme-text-muted">
          {label}
        </label>
      )}

      <div
        className="relative flex items-center rounded-[--radius-lg] transition-[border-color,box-shadow] duration-200"
        style={{
          borderRadius: "var(--radius-lg)",
          border: `1px solid ${
            focused
              ? ringColor
              : state === "error"
                ? "var(--theme-error)"
                : "var(--theme-border)"
          }`,
          background: "var(--theme-card)",
          boxShadow: focused
            ? `0 0 0 3px color-mix(in srgb, ${ringColor} 18%, transparent), 0 0 20px color-mix(in srgb, ${ringColor} 14%, transparent)`
            : "var(--elev-1)",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {icon && (
          <span className="flex flex-none items-center pl-3.5 theme-text-subtle">
            {icon}
          </span>
        )}

        <div className="relative min-w-0 flex-1">
          {floating && (
            <motion.label
              htmlFor={inputId}
              // Pointer-events off while raised so the label can't eat clicks
              // aimed at the text it's sitting above.
              className={`pointer-events-none absolute left-0 origin-left font-medium ${
                icon ? "pl-3" : "pl-4"
              }`}
              initial={false}
              animate={{
                top: raised ? "0.4rem" : "50%",
                y: raised ? 0 : "-50%",
                scale: raised ? 0.78 : 1,
                color: focused
                  ? ringColor
                  : "var(--theme-text-muted)",
              }}
              transition={tween.fast}
            >
              {label}
            </motion.label>
          )}

          <input
            ref={ref}
            id={inputId}
            value={value}
            defaultValue={defaultValue}
            disabled={disabled}
            aria-invalid={state === "error" || undefined}
            aria-describedby={error || hint ? describedById : undefined}
            // A floating label occupies the placeholder's slot, so the
            // placeholder is only shown once the label has moved out of it.
            placeholder={floating ? (raised ? placeholder : "") : placeholder}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              setHasContent(event.target.value.length > 0);
              onBlur?.(event);
            }}
            onChange={(event) => {
              setHasContent(event.target.value.length > 0);
              props.onChange?.(event);
            }}
            className={`w-full border-0 bg-transparent outline-none ${
              icon ? "px-3" : "px-4"
            } ${floating ? "pb-2 pt-6" : "py-3"} text-[0.9375rem] ${className}`}
            style={{ color: "var(--theme-text)" }}
            {...props}
          />
        </div>

        {(trailing || state !== "default") && (
          <span className="flex flex-none items-center gap-1 pr-3.5">
            {state === "error" && (
              <AlertCircle size={16} style={{ color: "var(--theme-error)" }} />
            )}
            {state === "success" && (
              <CheckCircle2 size={16} style={{ color: "var(--theme-success)" }} />
            )}
            {trailing}
          </span>
        )}
      </div>

      <AnimatePresence initial={false} mode="wait">
        {(error || hint) && (
          <motion.p
            key={error || hint}
            id={describedById}
            role={error ? "alert" : undefined}
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={tween.fast}
            className="overflow-hidden pl-1 pt-1.5 text-[0.75rem] font-medium"
            style={{
              color: error ? "var(--theme-error)" : "var(--theme-text-muted)",
            }}
          >
            {error || hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
});

export default Input;
