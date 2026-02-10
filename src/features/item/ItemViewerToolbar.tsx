import { useAtom, useAtomValue } from "jotai";
import {
  itemDebugConfigAtom,
  itemEffectConfigAtom,
  itemCharTypeAtom,
  selectedModelVariantAtom,
} from "@/store/item";
import { isWorkbenchModeAtom, dummyPlacementModeAtom, activeWorkbenchAtom, editingDummyAtom } from "@/store/workbench";
import { ModelVariant } from "@/types/item";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Crosshair } from "lucide-react";

interface ItemViewerToolbarProps {
  showTables?: boolean;
  onToggleTables?: () => void;
}

const VARIANTS: { value: ModelVariant; label: string }[] = [
  { value: "ground", label: "Ground" },
  { value: "lance", label: "Lance" },
  { value: "carsise", label: "Carsise" },
  { value: "phyllis", label: "Phyllis" },
  { value: "ami", label: "Ami" },
];

const CHAR_TYPE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Lance" },
  { value: 1, label: "Carsise" },
  { value: 2, label: "Phyllis" },
  { value: 3, label: "Ami" },
];

export function ItemViewerToolbar({ showTables, onToggleTables }: ItemViewerToolbarProps) {
  const [variant, setVariant] = useAtom(selectedModelVariantAtom);
  const [debugConfig, setDebugConfig] = useAtom(itemDebugConfigAtom);
  const [effectConfig, setEffectConfig] = useAtom(itemEffectConfigAtom);
  const [charType, setCharType] = useAtom(itemCharTypeAtom);
  const isWorkbenchMode = useAtomValue(isWorkbenchModeAtom);
  const workbench = useAtomValue(activeWorkbenchAtom);
  const [placementMode, setPlacementMode] = useAtom(dummyPlacementModeAtom);
  const editingDummy = useAtomValue(editingDummyAtom);

  const toggleDebug = (key: keyof typeof debugConfig) => {
    setDebugConfig((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Workbench mode: focused creation toolbar ──
  if (isWorkbenchMode && workbench) {
    return (
      <TooltipProvider delayDuration={300}>
        <div className="h-11 bg-muted/50 border-b border-border flex items-center gap-3 px-3 shrink-0">
          {/* Workbench indicator */}
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
              Workbench
            </span>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* View toggles — only the ones relevant for editing */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              View
            </span>
            <div className="flex items-center gap-0.5 bg-background rounded-md border border-border p-0.5">
              <DebugToggle
                label="W"
                tooltip="Wireframe"
                active={debugConfig.showWireframe}
                onClick={() => toggleDebug("showWireframe")}
              />
              <DebugToggle
                label="D"
                tooltip="Dummies"
                active={debugConfig.showDummies}
                onClick={() => toggleDebug("showDummies")}
              />
              <DebugToggle
                label="G"
                tooltip="Glow Overlay"
                active={debugConfig.showGlowOverlay}
                onClick={() => toggleDebug("showGlowOverlay")}
              />
            </div>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Placement mode */}
          <div className="flex items-center gap-0.5 bg-background rounded-md border border-border p-0.5">
            <DebugToggle
              label="Place"
              tooltip="Click on model to place dummy"
              active={placementMode}
              onClick={() => setPlacementMode(!placementMode)}
            />
          </div>
          {placementMode && (
            <span className="text-[11px] text-amber-400/70 flex items-center gap-1">
              <Crosshair className="h-3 w-3" />
              {editingDummy != null
                ? `Click to relocate dummy ${editingDummy}`
                : "Click on model to place new dummy"}
            </span>
          )}
        </div>
      </TooltipProvider>
    );
  }

  // ── Normal mode: full item viewer toolbar ──
  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-11 bg-muted/50 border-b border-border flex items-center gap-3 px-3 shrink-0">
        {/* Model variant tabs */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Model
          </span>
          <Tabs
            value={variant}
            onValueChange={(v) => setVariant(v as ModelVariant)}
          >
            <TabsList className="h-7">
              {VARIANTS.map((v) => (
                <TabsTrigger key={v.value} value={v.value} className="text-xs px-2.5 py-0.5">
                  {v.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Debug toggles */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Debug
          </span>
          <div className="flex items-center gap-0.5 bg-background rounded-md border border-border p-0.5">
            <DebugToggle
              label="W"
              tooltip="Wireframe"
              active={debugConfig.showWireframe}
              onClick={() => toggleDebug("showWireframe")}
            />
            <DebugToggle
              label="B"
              tooltip="Bounding Spheres"
              active={debugConfig.showBoundingSpheres}
              onClick={() => toggleDebug("showBoundingSpheres")}
            />
            <DebugToggle
              label="D"
              tooltip="Dummies"
              active={debugConfig.showDummies}
              onClick={() => toggleDebug("showDummies")}
            />
            <DebugToggle
              label="G"
              tooltip="Glow Overlay"
              active={debugConfig.showGlowOverlay}
              onClick={() => toggleDebug("showGlowOverlay")}
            />
          </div>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Effect controls */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Refine
          </span>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={effectConfig.refineLevel}
            onChange={(e) =>
              setEffectConfig((prev) => ({
                ...prev,
                refineLevel: Number(e.target.value),
              }))
            }
            className="w-20 h-4 accent-primary"
          />
          <span className="text-xs font-mono text-foreground w-5 text-center tabular-nums">
            {effectConfig.refineLevel}
          </span>
        </div>

        <div className="flex items-center gap-0.5 bg-background rounded-md border border-border p-0.5">
          <DebugToggle
            label="Glow"
            tooltip="Show Lit Glow"
            active={effectConfig.showLitGlow}
            onClick={() =>
              setEffectConfig((prev) => ({
                ...prev,
                showLitGlow: !prev.showLitGlow,
              }))
            }
          />
          <DebugToggle
            label="Fx"
            tooltip="Show Effects"
            active={effectConfig.showEffects}
            onClick={() =>
              setEffectConfig((prev) => ({
                ...prev,
                showEffects: !prev.showEffects,
              }))
            }
          />
          <DebugToggle
            label="Ptl"
            tooltip="Show Particles"
            active={effectConfig.showParticles}
            onClick={() =>
              setEffectConfig((prev) => ({
                ...prev,
                showParticles: !prev.showParticles,
              }))
            }
          />
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Character type selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Char
          </span>
          <select
            className="h-7 text-xs rounded-md border border-input bg-background px-1.5"
            value={charType}
            onChange={(e) => setCharType(Number(e.target.value))}
          >
            {CHAR_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Tables decompile toggle */}
        <div className="flex items-center">
          <DebugToggle
            label="Tables"
            tooltip="Decompile binary tables"
            active={!!showTables}
            onClick={() => onToggleTables?.()}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function DebugToggle({
  label,
  tooltip,
  active,
  onClick,
}: {
  label: string;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={`h-6 px-2 text-xs font-medium rounded transition-colors ${
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
