import { Button } from "@/components/ui/button";
import { addGlowOverlay } from "@/commands/item";
import { toast } from "@/hooks/use-toast";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

interface GlowOverlayPanelProps {
  hasOverlay: boolean;
  lgoPath: string;
  onOverlayAdded: (gltfJson: string) => void;
}

export function GlowOverlayPanel({
  hasOverlay,
  lgoPath,
  onOverlayAdded,
}: GlowOverlayPanelProps) {
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    setAdding(true);
    try {
      const gltfJson = await addGlowOverlay(lgoPath);
      onOverlayAdded(gltfJson);
      toast({
        title: "Glow overlay added",
        description: "Subset 1 duplicated from subset 0. Use the G toggle to verify.",
      });
    } catch (err) {
      toast({ title: "Failed to add glow overlay", description: String(err) });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Glow Overlay
      </label>
      {hasOverlay ? (
        <div className="text-xs text-green-400 flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Active (subset 1 present)
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            No glow overlay detected. Forge effects require subset 1.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={adding}
            className="w-full"
          >
            {adding ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            {adding ? "Adding..." : "Add Glow Overlay"}
          </Button>
        </div>
      )}
    </div>
  );
}
