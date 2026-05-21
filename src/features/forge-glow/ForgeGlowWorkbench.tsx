import { Canvas } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { MousePointer2, PackageOpen, Sparkles, Play, Plus, RotateCcw, Save, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CanvasErrorBoundary } from "@/components/CanvasErrorBoundary";
import { useToast } from "@/hooks/use-toast";
import { exportForgeGlowPackage, saveForgeGlowDraft } from "@/commands/forge-glow";
import { getItemLitInfo, loadItemModel } from "@/commands/item";
import { listEffects, listParFiles } from "@/commands/effect";
import { currentProjectAtom } from "@/store/project";
import {
  activeForgeGlowDraftAtom,
  selectedForgeGlowLaneAtom,
  selectedForgeGlowVariantIdAtom,
} from "@/store/forge-glow";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
import { ParticleEffectRenderer } from "@/features/effect-v2/renderers/ParticleEffectRenderer";
import { EffectRenderer } from "@/features/effect-v2/renderers/EffectRenderer";
import { ParticleOpacityProvider } from "@/features/effect-v2/renderers/particles/particleOpacityContext";
import { PlaybackClock } from "@/features/effect-v2/PlaybackClock";
import { GlobalTimeProvider } from "@/features/effect-v2/TimeContext";
import { useLoadEffect } from "@/features/effect-v2/useLoadEffect";
import {
  PKO_Z_UP_GRID_ROTATION,
  PkoZUpCamera,
} from "@/features/effect-v2/zUpScene";
import {
  buildForgeGlowPreview,
  buildForgeGlowLitRecipe,
  createForgeGlowVariant,
  filterForgeGlowEffectFileOptions,
  formatForgeGlowDummyOption,
  getEffectiveForgeGlowRows,
  getForgeGlowEffectFileKind,
  getForgeGlowVariant,
  getForgeGlowVariants,
  parseForgeGlowScaleInput,
  selectForgeGlowLitEntry,
  stripForgeGlowEffectFileExtension,
  removeForgeGlowParticleOverride,
  updateForgeGlowVariant,
  upsertForgeGlowParticleOverride,
} from "./forgeGlowDraft";
import type { EffectiveForgeGlowRow, ForgeGlowVariant } from "@/types/forge-glow";
import type { ForgeGlowDummyOption } from "./forgeGlowDraft";
import type { ItemLitEntry } from "@/types/item";
import { useGltfResource } from "@/hooks/use-gltf-resource";
import { computeItemDummyLineSpan } from "@/features/item/itemParticleDummySpan";
import { ItemLitRenderer } from "@/features/item/ItemLitRenderer";

function PlaybackControls() {
  const [playback, setPlayback] = useAtom(effectV2PlaybackAtom);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => setPlayback((value) => ({ ...value, playing: !value.playing }))}
      >
        {playback.playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => setPlayback((value) => ({ ...value, time: 0, playing: false }))}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <div className="min-w-16 font-mono text-xs text-muted-foreground">
        {playback.time.toFixed(2)}s
      </div>
    </div>
  );
}

function ForgeGlowEffRowRenderer({
  fileName,
  opacityScale,
}: {
  fileName: string;
  opacityScale: number;
}) {
  const effects = useLoadEffect([fileName]);
  if (!effects[0]) return null;
  return (
    <ParticleOpacityProvider value={opacityScale}>
      <EffectRenderer effect={effects[0]} />
    </ParticleOpacityProvider>
  );
}

function ForgeGlowRowEffectRenderer({
  fileName,
  projectId,
  dummyLineSpan,
  opacityScale,
}: {
  fileName: string;
  projectId: string | undefined;
  dummyLineSpan: ReturnType<typeof computeItemDummyLineSpan>;
  opacityScale: number;
}) {
  const kind = getForgeGlowEffectFileKind(fileName);
  if (kind === "eff") {
    return <ForgeGlowEffRowRenderer fileName={fileName} opacityScale={opacityScale} />;
  }
  if (kind === "par") {
    return (
      <ParticleEffectRenderer
        particleEffectName={stripForgeGlowEffectFileExtension(fileName)}
        projectId={projectId}
        loop
        dummyLineSpan={dummyLineSpan}
        opacityScale={opacityScale}
        respectHiddenState={false}
      />
    );
  }
  return null;
}

function ForgeGlowScaleInput({
  value,
  disabled,
  onValueChange,
}: {
  value: number;
  disabled: boolean;
  onValueChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [focused, value]);

  return (
    <Input
      name="forge-glow-row-scale"
      value={text}
      disabled={disabled}
      inputMode="decimal"
      autoComplete="off"
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = parseForgeGlowScaleInput(text);
        setText(String(parsed ?? value));
      }}
      onChange={(event) => {
        const nextText = event.target.value;
        setText(nextText);
        const parsed = parseForgeGlowScaleInput(nextText);
        if (parsed !== null) onValueChange(parsed);
      }}
    />
  );
}

function ForgeGlowEffectFileInput({
  value,
  disabled,
  options,
  onValueChange,
}: {
  value: string | null;
  disabled: boolean;
  options: string[];
  onValueChange: (value: string | null) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const filteredOptions = useMemo(
    () => filterForgeGlowEffectFileOptions(options, text),
    [options, text],
  );

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  return (
    <div className="relative">
      <Input
        name="forge-glow-effect-file"
        value={text}
        disabled={disabled}
        placeholder="Select .par or .eff"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          onValueChange(nextText.trim() || null);
          setOpen(true);
        }}
      />
      {!disabled && open && filteredOptions.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {filteredOptions.map((option) => {
            const kind = getForgeGlowEffectFileKind(option);
            return (
              <button
                type="button"
                key={option}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setText(option);
                  onValueChange(option);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 truncate">{option}</span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {kind}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ForgeGlowDummySelect({
  value,
  disabled,
  options,
  onValueChange,
}: {
  value: number;
  disabled: boolean;
  options: ForgeGlowDummyOption[];
  onValueChange: (value: number) => void;
}) {
  const choices = useMemo(() => {
    if (options.some((option) => option.id === value)) return options;
    return [
      ...options,
      { id: value, name: options.length === 0 ? "Current row dummy" : "Missing from model" },
    ].sort((left, right) => left.id - right.id);
  }, [options, value]);

  return (
    <select
      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      value={String(value)}
      disabled={disabled}
      onChange={(event) => onValueChange(Number(event.target.value))}
    >
      {choices.map((dummy) => (
        <option key={`${dummy.id}:${dummy.name}`} value={dummy.id}>
          {formatForgeGlowDummyOption(dummy)}
        </option>
      ))}
    </select>
  );
}

function ForgeGlowDummyMarkers({
  dummyPoints,
  activeDummyId,
  usedDummyIds,
  disabled,
  onPickDummy,
}: {
  dummyPoints: { id: number; matrix: THREE.Matrix4; name: string }[];
  activeDummyId: number | null;
  usedDummyIds: Set<number>;
  disabled: boolean;
  onPickDummy: (dummyId: number) => void;
}) {
  return (
    <>
      {dummyPoints.map((dummy) => {
        const active = dummy.id === activeDummyId;
        const used = usedDummyIds.has(dummy.id);
        return (
          <group
            key={`${dummy.id}:${dummy.name}`}
            matrix={dummy.matrix}
            matrixAutoUpdate={false}
          >
            <Html center distanceFactor={7} zIndexRange={[40, 0]}>
              <button
                type="button"
                disabled={disabled}
                title={formatForgeGlowDummyOption(dummy)}
                className={`pointer-events-auto grid h-7 w-7 place-items-center rounded-full border text-[10px] font-bold shadow-lg transition ${
                  active
                    ? "border-cyan-200 bg-cyan-500 text-slate-950 ring-4 ring-cyan-400/25"
                    : used
                      ? "border-amber-200 bg-slate-950/85 text-amber-100 ring-2 ring-amber-300/25"
                      : "border-white/70 bg-slate-950/80 text-white hover:bg-cyan-950"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPickDummy(dummy.id);
                }}
              >
                D{dummy.id}
              </button>
            </Html>
          </group>
        );
      })}
    </>
  );
}

function ForgeGlowHostModel({
  gltfJson,
  rows,
  opacityScale,
  litEntry,
  projectDir,
  onDummyPointsChange,
  onPickDummy,
}: {
  gltfJson: string | null;
  rows: EffectiveForgeGlowRow[];
  opacityScale: number;
  litEntry: ItemLitEntry | null;
  projectDir: string;
  onDummyPointsChange: (points: ForgeGlowDummyOption[]) => void;
  onPickDummy: (dummyId: number) => void;
}) {
  const uri = useGltfResource(gltfJson);
  if (!uri) return null;

  return (
    <ForgeGlowHostModelScene
      uri={uri}
      rows={rows}
      opacityScale={opacityScale}
      litEntry={litEntry}
      projectDir={projectDir}
      onDummyPointsChange={onDummyPointsChange}
      onPickDummy={onPickDummy}
    />
  );
}

function ForgeGlowHostModelScene({
  uri,
  rows,
  opacityScale,
  litEntry,
  projectDir,
  onDummyPointsChange,
  onPickDummy,
}: {
  uri: string;
  rows: EffectiveForgeGlowRow[];
  opacityScale: number;
  litEntry: ItemLitEntry | null;
  projectDir: string;
  onDummyPointsChange: (points: ForgeGlowDummyOption[]) => void;
  onPickDummy: (dummyId: number) => void;
}) {
  const project = useAtomValue(currentProjectAtom);
  const { scene } = useGLTF(uri);

  useEffect(() => {
    return () => {
      if (uri) useGLTF.clear(uri);
    };
  }, [uri]);

  const { dummyPoints, glowGeometryMesh } = useMemo(() => {
    scene.updateMatrixWorld(true);
    const sceneWorldInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    const dummies: { id: number; matrix: THREE.Matrix4; name: string }[] = [];
    let glowMesh: THREE.Mesh | null = null;
    let weaponMesh: THREE.Mesh | null = null;

    scene.traverse((child) => {
      const isGlowOverlay = child.name === "glow_overlay" || child.userData?.glowOverlay === true;

      if (child.userData?.type === "dummy") {
        dummies.push({
          id: child.userData.id ?? 0,
          matrix: new THREE.Matrix4().multiplyMatrices(
            sceneWorldInverse,
            child.matrixWorld,
          ),
          name: child.name,
        });
      }

      if (isGlowOverlay) {
        child.visible = false;
        if (child instanceof THREE.Mesh && !glowMesh) {
          glowMesh = child;
        } else {
          child.traverse((desc) => {
            if (desc instanceof THREE.Mesh && !glowMesh) {
              glowMesh = desc;
            }
          });
        }
      } else if (child instanceof THREE.Mesh && !weaponMesh) {
        weaponMesh = child;
      }
    });

    return { dummyPoints: dummies, glowGeometryMesh: glowMesh ?? weaponMesh };
  }, [scene, uri]);

  const dummyLineSpan = useMemo(
    () => computeItemDummyLineSpan(dummyPoints),
    [dummyPoints],
  );
  const usedDummyIds = useMemo(
    () => new Set(rows.map((row) => row.dummyId)),
    [rows],
  );
  const activeDummyId = rows.length === 1 ? rows[0].dummyId : null;

  useEffect(() => {
    onDummyPointsChange(
      dummyPoints
        .map((dummy) => ({ id: dummy.id, name: dummy.name }))
        .sort((left, right) => left.id - right.id),
    );
  }, [dummyPoints, onDummyPointsChange]);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={scene} />
      {litEntry && glowGeometryMesh && projectDir && (
        <ItemLitRenderer
          litEntry={litEntry}
          glowMesh={glowGeometryMesh}
          projectDir={projectDir}
        />
      )}
      <ForgeGlowDummyMarkers
        dummyPoints={dummyPoints}
        activeDummyId={activeDummyId}
        usedDummyIds={usedDummyIds}
        disabled={rows.length !== 1}
        onPickDummy={onPickDummy}
      />
      {rows
        .filter((row) => row.enabled && row.parFile)
        .map((row) => {
          const dummy = dummyPoints.find((point) => point.id === row.dummyId);
          return (
            <group
              key={`${row.laneTier}:${row.parFile}:${row.scale}`}
              matrix={dummy?.matrix ?? undefined}
              matrixAutoUpdate={!dummy}
            >
              <group scale={row.scale || 1}>
                <ForgeGlowRowEffectRenderer
                  fileName={row.parFile ?? ""}
                  projectId={project?.id}
                  dummyLineSpan={dummyLineSpan}
                  opacityScale={opacityScale}
                />
              </group>
            </group>
          );
        })}
    </group>
  );
}

function VariantBar({
  variants,
  selectedVariantId,
  onSelect,
  onCreate,
}: {
  variants: ForgeGlowVariant[];
  selectedVariantId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {variants.map((variant) => (
        <Button
          key={variant.id}
          size="sm"
          variant={variant.id === selectedVariantId ? "secondary" : "outline"}
          className="h-8"
          onClick={() => onSelect(variant.id)}
        >
          {variant.name}
        </Button>
      ))}
      <Button size="sm" variant="ghost" className="h-8 gap-2" onClick={onCreate}>
        <Plus className="h-3.5 w-3.5" />
        Variant
      </Button>
    </div>
  );
}

export default function ForgeGlowWorkbench() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [draft, setDraft] = useAtom(activeForgeGlowDraftAtom);
  const [variantId, setVariantId] = useAtom(selectedForgeGlowVariantIdAtom);
  const [selectedLane, setSelectedLane] = useAtom(selectedForgeGlowLaneAtom);
  const setPlayback = useSetAtom(effectV2PlaybackAtom);
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [gltfJson, setGltfJson] = useState<string | null>(null);
  const [activeLitEntry, setActiveLitEntry] = useState<ItemLitEntry | null>(null);
  const [effectFileOptions, setEffectFileOptions] = useState<string[]>([]);
  const [dummyOptions, setDummyOptions] = useState<ForgeGlowDummyOption[]>([]);

  const variant = useMemo(
    () => (draft ? getForgeGlowVariant(draft, variantId) : null),
    [draft, variantId],
  );
  const variants = useMemo(() => (draft ? getForgeGlowVariants(draft) : []), [draft]);
  const effectiveRows = useMemo(
    () => (draft ? getEffectiveForgeGlowRows(draft, variantId) : []),
    [draft, variantId],
  );
  const previewRows = useMemo(() => {
    if (selectedLane === "all") return effectiveRows;
    return effectiveRows.filter((row) => row.laneTier === selectedLane);
  }, [effectiveRows, selectedLane]);
  const opacityScale = variant?.overrides.alpha ?? draft?.sourceRecipe.alpha ?? 1;
  const readonly = !variant || variant.readonly;
  const forgePreview = useMemo(
    () => (draft ? buildForgeGlowPreview(draft, variantId) : null),
    [draft, variantId],
  );
  const effectiveLightId = forgePreview?.lit_id ?? null;
  const litRecipe = useMemo(
    () => buildForgeGlowLitRecipe(effectiveLightId, activeLitEntry),
    [activeLitEntry, effectiveLightId],
  );

  const handleDummyPointsChange = useCallback((points: ForgeGlowDummyOption[]) => {
    setDummyOptions((current) => {
      const currentSignature = current
        .map((point) => `${point.id}:${point.name}`)
        .join("|");
      const nextSignature = points
        .map((point) => `${point.id}:${point.name}`)
        .join("|");
      return currentSignature === nextSignature ? current : points;
    });
  }, []);

  useEffect(() => {
    setPlayback((value) => ({ ...value, time: 0, loop: true }));
  }, [draft?.id, variantId, selectedLane, setPlayback]);

  useEffect(() => {
    if (!currentProject?.id || !draft?.sourceRecipe.weaponModelId || draft.sourceRecipe.weaponModelId === "0") {
      setGltfJson(null);
      return;
    }

    let cancelled = false;
    loadItemModel(currentProject.id, draft.sourceRecipe.weaponModelId)
      .then((json) => {
        if (!cancelled) setGltfJson(json);
      })
      .catch(() => {
        if (!cancelled) setGltfJson(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, draft?.sourceRecipe.weaponModelId]);

  useEffect(() => {
    if (!currentProject?.id) {
      setEffectFileOptions([]);
      return;
    }

    let cancelled = false;
    Promise.all([
      listParFiles(currentProject.id).catch(() => []),
      listEffects(currentProject.id).catch(() => []),
    ]).then(([parFiles, effFiles]) => {
      if (cancelled) return;
      setEffectFileOptions(
        filterForgeGlowEffectFileOptions([...parFiles, ...effFiles], "", 5000),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id]);

  useEffect(() => {
    if (!currentProject?.id || !effectiveLightId) {
      setActiveLitEntry(null);
      return;
    }

    let cancelled = false;
    setActiveLitEntry(null);
    getItemLitInfo(currentProject.id, effectiveLightId)
      .then((litInfo) => {
        if (!cancelled) {
          setActiveLitEntry(
            selectForgeGlowLitEntry(litInfo, draft?.sourceRecipe.effectLevel ?? 0),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setActiveLitEntry(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, effectiveLightId, draft?.sourceRecipe.effectLevel]);

  function updateVariant(updater: (variant: ForgeGlowVariant) => ForgeGlowVariant) {
    if (!draft || readonly || !variant) return;
    setDraft(updateForgeGlowVariant(draft, variant.id, updater));
  }

  function assignSelectedLaneDummy(dummyId: number) {
    if (selectedLane === "all") {
      toast({
        title: "Select a lane first",
        description: "Dummy picking writes to the currently selected particle row.",
      });
      return;
    }
    updateVariant((current) =>
      upsertForgeGlowParticleOverride(current, selectedLane, { dummyId }),
    );
  }

  function addParticleRow() {
    if (!draft || readonly || !variant) return;
    const nextLaneTier =
      effectiveRows.reduce((max, row) => Math.max(max, row.laneTier), -1) + 1;
    const defaultDummy = dummyOptions[0]?.id ?? 0;
    updateVariant((current) =>
      upsertForgeGlowParticleOverride(current, nextLaneTier, {
        enabled: true,
        dummyId: defaultDummy,
        scale: 1,
        parFile: null,
      }),
    );
    setSelectedLane(nextLaneTier);
  }

  function removeParticleRow(laneTier: number) {
    if (!draft || readonly || !variant) return;
    updateVariant((current) => removeForgeGlowParticleOverride(current, laneTier));
    setSelectedLane((current) => (current === laneTier ? "all" : current));
  }

  function addVariant() {
    if (!draft) return;
    const nextVariant = createForgeGlowVariant(draft);
    setDraft({
      ...draft,
      variants: [...draft.variants, nextVariant],
      activeVariantId: nextVariant.id,
    });
    setVariantId(nextVariant.id);
  }

  async function saveDraft() {
    if (!draft || !currentProject) return;
    setSaving(true);
    try {
      const saved = await saveForgeGlowDraft(currentProject.id, {
        ...draft,
        activeVariantId: variantId,
      });
      setDraft(saved);
      toast({ title: "Forge glow draft saved" });
    } catch (err) {
      toast({ title: "Save failed", description: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function exportDraft() {
    if (!draft || !currentProject) return;
    setExporting(true);
    try {
      const result = await exportForgeGlowPackage(currentProject.id, draft.id, [variantId]);
      toast({
        title: "Forge glow package exported",
        description: result.outputDir,
      });
    } catch (err) {
      toast({ title: "Export failed", description: String(err) });
    } finally {
      setExporting(false);
    }
  }

  if (!draft) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="max-w-md rounded-md border border-border p-6">
          <div className="text-lg font-semibold">Forge Glow Bench</div>
          <div className="mt-2 text-sm text-muted-foreground">No draft selected.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{draft.name}</div>
          <div className="text-sm text-muted-foreground">
            {draft.sourceRecipe.weaponName} · item {draft.sourceRecipe.weaponItemId} · category{" "}
            {draft.sourceRecipe.category} · effect level {draft.sourceRecipe.effectLevel}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={saveDraft} disabled={saving}>
            <Save className="h-4 w-4" />
            Save
          </Button>
          <Button className="gap-2" onClick={exportDraft} disabled={exporting}>
            <PackageOpen className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(420px,1fr)_400px]">
        <div className="relative min-h-0 border-r border-border">
          <CanvasErrorBoundary className="absolute inset-0 flex items-center justify-center">
            <Canvas
              camera={{ position: [6, 6, 5], fov: 35 }}
              dpr={[1, 1.5]}
              gl={{ powerPreference: "high-performance" }}
            >
              <color attach="background" args={["#171923"]} />
              <ambientLight intensity={1} />
              <directionalLight position={[4, 6, 5]} intensity={1.25} />
              <PkoZUpCamera />
              <PlaybackClock />
              <GlobalTimeProvider>
                <ForgeGlowHostModel
                  gltfJson={gltfJson}
                  rows={previewRows}
                  opacityScale={forgePreview?.alpha ?? opacityScale}
                  litEntry={activeLitEntry}
                  projectDir={currentProject?.projectDirectory ?? ""}
                  onDummyPointsChange={handleDummyPointsChange}
                  onPickDummy={assignSelectedLaneDummy}
                />
              </GlobalTimeProvider>
              <OrbitControls makeDefault />
              <gridHelper
                args={[24, 24, "#30343f", "#20242d"]}
                rotation={PKO_Z_UP_GRID_ROTATION}
              />
              <GizmoHelper alignment="top-right" margin={[80, 80]}>
                <GizmoViewport
                  axisColors={["#f73b3b", "#3bf751", "#3b8ef7"]}
                  labelColor="white"
                />
              </GizmoHelper>
            </Canvas>
          </CanvasErrorBoundary>
          <div className="absolute bottom-3 left-3">
            <PlaybackControls />
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          <div className="space-y-5">
            <VariantBar
              variants={variants}
              selectedVariantId={variantId}
              onSelect={setVariantId}
              onCreate={addVariant}
            />

            <div className="grid grid-cols-3 gap-2 rounded-md border border-border p-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Alpha</div>
                <Input
                  name="forge-glow-alpha"
                  value={String(opacityScale)}
                  disabled={readonly}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) =>
                    updateVariant((current) => ({
                      ...current,
                      overrides: {
                        ...current.overrides,
                        alpha: Number(event.target.value),
                      },
                    }))
                  }
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Light</div>
                <Input
                  name="forge-glow-light-id"
                  value={String(variant?.overrides.lightId ?? draft.sourceRecipe.lightId ?? "")}
                  disabled={readonly}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(event) =>
                    updateVariant((current) => ({
                      ...current,
                      overrides: {
                        ...current.overrides,
                        lightId: event.target.value ? Number(event.target.value) : null,
                      },
                    }))
                  }
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Preview</div>
                <Button
                  variant={selectedLane === "all" ? "secondary" : "outline"}
                  className="mt-0 h-9 w-full"
                  onClick={() => setSelectedLane("all")}
                >
                  All Rows
                </Button>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    <Sparkles className="h-4 w-4" />
                    Native Lit Glow
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    PKO does not tint this with an arbitrary color. The visible color
                    comes from the item.lit texture selected by the light id and tier.
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Light ID</div>
                  <Input
                    name="forge-glow-native-light-id"
                    value={String(variant?.overrides.lightId ?? draft.sourceRecipe.lightId ?? "")}
                    disabled={readonly}
                    inputMode="numeric"
                    autoComplete="off"
                    onChange={(event) =>
                      updateVariant((current) => ({
                        ...current,
                        overrides: {
                          ...current.overrides,
                          lightId: event.target.value ? Number(event.target.value) : null,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Resolved Texture</div>
                  <Input value={activeLitEntry?.file ?? "None"} disabled />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border p-2">
                  <div className="text-xs text-muted-foreground">Animation</div>
                  <div className="mt-1 truncate text-xs">{litRecipe.animation}</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-xs text-muted-foreground">Blend</div>
                  <div className="mt-1 truncate text-xs">{litRecipe.blendMode}</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-xs text-muted-foreground">Lit Opacity</div>
                  <div className="mt-1 font-mono text-xs">
                    {litRecipe.opacity === null ? "None" : litRecipe.opacity}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-amber-950/10 bg-amber-50 p-3 text-xs text-amber-950">
                <div className="font-semibold">{litRecipe.summary}</div>
                <div className="mt-2 grid gap-1">
                  {litRecipe.steps.map((step, index) => (
                    <div key={step} className="flex gap-2">
                      <span className="font-mono text-amber-700">{index + 1}</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Particle Rows</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-2"
                  disabled={readonly}
                  onClick={addParticleRow}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Row
                </Button>
              </div>
              {effectiveRows.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  This forge recipe has no particle/effect rows yet. Add a row to attach
                  a .par or .eff file to a weapon dummy.
                </div>
              )}
              {effectiveRows.map((row) => (
                <div
                  key={row.laneTier}
                  className={`space-y-3 rounded-md border p-3 ${
                    selectedLane === row.laneTier ? "border-primary" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setSelectedLane(row.laneTier)}
                    >
                      <div className="text-sm font-medium">Lane {row.laneTier}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.parFile ?? "No particle file"} ·{" "}
                        {row.isCustom ? "custom row" : `effect ${row.finalEffectId}`}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.isCustom && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          disabled={readonly}
                          onClick={() => removeParticleRow(row.laneTier)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={row.enabled ? "secondary" : "outline"}
                        disabled={readonly}
                        onClick={() =>
                          updateVariant((current) =>
                            upsertForgeGlowParticleOverride(current, row.laneTier, {
                              enabled: !row.enabled,
                            }),
                          )
                        }
                      >
                        {row.enabled ? "On" : "Off"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Anchor</Label>
                        <Button
                          size="sm"
                          variant={selectedLane === row.laneTier ? "secondary" : "outline"}
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => setSelectedLane(row.laneTier)}
                        >
                          <MousePointer2 className="h-3 w-3" />
                          Pick
                        </Button>
                      </div>
                      <ForgeGlowDummySelect
                        value={row.dummyId}
                        disabled={readonly}
                        options={dummyOptions}
                        onValueChange={(dummyId) =>
                          updateVariant((current) =>
                            upsertForgeGlowParticleOverride(current, row.laneTier, {
                              dummyId,
                            }),
                          )
                        }
                      />
                      {dummyOptions.length === 0 && (
                        <div className="text-xs text-muted-foreground">
                          No model dummies discovered yet.
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label>Scale</Label>
                      <ForgeGlowScaleInput
                        value={row.scale}
                        disabled={readonly}
                        onValueChange={(value) =>
                          updateVariant((current) =>
                            upsertForgeGlowParticleOverride(current, row.laneTier, {
                              scale: value,
                            }),
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>Effect File</Label>
                    <ForgeGlowEffectFileInput
                      value={row.parFile ?? ""}
                      disabled={readonly}
                      options={effectFileOptions}
                      onValueChange={(value) =>
                        updateVariant((current) =>
                          upsertForgeGlowParticleOverride(current, row.laneTier, {
                            parFile: value,
                          }),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
