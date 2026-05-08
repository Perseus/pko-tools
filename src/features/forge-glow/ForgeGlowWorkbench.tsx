import { Canvas } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls, useGLTF } from "@react-three/drei";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { PackageOpen, Play, Plus, RotateCcw, Save, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CanvasErrorBoundary } from "@/components/CanvasErrorBoundary";
import { useToast } from "@/hooks/use-toast";
import { exportForgeGlowPackage, saveForgeGlowDraft } from "@/commands/forge-glow";
import { loadItemModel } from "@/commands/item";
import { currentProjectAtom } from "@/store/project";
import {
  activeForgeGlowDraftAtom,
  selectedForgeGlowLaneAtom,
  selectedForgeGlowVariantIdAtom,
} from "@/store/forge-glow";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
import { ParticleEffectRenderer } from "@/features/effect-v2/renderers/ParticleEffectRenderer";
import { PlaybackClock } from "@/features/effect-v2/PlaybackClock";
import { GlobalTimeProvider } from "@/features/effect-v2/TimeContext";
import {
  PKO_Z_UP_GRID_ROTATION,
  PkoZUpCamera,
} from "@/features/effect-v2/zUpScene";
import {
  buildForgeGlowPreview,
  createForgeGlowVariant,
  getEffectiveForgeGlowRows,
  getForgeGlowVariant,
  getForgeGlowVariants,
  updateForgeGlowVariant,
  upsertForgeGlowParticleOverride,
} from "./forgeGlowDraft";
import type { EffectiveForgeGlowRow, ForgeGlowVariant } from "@/types/forge-glow";
import { useGltfResource } from "@/hooks/use-gltf-resource";
import { computeItemDummyLineSpan } from "@/features/item/itemParticleDummySpan";

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

function ForgeGlowHostModel({
  gltfJson,
  rows,
  opacityScale,
}: {
  gltfJson: string | null;
  rows: EffectiveForgeGlowRow[];
  opacityScale: number;
}) {
  const uri = useGltfResource(gltfJson);
  if (!uri) return null;

  return <ForgeGlowHostModelScene uri={uri} rows={rows} opacityScale={opacityScale} />;
}

function ForgeGlowHostModelScene({
  uri,
  rows,
  opacityScale,
}: {
  uri: string;
  rows: EffectiveForgeGlowRow[];
  opacityScale: number;
}) {
  const project = useAtomValue(currentProjectAtom);
  const { scene } = useGLTF(uri);

  useEffect(() => {
    return () => {
      if (uri) useGLTF.clear(uri);
    };
  }, [uri]);

  const dummyPoints = useMemo(() => {
    scene.updateMatrixWorld(true);
    const sceneWorldInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    const dummies: { id: number; matrix: THREE.Matrix4; name: string }[] = [];

    scene.traverse((child) => {
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

      if (child.name === "glow_overlay" || child.userData?.glowOverlay === true) {
        child.visible = false;
      }
    });

    return dummies;
  }, [scene, uri]);

  const dummyLineSpan = useMemo(
    () => computeItemDummyLineSpan(dummyPoints),
    [dummyPoints],
  );

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={scene} />
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
              <ParticleEffectRenderer
                particleEffectName={(row.parFile ?? "").replace(/\.par$/i, "")}
                projectId={project?.id}
                loop
                dummyLineSpan={dummyLineSpan}
                opacityScale={opacityScale}
                respectHiddenState={false}
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

  useEffect(() => {
    setPlayback((value) => ({ ...value, time: 0, playing: false, loop: true }));
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

  function updateVariant(updater: (variant: ForgeGlowVariant) => ForgeGlowVariant) {
    if (!draft || readonly || !variant) return;
    setDraft(updateForgeGlowVariant(draft, variant.id, updater));
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
                  value={String(opacityScale)}
                  disabled={readonly}
                  inputMode="decimal"
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
                  value={String(variant?.overrides.lightId ?? draft.sourceRecipe.lightId ?? "")}
                  disabled={readonly}
                  inputMode="numeric"
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

            <div className="space-y-2">
              <div className="text-sm font-semibold">Particle Rows</div>
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
                        {row.parFile ?? "No particle file"} · effect {row.finalEffectId}
                      </div>
                    </button>
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

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Dummy</Label>
                      <Input
                        value={String(row.dummyId)}
                        disabled={readonly}
                        inputMode="numeric"
                        onChange={(event) =>
                          updateVariant((current) =>
                            upsertForgeGlowParticleOverride(current, row.laneTier, {
                              dummyId: Number(event.target.value),
                            }),
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Scale</Label>
                      <Input
                        value={String(row.scale)}
                        disabled={readonly}
                        inputMode="decimal"
                        onChange={(event) =>
                          updateVariant((current) =>
                            upsertForgeGlowParticleOverride(current, row.laneTier, {
                              scale: Number(event.target.value),
                            }),
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>Particle File</Label>
                    <Input
                      value={row.parFile ?? ""}
                      disabled={readonly}
                      onChange={(event) =>
                        updateVariant((current) =>
                          upsertForgeGlowParticleOverride(current, row.laneTier, {
                            parFile: event.target.value.trim() || null,
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
