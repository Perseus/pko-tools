import { Canvas } from "@react-three/fiber";
import { Bounds, Center, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CanvasErrorBoundary } from "@/components/CanvasErrorBoundary";
import { getBuildingSceneInfo, loadBuildingModel } from "@/commands/buildings";
import BuildingsModelViewer from "@/features/buildings/BuildingsModelViewer";
import { LatestOnly } from "@/lib/latestOnly";
import { currentProjectAtom } from "@/store/project";
import type { BuildingSceneInfo } from "@/types/buildings";
import type { MapPlacementRecord } from "@/types/map";
import { useAtomValue } from "jotai";

const PREVIEW_LOAD_DELAY_MS = 200;
const MAX_PREVIEW_CACHE_ENTRIES = 6;
const MAX_SCENE_INFO_CACHE_ENTRIES = 24;
const previewCache = new Map<string, string>();
const inFlightPreviewLoads = new Map<string, Promise<string>>();
const sceneInfoCache = new Map<string, BuildingSceneInfo | null>();
const inFlightSceneInfoLoads = new Map<string, Promise<BuildingSceneInfo | null>>();
type SceneInfoBadge = {
  label: string;
  color?: [number, number, number];
};

function previewCacheKey(projectId: string, buildingId: number) {
  return `${projectId}:${buildingId}`;
}

function placementLabel(placement: MapPlacementRecord) {
  return placement.display_name
    ?? placement.asset_name
    ?? `${placement.kind} ${placement.obj_id}`;
}

export function getPlacementPreviewTransform(placement: Pick<MapPlacementRecord, "yaw_angle" | "scale">) {
  const yawDegrees = Number.isFinite(placement.yaw_angle) ? placement.yaw_angle : 0;
  const scalePercent = Number.isFinite(placement.scale) && placement.scale > 0
    ? placement.scale
    : 100;

  return {
    yawDegrees,
    yawRadians: (yawDegrees * Math.PI) / 180,
    scaleFactor: scalePercent / 100,
    scalePercent,
  };
}

function getCachedPreview(cacheKey: string): string | null {
  const cached = previewCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  previewCache.delete(cacheKey);
  previewCache.set(cacheKey, cached);
  return cached;
}

function cachePreview(cacheKey: string, gltfJson: string) {
  previewCache.delete(cacheKey);
  previewCache.set(cacheKey, gltfJson);

  while (previewCache.size > MAX_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    previewCache.delete(oldestKey);
  }
}

function getCachedSceneInfo(cacheKey: string): BuildingSceneInfo | null | undefined {
  if (!sceneInfoCache.has(cacheKey)) {
    return undefined;
  }

  const cached = sceneInfoCache.get(cacheKey) ?? null;
  sceneInfoCache.delete(cacheKey);
  sceneInfoCache.set(cacheKey, cached);
  return cached;
}

function cacheSceneInfo(cacheKey: string, info: BuildingSceneInfo | null) {
  sceneInfoCache.delete(cacheKey);
  sceneInfoCache.set(cacheKey, info);

  while (sceneInfoCache.size > MAX_SCENE_INFO_CACHE_ENTRIES) {
    const oldestKey = sceneInfoCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    sceneInfoCache.delete(oldestKey);
  }
}

function requestPreviewGltf(
  projectId: string,
  buildingId: number,
  cacheKey: string,
): Promise<string> {
  const inFlight = inFlightPreviewLoads.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = loadBuildingModel(projectId, buildingId)
    .then((nextGltfJson) => {
      cachePreview(cacheKey, nextGltfJson);
      return nextGltfJson;
    })
    .finally(() => {
      if (inFlightPreviewLoads.get(cacheKey) === request) {
        inFlightPreviewLoads.delete(cacheKey);
      }
    });

  inFlightPreviewLoads.set(cacheKey, request);
  return request;
}

function requestSceneInfo(
  projectId: string,
  buildingId: number,
  cacheKey: string,
): Promise<BuildingSceneInfo | null> {
  const inFlight = inFlightSceneInfoLoads.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = getBuildingSceneInfo(projectId, buildingId)
    .then((nextSceneInfo) => {
      cacheSceneInfo(cacheKey, nextSceneInfo);
      return nextSceneInfo;
    })
    .catch(() => {
      return null;
    })
    .finally(() => {
      if (inFlightSceneInfoLoads.get(cacheKey) === request) {
        inFlightSceneInfoLoads.delete(cacheKey);
      }
    });

  inFlightSceneInfoLoads.set(cacheKey, request);
  return request;
}

export function clearMapPlacementBuildingPreviewCache() {
  previewCache.clear();
  inFlightPreviewLoads.clear();
  sceneInfoCache.clear();
  inFlightSceneInfoLoads.clear();
}

export default function MapPlacementBuildingPreview({
  placement,
}: {
  placement: MapPlacementRecord | null;
}) {
  const currentProject = useAtomValue(currentProjectAtom);
  const [gltfJson, setGltfJson] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneInfo, setSceneInfo] = useState<BuildingSceneInfo | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const requestGuard = useRef(new LatestOnly());
  const sceneInfoGuard = useRef(new LatestOnly());

  const buildingId = placement?.obj_type === 0 ? placement.obj_id : null;
  const label = placement ? placementLabel(placement) : "Building";
  const cacheKey = currentProject && buildingId != null
    ? previewCacheKey(currentProject.id, buildingId)
    : null;

  useEffect(() => {
    if (!currentProject || buildingId == null || !cacheKey) {
      requestGuard.current.invalidate();
      setGltfJson(null);
      setPending(false);
      setLoading(false);
      setError(null);
      return;
    }

    const cached = getCachedPreview(cacheKey);
    if (cached) {
      requestGuard.current.invalidate();
      setGltfJson(cached);
      setPending(false);
      setLoading(false);
      setError(null);
      return;
    }

    const requestVersion = requestGuard.current.begin();
    let active = true;
    let timeoutId: number | undefined;
    setGltfJson(null);
    setPending(true);
    setLoading(false);
    setError(null);

    timeoutId = window.setTimeout(() => {
      if (!active || !requestGuard.current.isLatest(requestVersion)) {
        return;
      }
      setPending(false);
      setLoading(true);

      requestPreviewGltf(currentProject.id, buildingId, cacheKey)
        .then((nextGltfJson) => {
          if (!active || !requestGuard.current.isLatest(requestVersion)) {
            return;
          }
          setGltfJson(nextGltfJson);
        })
        .catch((loadError) => {
          if (!active || !requestGuard.current.isLatest(requestVersion)) {
            return;
          }
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        })
        .finally(() => {
          if (!active || !requestGuard.current.isLatest(requestVersion)) {
            return;
          }
          setLoading(false);
        });
    }, PREVIEW_LOAD_DELAY_MS);

    return () => {
      active = false;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [buildingId, cacheKey, currentProject, retryNonce]);

  useEffect(() => {
    if (!currentProject || buildingId == null || !cacheKey) {
      sceneInfoGuard.current.invalidate();
      setSceneInfo(null);
      return;
    }

    const cached = getCachedSceneInfo(cacheKey);
    if (cached !== undefined) {
      sceneInfoGuard.current.invalidate();
      setSceneInfo(cached);
      return;
    }

    const requestVersion = sceneInfoGuard.current.begin();
    let active = true;
    setSceneInfo(null);

    requestSceneInfo(currentProject.id, buildingId, cacheKey)
      .then((nextSceneInfo) => {
        if (!active || !sceneInfoGuard.current.isLatest(requestVersion)) {
          return;
        }
        setSceneInfo(nextSceneInfo);
      });

    return () => {
      active = false;
    };
  }, [buildingId, cacheKey, currentProject, retryNonce]);

  const previewName = useMemo(
    () => `Selected building preview ${label}`,
    [label],
  );
  const sceneBadges = useMemo(
    () => sceneInfo ? sceneInfoBadges(sceneInfo) : [],
    [sceneInfo],
  );
  const previewTransform = useMemo(
    () => placement ? getPlacementPreviewTransform(placement) : null,
    [placement],
  );

  if (!placement || buildingId == null || !currentProject || !previewTransform) {
    return null;
  }

  return (
    <section
      role="region"
      aria-label={previewName}
      aria-busy={loading}
      className="mt-2 overflow-hidden rounded border bg-muted/20"
    >
      <div className="flex items-center justify-between gap-2 border-b bg-background/85 px-2 py-1.5">
        <div className="min-w-0">
          <div className="text-[11px] uppercase text-muted-foreground">3D preview</div>
          <div className="truncate text-xs font-medium">{label}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Yaw {previewTransform.yawDegrees}
            </span>
            <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Scale {previewTransform.scalePercent}%
            </span>
          </div>
        </div>
        <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
          ID {buildingId}
        </div>
      </div>
      {sceneBadges.length > 0 && (
        <div className="border-b bg-background/70 px-2 py-1.5">
          <div className="flex flex-wrap gap-1">
            {sceneBadges.map((badge) => (
              <span
                key={badge.label}
                className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {badge.color && (
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-sm border border-background/70"
                    style={{ backgroundColor: rgbCss(badge.color) }}
                  />
                )}
                {badge.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="relative h-36 bg-slate-950">
        {pending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-xs text-muted-foreground">
            Preview pending
          </div>
        )}

        {loading && (
          <div
            role="status"
            className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-xs text-muted-foreground"
          >
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading preview...
          </div>
        )}

        {error && !loading && (
          <div
            role="alert"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/90 p-3 text-center"
          >
            <div className="text-xs font-medium">Preview unavailable</div>
            <div className="max-w-full text-[11px] text-muted-foreground">{error}</div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              aria-label="Retry building preview"
              onClick={() => setRetryNonce((current) => current + 1)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}

        {gltfJson && !error && (
          <CanvasErrorBoundary className="absolute inset-0 flex items-center justify-center">
            <Canvas
              frameloop="demand"
              camera={{
                position: [18, 14, 18],
                fov: 35,
                near: 0.01,
                far: 10000,
              }}
              dpr={[1, 1.25]}
              gl={{ powerPreference: "high-performance", alpha: true }}
              style={{
                background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
              }}
            >
              <ambientLight intensity={0.7} />
              <directionalLight position={[10, 15, 10]} intensity={0.9} />
              <Suspense fallback={null}>
                <Bounds fit clip observe margin={1.25}>
                  <Center>
                    <group
                      rotation={[0, previewTransform.yawRadians, 0]}
                      scale={previewTransform.scaleFactor}
                    >
                      <BuildingsModelViewer
                        gltfJson={gltfJson}
                        showMeshOutlines={false}
                        playAnimation={false}
                      />
                    </group>
                  </Center>
                </Bounds>
              </Suspense>
              <OrbitControls
                makeDefault
                enablePan={false}
                minDistance={1}
                maxDistance={250}
              />
            </Canvas>
          </CanvasErrorBoundary>
        )}
      </div>
    </section>
  );
}

function sceneInfoBadges(info: BuildingSceneInfo): SceneInfoBadge[] {
  const badges: SceneInfoBadge[] = [];

  if (info.enable_point_light) {
    badges.push({
      label: `Point light ${formatRgb(info.point_color)}`,
      color: info.point_color,
    });
    if (info.point_range > 0) {
      badges.push({ label: `Range ${info.point_range}` });
    }
  }

  if (info.enable_env_light) {
    badges.push({
      label: `Env light ${formatRgb(info.env_color)}`,
      color: info.env_color,
    });
  }

  if (info.fade_obj_num > 0) {
    badges.push({ label: `Fade ${info.fade_obj_num} at ${formatPercent(info.fade_coefficient)}` });
  }

  if (info.shade_flag) {
    badges.push({ label: "Tile shade" });
  }

  if (info.is_really_big || info.size_flag !== 0) {
    badges.push({ label: "Large object" });
  }

  if (info.attach_effect_id > 0) {
    badges.push({ label: `Effect ${info.attach_effect_id}` });
  }

  return badges;
}

function formatRgb(rgb: [number, number, number]): string {
  return rgb.map((channel) => Math.round(channel)).join(", ");
}

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${formatRgb(rgb)})`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
