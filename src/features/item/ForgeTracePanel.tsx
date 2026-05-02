import { traceForgeCombination } from "@/commands/item";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ForgeTraceResult } from "@/types/item";
import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

const CHAR_TYPE_NAMES: Record<number, string> = {
  0: "Lance",
  1: "Carsise",
  2: "Phyllis",
  3: "Ami",
};

type GemDraft = {
  itemId: string;
  level: string;
};

interface ForgeTracePanelProps {
  projectId: string | null;
  weaponItemId: number | null;
  weaponName: string | null;
  charType: number;
}

export function ForgeTracePanel({
  projectId,
  weaponItemId,
  weaponName,
  charType,
}: ForgeTracePanelProps) {
  const [gems, setGems] = useState<GemDraft[]>([
    { itemId: "", level: "9" },
    { itemId: "", level: "9" },
    { itemId: "", level: "" },
  ]);
  const [trace, setTrace] = useState<ForgeTraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const canTrace = !!projectId && weaponItemId != null;

  if (!isOpen) {
    return (
      <div className="absolute top-4 right-60 z-50">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shadow-lg"
          onClick={() => setIsOpen(true)}
        >
          Open Refine Trace
        </Button>
      </div>
    );
  }

  async function handleTrace() {
    if (!projectId || weaponItemId == null) return;

    setLoading(true);
    setError(null);
    try {
      const result = await traceForgeCombination(
        projectId,
        weaponItemId,
        charType,
        gems.map((gem) => ({
          item_id: Number(gem.itemId) || 0,
          level: Number(gem.level) || 0,
        }))
      );
      setTrace(result);
    } catch (err) {
      setTrace(null);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="absolute top-4 right-60 w-[30rem] max-h-[calc(100%-2rem)] overflow-auto bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
      <CardHeader className="pb-2 px-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium">Refine Trace</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setIsCollapsed((prev) => !prev)}
              aria-label={isCollapsed ? "Expand refine trace" : "Collapse refine trace"}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
              aria-label="Close refine trace"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {!isCollapsed && (
      <CardContent className="px-3 pb-3 text-xs space-y-3">
        <div className="space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Weapon:</span>
            <span className="font-medium text-right">{weaponName ?? "No weapon selected"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Char Type:</span>
            <span>{CHAR_TYPE_NAMES[charType] ?? `Type ${charType}`}</span>
          </div>
        </div>

        <div className="border-t pt-2 space-y-2">
          <div className="font-medium">Gem Inputs</div>
          {gems.map((gem, idx) => (
            <div key={idx} className="grid grid-cols-[4rem_1fr_4rem] gap-2 items-center">
              <span className="text-muted-foreground">Slot {idx + 1}</span>
              <Input
                value={gem.itemId}
                onChange={(e) =>
                  setGems((prev) =>
                    prev.map((entry, entryIdx) =>
                      entryIdx === idx ? { ...entry, itemId: e.target.value } : entry
                    )
                  )
                }
                placeholder="Gem item ID"
                className="h-7 text-xs"
              />
              <Input
                value={gem.level}
                onChange={(e) =>
                  setGems((prev) =>
                    prev.map((entry, entryIdx) =>
                      entryIdx === idx ? { ...entry, level: e.target.value } : entry
                    )
                  )
                }
                placeholder="Lvl"
                className="h-7 text-xs"
              />
            </div>
          ))}
          <Button
            size="sm"
            className="w-full"
            onClick={() => void handleTrace()}
            disabled={!canTrace || loading}
          >
            {loading ? "Tracing..." : "Trace Combination"}
          </Button>
          <div className="text-[11px] text-muted-foreground">
            Enter gem item IDs from `ItemInfo.txt`. Empty slots are treated as missing.
          </div>
        </div>

        {error && (
          <div className="border-t pt-2 text-destructive break-words">
            {error}
          </div>
        )}

        {trace && (
          <div className="border-t pt-2 space-y-3">
            <div className="space-y-1">
              <div className="font-medium">Resolved Gems</div>
              {trace.gems.length > 0 ? (
                trace.gems.map((gem) => (
                  <div key={gem.slot} className="pl-2 border-l border-border space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Slot {gem.slot}</span>
                      <span>{gem.item_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Item ID</span>
                      <span className="font-mono">{gem.item_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">StoneInfo ID</span>
                      <span className="font-mono">{gem.stone_info_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <span className="font-mono">{gem.stone_type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Level</span>
                      <span className="font-mono">{gem.level}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground">No valid gem slots were provided.</div>
              )}
            </div>

            <div className="space-y-1">
              <div className="font-medium">Lookup Path</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stone Types</span>
                <span className="font-mono">{`{${trace.stone_types_input.join(", ")}}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Category</span>
                <span className="font-mono">{trace.category || "None"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Refine Level</span>
                <span className="font-mono">{trace.total_level}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Effect Tier</span>
                <span className="font-mono">{trace.effect_level}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Alpha</span>
                <span className="font-mono">{Math.round(trace.alpha * 100)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ItemRefineInfo Row</span>
                <span className="font-mono truncate ml-2">{trace.item_refine_values.join(", ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">RefineEffect ID</span>
                <span className="font-mono">{trace.refine_effect_id ?? "None"}</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="font-medium">Glow</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Light ID</span>
                <span className="font-mono">{trace.light_id ?? "None"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Texture</span>
                <span className="font-mono truncate ml-2">
                  {trace.lit_entry?.file ?? "None"}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="font-medium">Particles</div>
              {trace.particles.length > 0 ? (
                trace.particles.map((particle) => (
                  <div
                    key={`${particle.lane_tier}-${particle.base_effect_id}-${particle.final_effect_id}`}
                    className="pl-2 border-l border-border space-y-0.5"
                  >
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tier Lane</span>
                      <span className="font-mono">{particle.lane_tier}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base Effect ID</span>
                      <span className="font-mono">{particle.base_effect_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Final Effect ID</span>
                      <span className="font-mono">{particle.final_effect_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dummy</span>
                      <span className="font-mono">{particle.dummy_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">PAR</span>
                      <span className="font-mono truncate ml-2">
                        {particle.par_file ?? "Missing from sceneffectinfo"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground">No particle effects resolved.</div>
              )}
            </div>
          </div>
        )}
      </CardContent>
      )}
    </Card>
  );
}
