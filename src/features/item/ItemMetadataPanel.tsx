import { ItemMetadata } from "@/types/item";
import { ITEM_TYPE_NAMES } from "@/types/item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ItemMetadataPanelProps {
  metadata: ItemMetadata | null;
}

export function ItemMetadataPanel({ metadata }: ItemMetadataPanelProps) {
  if (!metadata) {
    return (
      <Card className="absolute top-4 left-4 w-64 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Item Information</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          <div className="text-muted-foreground">No item loaded</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="absolute top-4 left-4 w-64 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Item Information</CardTitle>
      </CardHeader>
      <CardContent className="text-xs space-y-2">
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name:</span>
            <span className="font-medium">{metadata.item_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Item ID:</span>
            <span className="font-mono">{metadata.item_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type:</span>
            <span className="font-mono">
              {ITEM_TYPE_NAMES[metadata.item_type] ?? `Type ${metadata.item_type}`}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Model ID:</span>
            <span className="font-mono">{metadata.model_id}</span>
          </div>
        </div>

        <div className="border-t pt-2 space-y-1">
          <div className="font-medium text-xs mb-1">Geometry</div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vertices:</span>
            <span className="font-mono">
              {metadata.vertex_count.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Triangles:</span>
            <span className="font-mono">
              {metadata.triangle_count.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Materials:</span>
            <span className="font-mono">{metadata.material_count}</span>
          </div>
        </div>

        <div className="border-t pt-2 space-y-1">
          <div className="font-medium text-xs mb-1">Helpers</div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dummy Points:</span>
            <span className="font-mono">{metadata.dummy_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bounding Spheres:</span>
            <span className="font-mono">{metadata.bounding_spheres}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bounding Boxes:</span>
            <span className="font-mono">{metadata.bounding_boxes}</span>
          </div>
        </div>

        {metadata.available_models.length > 0 && (
          <div className="border-t pt-2 space-y-1">
            <div className="font-medium text-xs mb-1">Model Variants</div>
            <div className="flex flex-col gap-0.5">
              {metadata.available_models.map((model, idx) => (
                <span
                  key={idx}
                  className="px-1.5 py-0.5 bg-secondary rounded font-mono text-xs text-secondary-foreground"
                >
                  {model}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
