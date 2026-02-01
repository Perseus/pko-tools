import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import React from "react";

type Props = {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
};

export default function HelpTip({ text, side = "top" }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:text-muted-foreground"
          >
            <HelpCircle className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-[260px] text-xs leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type LabelProps = {
  children: React.ReactNode;
  help?: string;
  className?: string;
};

export function FieldLabel({ children, help, className }: LabelProps) {
  return (
    <div
      className={
        className ??
        "flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"
      }
    >
      <span>{children}</span>
      {help && <HelpTip text={help} />}
    </div>
  );
}

export function SmallLabel({ children, help, className }: LabelProps) {
  return (
    <div
      className={className ?? "flex items-center gap-1 text-[10px] text-muted-foreground"}
    >
      <span>{children}</span>
      {help && <HelpTip text={help} />}
    </div>
  );
}

type CheckboxWithHelpProps = {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
};

export function CheckboxWithHelp({ label, help, checked, onChange, ariaLabel }: CheckboxWithHelpProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={ariaLabel} />
      <span>{label}</span>
      {help && <HelpTip text={help} />}
    </label>
  );
}
