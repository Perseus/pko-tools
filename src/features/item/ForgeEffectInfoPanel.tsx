import {
  ForgeEffectPreview,
  LIT_COLOR_NAMES,
  ANIM_TYPE_NAMES,
  BLEND_MODE_NAMES,
} from "@/types/item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemEffectConfig } from "@/store/item";

const LIT_COLOR_CSS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-blue-500",
  3: "bg-yellow-400",
  4: "bg-green-500",
};

interface ForgeEffectInfoPanelProps {
  preview: ForgeEffectPreview | null;
  effectConfig: ItemEffectConfig;
  effectCategory: number;
}

export function ForgeEffectInfoPanel({
  preview,
  effectConfig,
  effectCategory,
}: ForgeEffectInfoPanelProps) {
  if (!preview || effectCategory === 0) return null;

  const hasGlow = !!preview.lit_entry;
  const hasParticles = preview.particles.length > 0;
  if (!hasGlow && !hasParticles) return null;

  const tier = preview.effect_level;
  const alphaPercent = Math.round(preview.alpha * 100);

  return (
    <Card className="absolute bottom-4 left-4 w-72 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
      <CardHeader className="pb-2 px-3 pt-3">
        <CardTitle className="text-xs font-medium">Effect Info</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 text-xs space-y-2">
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Category:</span>
            <span className="font-mono">{effectCategory}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Effect Tier:</span>
            <span className="font-mono">{tier} / 3</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Opacity:</span>
            <span className="font-mono">{alphaPercent}%</span>
          </div>
        </div>

        {hasGlow && (
          <div className="border-t pt-2 space-y-1">
            <div className="font-medium text-xs mb-1 flex items-center gap-1.5">
              Glow
              {!effectConfig.showLitGlow && (
                <span className="text-muted-foreground font-normal">(hidden)</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Texture:</span>
              <span className="font-mono truncate ml-2">
                {preview.lit_entry!.file}
              </span>
            </div>
            {preview.lit_id != null && preview.lit_id !== 0 && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Color:</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      LIT_COLOR_CSS[preview.lit_id] ?? "bg-muted"
                    }`}
                  />
                  <span>{LIT_COLOR_NAMES[preview.lit_id] ?? `ID ${preview.lit_id}`}</span>
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Animation:</span>
              <span>
                {ANIM_TYPE_NAMES[preview.lit_entry!.anim_type] ??
                  `Type ${preview.lit_entry!.anim_type}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Blend Mode:</span>
              <span>
                {BLEND_MODE_NAMES[preview.lit_entry!.transp_type] ??
                  `Type ${preview.lit_entry!.transp_type}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Base Opacity:</span>
              <span className="font-mono">
                {Math.round(preview.lit_entry!.opacity * 100)}%
              </span>
            </div>
          </div>
        )}

        {hasParticles && (
          <div className="border-t pt-2 space-y-1">
            <div className="font-medium text-xs mb-1 flex items-center gap-1.5">
              Particles ({preview.particles.length})
              {!effectConfig.showParticles && (
                <span className="text-muted-foreground font-normal">(hidden)</span>
              )}
            </div>
            {preview.particles.map((p, idx) => (
              <div
                key={idx}
                className="pl-2 border-l border-border space-y-0.5"
              >
                <div className="flex justify-between">
                  <span className="text-muted-foreground">File:</span>
                  <span className="font-mono truncate ml-2">{p.par_file}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dummy:</span>
                  <span className="font-mono">{p.dummy_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scale:</span>
                  <span className="font-mono">{p.scale.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Effect ID:</span>
                  <span className="font-mono">{p.effect_id}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
