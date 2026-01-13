import { CharacterMetadata } from "@/types/character";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMeshColor } from "./BoundingSphereIndicators";

interface CharacterMetadataPanelProps {
  metadata: CharacterMetadata | null;
  loading?: boolean;
}

export function CharacterMetadataPanel({ metadata, loading }: CharacterMetadataPanelProps) {
  if (loading) {
    return (
      <Card className="absolute top-4 left-4 w-64 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Model Information</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          <div className="text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!metadata) {
    return (
      <Card className="absolute top-4 left-4 w-64 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Model Information</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          <div className="text-muted-foreground">No model loaded</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="absolute top-4 left-4 w-64 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Model Information</CardTitle>
      </CardHeader>
      <CardContent className="text-xs space-y-2">
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Character:</span>
            <span className="font-medium">{metadata.character_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Character ID:</span>
            <span className="font-mono">{metadata.character_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Model ID:</span>
            <span className="font-mono">{metadata.model_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Animation ID:</span>
            <span className="font-mono">{metadata.animation_id}</span>
          </div>
        </div>
        
        <div className="border-t pt-2 space-y-1">
          <div className="font-medium text-xs mb-1">Skeleton</div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bones:</span>
            <span className="font-mono">{metadata.bone_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Frames:</span>
            <span className="font-mono">{metadata.frame_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dummies:</span>
            <span className="font-mono">{metadata.dummy_count}</span>
          </div>
        </div>

        <div className="border-t pt-2 space-y-1">
          <div className="font-medium text-xs mb-1">Geometry</div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vertices:</span>
            <span className="font-mono">{metadata.vertex_count.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Triangles:</span>
            <span className="font-mono">{metadata.triangle_count.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Materials:</span>
            <span className="font-mono">{metadata.material_count}</span>
          </div>
        </div>

        {metadata.model_parts.length > 0 && (
          <div className="border-t pt-2 space-y-1">
            <div className="font-medium text-xs mb-1">Model Parts</div>
            <div className="flex flex-wrap gap-1">
              {metadata.model_parts.map((part, idx) => (
                <span 
                  key={idx} 
                  className="px-1.5 py-0.5 bg-secondary rounded font-mono text-xs flex items-center gap-1.5"
                >
                  <span 
                    className="w-2 h-2 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: getMeshColor(idx) }}
                  />
                  <span className="text-secondary-foreground">{part}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="border-t pt-2 space-y-1">
          <div className="font-medium text-xs mb-1">Debug Helpers</div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bounding Spheres:</span>
            <span className="font-mono">{metadata.bounding_spheres}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bounding Boxes:</span>
            <span className="font-mono">{metadata.bounding_boxes}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
