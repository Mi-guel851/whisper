import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost" | "outline";
  loading?: boolean;
};

const variantClasses = {
  primary: "premium-button-primary",
  secondary: "premium-button-secondary",
  danger: "premium-button-danger",
  success: "premium-button-success",
  ghost: "premium-button-ghost",
  outline: "premium-button-outline",
};

export default function Button({
  children,
  variant = "primary",
  loading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`premium-button ${variantClasses[variant]} px-6 py-3 ${className}`}
    >
      {loading ? "Loading..." : children}
    </button>
  );
}
