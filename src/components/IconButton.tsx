import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  tone?: "default" | "danger";
}

export function IconButton({
  label,
  children,
  className = "",
  tone = "default",
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${tone === "danger" ? "icon-button-danger" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
