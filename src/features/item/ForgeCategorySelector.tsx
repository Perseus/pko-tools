import { CategorySummary, LIT_COLOR_NAMES } from "@/types/item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ForgeCategorySelectorProps {
  categories: CategorySummary[] | null;
  selected: number;
  onSelect: (category: number) => void;
}

function getCategoryLabel(cat: CategorySummary): string {
  if (!cat.available) return "";
  const color = LIT_COLOR_NAMES[cat.lit_id] ?? "";
  const hasGlow = cat.lit_id !== 0;
  if (hasGlow && cat.has_particles) return `${color} + Particles`;
  if (hasGlow) return `${color} Glow`;
  if (cat.has_particles) return "Particles";
  return "Effect";
}

const LIT_COLOR_CSS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-blue-500",
  3: "bg-yellow-400",
  4: "bg-green-500",
};

export function ForgeCategorySelector({
  categories,
  selected,
  onSelect,
}: ForgeCategorySelectorProps) {
  return (
    <Card className="absolute top-4 right-4 w-52 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
      <CardHeader className="pb-2 px-3 pt-3">
        <CardTitle className="text-xs font-medium">Forge Category</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <TooltipProvider delayDuration={200}>
          <div className="grid grid-cols-3 gap-1">
            <button
              className={`text-[10px] px-1.5 py-1 rounded border transition-colors ${
                selected === 0
                  ? "ring-1 ring-primary bg-primary/10 border-primary/40"
                  : "border-border hover:bg-accent"
              }`}
              onClick={() => onSelect(0)}
            >
              None
            </button>
            {(categories?.length ? categories : Array.from({ length: 14 }, (_, i) => ({
              category: i + 1,
              available: false,
              lit_id: 0,
              has_particles: false,
            }))).map((cat) => {
              const label = getCategoryLabel(cat);
              const colorDot = LIT_COLOR_CSS[cat.lit_id];
              const isSelected = selected === cat.category;

              return (
                <Tooltip key={cat.category}>
                  <TooltipTrigger asChild>
                    <button
                      disabled={!cat.available}
                      className={`text-[10px] px-1.5 py-1 rounded border transition-colors flex items-center gap-1 justify-center ${
                        !cat.available
                          ? "opacity-30 cursor-not-allowed border-border"
                          : isSelected
                          ? "ring-1 ring-primary bg-primary/10 border-primary/40"
                          : "border-border hover:bg-accent"
                      }`}
                      onClick={() => cat.available && onSelect(cat.category)}
                    >
                      {colorDot && cat.available && (
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${colorDot}`}
                        />
                      )}
                      <span>{cat.category}</span>
                    </button>
                  </TooltipTrigger>
                  {cat.available && label && (
                    <TooltipContent side="left">
                      <p>{label}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
