import type { ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check } from "lucide-react";

import {
  SelectBase,
  SelectContent,
  SelectTrigger,
  SelectValue,
  cn,
} from "~/lib/ui";

export type FilterSelectOption = {
  count?: number;
  disabled?: boolean;
  label: string;
  value: string;
};

/**
 * The app-wide styled select used for filters, sorts, and form dropdowns.
 * Replaces the native <select> helpers that previously lived in each page.
 */
export function FilterSelect({
  ariaLabel,
  className,
  icon,
  label,
  labelClassName,
  onChange,
  options,
  placeholder,
  triggerClassName,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  icon?: ReactNode;
  label?: string;
  labelClassName?: string;
  onChange: (value: string) => void;
  options: FilterSelectOption[];
  placeholder?: string;
  triggerClassName?: string;
  value: string;
}) {
  return (
    <label className={cn("block", label && "space-y-2", className)}>
      {label ? (
        <span
          className={cn(
            "flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground",
            labelClassName,
          )}
        >
          {icon}
          {label}
        </span>
      ) : null}
      <SelectBase onValueChange={onChange} value={value || undefined}>
        <SelectTrigger
          aria-label={ariaLabel ?? label ?? placeholder}
          className={cn("bg-background px-3", triggerClassName)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <CountSelectItem
              count={option.count}
              disabled={option.disabled}
              key={option.value}
              label={option.label}
              value={option.value}
            />
          ))}
        </SelectContent>
      </SelectBase>
    </label>
  );
}

/**
 * SelectItem variant that renders an optional facet count right-aligned and
 * muted. Mirrors the lib SelectItem styles; the count lives outside ItemText
 * so the trigger only displays the label.
 */
function CountSelectItem({
  count,
  disabled,
  label,
  value,
}: {
  count?: number;
  disabled?: boolean;
  label: string;
  value: string;
}) {
  return (
    <SelectPrimitive.Item
      className={`
        relative flex w-full cursor-default select-none items-center rounded-md
        py-1.5 pl-2 pr-2 text-[13px] outline-hidden transition-colors

        data-disabled:pointer-events-none data-disabled:opacity-50

        focus:bg-accent focus:text-accent-foreground
      `}
      disabled={disabled}
      value={value}
    >
      <span className="mr-1 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
      {count != null ? (
        <span className="ml-auto pl-3 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </SelectPrimitive.Item>
  );
}
