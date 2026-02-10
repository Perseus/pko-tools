import { useAtom, useAtomValue } from "jotai";
import { activeWorkbenchAtom } from "@/store/workbench";
import { currentProjectAtom } from "@/store/project";
import { itemGltfJsonAtom } from "@/store/item";
import { WorkbenchDummy, WorkbenchState, ITEM_TYPE_NAMES } from "@/types/item";
import { GlowOverlayPanel } from "./GlowOverlayPanel";
import { DummyListPanel } from "./DummyListPanel";
import { ItemInfoPreviewPanel } from "./ItemInfoPreviewPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCallback, useState } from "react";
import { rescaleItem, rotateItem, exportItem } from "@/commands/item";
import { toast } from "@/hooks/use-toast";
import { Loader2, Download } from "lucide-react";

export function WorkbenchSidePanel() {
  const [workbench, setWorkbench] = useAtom(activeWorkbenchAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setItemGltfJson] = useAtom(itemGltfJsonAtom);

  if (!workbench || !currentProject) return null;

  function updateField<K extends keyof WorkbenchState>(
    key: K,
    value: WorkbenchState[K]
  ) {
    if (!workbench) return;
    setWorkbench({ ...workbench, [key]: value });
  }

  function handleOverlayAdded(gltfJson: string) {
    setItemGltfJson(gltfJson);
    if (workbench) {
      setWorkbench({ ...workbench, hasGlowOverlay: true });
    }
  }

  const handleDummiesChange = useCallback(
    (newDummies: WorkbenchDummy[]) => {
      if (!workbench || !currentProject) return;
      setWorkbench({ ...workbench, dummies: newDummies });
    },
    [workbench, currentProject, setWorkbench]
  );

  function handleRegistered(id: number) {
    if (workbench) {
      setWorkbench({ ...workbench, registeredItemId: id });
    }
  }

  const [scaleFactor, setScaleFactor] = useState("1.0");
  const [rescaling, setRescaling] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotX, setRotX] = useState("0");
  const [rotY, setRotY] = useState("0");
  const [rotZ, setRotZ] = useState("0");
  const [exportModelId, setExportModelId] = useState("");
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!workbench || !currentProject) return;
    const targetId = exportModelId.trim();
    if (!targetId) {
      toast({ title: "Enter model ID", description: "Provide a target model ID for export." });
      return;
    }

    setExporting(true);
    try {
      const result = await exportItem(currentProject.id, workbench.lgoPath, targetId);
      toast({
        title: "Exported successfully",
        description: `LGO: ${result.targetModelId}.lgo, Textures: ${result.texturePaths.length}`,
      });
      setExportModelId("");
    } catch (err) {
      toast({ title: "Export failed", description: String(err) });
    } finally {
      setExporting(false);
    }
  }

  async function handleRotate(xDeg: number, yDeg: number, zDeg: number) {
    if (!workbench) return;
    setRotating(true);
    try {
      const gltfJson = await rotateItem(workbench.lgoPath, xDeg, yDeg, zDeg);
      setItemGltfJson(gltfJson);
      toast({
        title: "Model rotated",
        description: `Applied rotation (${xDeg}°, ${yDeg}°, ${zDeg}°)`,
      });
      // Reset custom inputs
      setRotX("0");
      setRotY("0");
      setRotZ("0");
    } catch (err) {
      toast({ title: "Rotation failed", description: String(err) });
    } finally {
      setRotating(false);
    }
  }

  async function handleCustomRotate() {
    const x = parseFloat(rotX) || 0;
    const y = parseFloat(rotY) || 0;
    const z = parseFloat(rotZ) || 0;
    if (x === 0 && y === 0 && z === 0) return;
    await handleRotate(x, y, z);
  }

  async function handleRescale() {
    if (!workbench || !currentProject) return;
    const factor = parseFloat(scaleFactor);
    if (isNaN(factor) || factor <= 0) {
      toast({ title: "Invalid scale", description: "Enter a positive number." });
      return;
    }
    if (Math.abs(factor - 1.0) < 0.0001) return;

    setRescaling(true);
    try {
      const gltfJson = await rescaleItem(
        currentProject.id,
        workbench.modelId,
        workbench.lgoPath,
        factor
      );
      setItemGltfJson(gltfJson);
      setWorkbench({
        ...workbench,
        scaleFactor: workbench.scaleFactor * factor,
      });
      setScaleFactor("1.0");
      toast({
        title: "Model rescaled",
        description: `Applied ${factor}x scale (cumulative: ${(workbench.scaleFactor * factor).toFixed(3)}x)`,
      });
    } catch (err) {
      toast({ title: "Rescale failed", description: String(err) });
    } finally {
      setRescaling(false);
    }
  }

  // Item type options for weapon types
  const typeOptions = Object.entries(ITEM_TYPE_NAMES)
    .filter(([k]) => [1, 2, 3, 4, 5, 6, 7, 8, 14, 15].includes(Number(k)))
    .map(([k, v]) => ({ value: Number(k), label: v }));

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Item Name
        </label>
        <Input
          value={workbench.itemName}
          onChange={(e) => updateField("itemName", e.target.value)}
          className="h-7 text-xs"
          placeholder="Enter item name..."
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Item Type
        </label>
        <select
          className="w-full h-7 text-xs rounded-md border border-input bg-background px-2"
          value={workbench.itemType}
          onChange={(e) => updateField("itemType", Number(e.target.value))}
        >
          <option value={0}>Select type...</option>
          {typeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Description
        </label>
        <Input
          value={workbench.itemDescription}
          onChange={(e) => updateField("itemDescription", e.target.value)}
          className="h-7 text-xs"
          placeholder="Item description..."
        />
      </div>

      <div className="text-xs text-muted-foreground">
        Model ID: <span className="font-mono">{workbench.modelId}</span>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Scale{" "}
          <span className="font-mono text-muted-foreground/60">
            (current: {workbench.scaleFactor.toFixed(3)}x)
          </span>
        </label>
        <div className="flex gap-1.5">
          <Input
            value={scaleFactor}
            onChange={(e) => setScaleFactor(e.target.value)}
            className="h-7 text-xs flex-1"
            type="number"
            step="0.1"
            min="0.001"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={handleRescale}
            disabled={rescaling}
          >
            {rescaling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Apply"
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          Multiplier applied to all vertices. Use 0.5 to halve, 2.0 to double.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Rotate (degrees)
        </label>
        <div className="flex gap-1 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => handleRotate(90, 0, 0)}
            disabled={rotating}
          >
            X+90
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => handleRotate(-90, 0, 0)}
            disabled={rotating}
          >
            X-90
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => handleRotate(0, 90, 0)}
            disabled={rotating}
          >
            Y+90
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => handleRotate(0, -90, 0)}
            disabled={rotating}
          >
            Y-90
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => handleRotate(0, 0, 90)}
            disabled={rotating}
          >
            Z+90
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => handleRotate(0, 0, -90)}
            disabled={rotating}
          >
            Z-90
          </Button>
        </div>
        <div className="flex gap-1">
          <Input
            value={rotX}
            onChange={(e) => setRotX(e.target.value)}
            className="h-6 text-[10px] w-14"
            placeholder="X"
            type="number"
          />
          <Input
            value={rotY}
            onChange={(e) => setRotY(e.target.value)}
            className="h-6 text-[10px] w-14"
            placeholder="Y"
            type="number"
          />
          <Input
            value={rotZ}
            onChange={(e) => setRotZ(e.target.value)}
            className="h-6 text-[10px] w-14"
            placeholder="Z"
            type="number"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={handleCustomRotate}
            disabled={rotating}
          >
            {rotating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
          </Button>
        </div>
      </div>

      <Separator />

      <GlowOverlayPanel
        hasOverlay={workbench.hasGlowOverlay}
        lgoPath={workbench.lgoPath}
        onOverlayAdded={handleOverlayAdded}
      />

      <Separator />

      <DummyListPanel
        dummies={workbench.dummies}
        itemType={workbench.itemType}
        onDummiesChange={handleDummiesChange}
      />

      <Separator />

      <ItemInfoPreviewPanel
        projectId={currentProject.id}
        modelId={workbench.modelId}
        registeredItemId={workbench.registeredItemId}
        onRegistered={handleRegistered}
      />

      <Separator />

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Export to Game
        </label>
        <div className="flex gap-1.5">
          <Input
            value={exportModelId}
            onChange={(e) => setExportModelId(e.target.value)}
            className="h-7 text-xs flex-1"
            placeholder="Target model ID (e.g. 01010027)"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          Export LGO + textures to exports/item/ with target model ID naming.
        </p>
      </div>
    </div>
  );
}
