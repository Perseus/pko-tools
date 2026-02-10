import type { ValidationReport as ValidationReportType, ValidationItem } from "@/types/import";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

const SEVERITY_CONFIG = {
  error: { icon: AlertCircle, className: "text-red-400", bg: "bg-red-950/30" },
  warning: { icon: AlertTriangle, className: "text-yellow-400", bg: "bg-yellow-950/30" },
  info: { icon: Info, className: "text-blue-400", bg: "bg-blue-950/30" },
} as const;

function ValidationItemRow({ item }: { item: ValidationItem }) {
  const config = SEVERITY_CONFIG[item.severity];
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-2 p-2 rounded ${config.bg}`}>
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.className}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{item.message}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {item.code}
          {item.auto_fixable && (
            <span className="ml-2 text-green-400">(auto-fixable)</span>
          )}
        </p>
      </div>
    </div>
  );
}

export function ValidationReportPanel({
  report,
}: {
  report: ValidationReportType | null;
}) {
  if (!report) return null;

  if (report.items.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 rounded bg-green-950/30 text-green-400">
        <Info className="h-4 w-4" />
        <span className="text-sm">Model passes all validation checks.</span>
      </div>
    );
  }

  const errors = report.items.filter((i) => i.severity === "error");
  const warnings = report.items.filter((i) => i.severity === "warning");
  const infos = report.items.filter((i) => i.severity === "info");

  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-xs text-muted-foreground">
        {report.error_count > 0 && (
          <span className="text-red-400">{report.error_count} error(s)</span>
        )}
        {report.warning_count > 0 && (
          <span className="text-yellow-400">{report.warning_count} warning(s)</span>
        )}
        {report.info_count > 0 && (
          <span className="text-blue-400">{report.info_count} info</span>
        )}
      </div>
      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
        {errors.map((item, i) => (
          <ValidationItemRow key={`e-${i}`} item={item} />
        ))}
        {warnings.map((item, i) => (
          <ValidationItemRow key={`w-${i}`} item={item} />
        ))}
        {infos.map((item, i) => (
          <ValidationItemRow key={`i-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
