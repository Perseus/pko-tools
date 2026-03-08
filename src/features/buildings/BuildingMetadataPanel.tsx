import { BuildingMetadata } from "@/types/buildings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMeshColor } from "@/features/character/BoundingSphereIndicators";

interface BuildingMetadataPanelProps {
  metadata: BuildingMetadata | null;
  visible: boolean;
}

export function BuildingMetadataPanel({ metadata, visible }: BuildingMetadataPanelProps) {
  if (!visible || !metadata) return null;

  const totalVertices = metadata.geom_objects.reduce((s, g) => s + g.vertex_count, 0);
  const totalTriangles = metadata.geom_objects.reduce((s, g) => s + g.triangle_count, 0);
  const totalMaterials = metadata.geom_objects.reduce((s, g) => s + g.materials.length, 0);
  const animatedCount = metadata.geom_objects.filter((g) => g.has_animation).length;

  return (
    <Card className="absolute top-4 left-4 w-72 max-h-[80vh] overflow-y-auto bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Building Info</CardTitle>
      </CardHeader>
      <CardContent className="text-xs space-y-2">
        {/* Summary */}
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">File:</span>
            <span className="font-mono truncate ml-2">{metadata.filename}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">ID:</span>
            <span className="font-mono">{metadata.building_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version:</span>
            <span className="font-mono">{metadata.version}</span>
          </div>
        </div>

        {/* Geometry totals */}
        <div className="border-t pt-2 space-y-1">
          <div className="font-medium text-xs mb-1">Geometry</div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Geom Objects:</span>
            <span className="font-mono">{metadata.geom_objects.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vertices:</span>
            <span className="font-mono">{totalVertices.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Triangles:</span>
            <span className="font-mono">{totalTriangles.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Materials:</span>
            <span className="font-mono">{totalMaterials}</span>
          </div>
          {animatedCount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Animated Nodes:</span>
              <span className="font-mono">{animatedCount}</span>
            </div>
          )}
        </div>

        {/* Per-geom-object details */}
        <div className="border-t pt-2 space-y-1">
          <div className="font-medium text-xs mb-1">Geom Nodes</div>
          <div className="space-y-2">
            {metadata.geom_objects.map((g) => (
              <div
                key={g.index}
                className="border rounded p-1.5 space-y-0.5"
                style={{ borderLeftColor: getMeshColor(g.index), borderLeftWidth: 3 }}
              >
                <div className="flex justify-between font-medium">
                  <span>Node {g.index}</span>
                  <span className="text-muted-foreground font-normal">
                    id:{g.id}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verts/Tris:</span>
                  <span className="font-mono">
                    {g.vertex_count.toLocaleString()}/{g.triangle_count.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subsets:</span>
                  <span className="font-mono">{g.subset_count}</span>
                </div>
                {g.has_vertex_colors && (
                  <span className="text-blue-400 text-[10px]">vertex colors</span>
                )}
                {/* Animation flags */}
                <div className="flex flex-wrap gap-1">
                  {g.has_animation && (
                    <span className="px-1 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px]">
                      anim ({g.animation_frame_count}f)
                    </span>
                  )}
                  {g.has_texuv_anim && (
                    <span className="px-1 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px]">
                      uv-anim
                    </span>
                  )}
                  {g.has_teximg_anim && (
                    <span className="px-1 py-0.5 bg-orange-500/20 text-orange-400 rounded text-[10px]">
                      tex-swap
                    </span>
                  )}
                  {g.has_opacity_anim && (
                    <span className="px-1 py-0.5 bg-purple-500/20 text-purple-400 rounded text-[10px]">
                      opacity-anim
                    </span>
                  )}
                </div>
                {/* Materials */}
                {g.materials.map((m) => (
                  <div
                    key={m.index}
                    className="ml-2 text-[10px] text-muted-foreground space-y-0.5"
                  >
                    <div className="flex justify-between">
                      <span>
                        mat[{m.index}] {m.transp_type_name}
                      </span>
                      <span className="font-mono">
                        a:{m.opacity.toFixed(2)}
                      </span>
                    </div>
                    {m.tex_filename && (
                      <div className="truncate">{m.tex_filename}</div>
                    )}
                    {m.alpha_test_enabled && (
                      <span className="text-red-400">
                        alphaTest ref={m.alpha_ref}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
