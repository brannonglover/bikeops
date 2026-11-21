"use client";

import type { ButtonHTMLAttributes, ComponentType } from "react";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

type Variant = "edit" | "hide" | "show" | "delete";

const VARIANTS: Record<Variant, { icon: ComponentType<{ className?: string }>; className: string }> = {
  edit: { icon: Pencil, className: "border-slate-300 text-slate-700 hover:bg-slate-50" },
  hide: { icon: EyeOff, className: "border-amber-200 text-amber-700 hover:bg-amber-50" },
  show: { icon: Eye, className: "border-emerald-200 text-emerald-700 hover:bg-slate-50" },
  delete: { icon: Trash2, className: "border-red-200 text-red-700 hover:bg-red-50" },
};

/** Small outlined button for per-row actions (Edit, Hide/Show, Delete) in catalog lists. */
export function RowActionButton({
  variant,
  children,
  className = "",
  ...props
}: { variant: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { icon: Icon, className: variantClass } = VARIANTS[variant];
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${variantClass} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </button>
  );
}
