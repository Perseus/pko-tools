import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateItemInfoEntry, registerItem } from "@/commands/item";
import { toast } from "@/hooks/use-toast";
import { ItemInfoPreview } from "@/types/item";
import { Check, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

interface ItemInfoPreviewPanelProps {
  projectId: string;
  modelId: string;
  registeredItemId: number | null;
  onRegistered: (id: number) => void;
}

export function ItemInfoPreviewPanel({
  projectId,
  modelId,
  registeredItemId,
  onRegistered,
}: ItemInfoPreviewPanelProps) {
  const [preview, setPreview] = useState<ItemInfoPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [requestedId, setRequestedId] = useState("");
  const [idError, setIdError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setIdError(null);
    try {
      const trimmed = requestedId.trim();
      let reqId: number | null = null;
      if (trimmed) {
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          setIdError("Enter a positive integer.");
          return;
        }
        reqId = parsed;
      }

      const result = await generateItemInfoEntry(projectId, modelId, reqId);
      setPreview(result);
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes("already exists")) {
        setIdError(errStr);
      } else {
        toast({ title: "Failed to generate entry", description: errStr });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (!preview) return;
    setRegistering(true);
    try {
      await registerItem(projectId, modelId, preview.tsvLine, preview.assignedId);
      onRegistered(preview.assignedId);
      toast({
        title: "Item registered",
        description: `Assigned ID: ${preview.assignedId}`,
      });
    } catch (err) {
      toast({ title: "Registration failed", description: String(err) });
    } finally {
      setRegistering(false);
    }
  }

  if (registeredItemId != null) {
    return (
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          ItemInfo.txt
        </label>
        <div className="text-xs text-green-400 flex items-center gap-1.5">
          <Check className="h-3 w-3" />
          Registered as ID {registeredItemId}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        ItemInfo.txt
      </label>

      {!preview ? (
        <div className="space-y-1.5">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Item ID (optional)
            </label>
            <Input
              value={requestedId}
              onChange={(e) => {
                setRequestedId(e.target.value);
                setIdError(null);
              }}
              placeholder="Auto"
              className={`h-7 text-xs ${idError ? "border-red-500" : ""}`}
              type="number"
              min={1}
            />
            {idError && (
              <p className="text-[10px] text-red-400">{idError}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <FileText className="h-3 w-3 mr-1" />
            )}
            {loading ? "Generating..." : "Generate Entry"}
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            Next ID: <span className="font-mono">{preview.assignedId}</span>
          </div>
          <div className="p-1.5 rounded bg-muted/50 text-[10px] font-mono break-all max-h-20 overflow-auto">
            {preview.tsvLine.substring(0, 200)}...
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleRegister}
            disabled={registering}
          >
            {registering ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <FileText className="h-3 w-3 mr-1" />
            )}
            {registering ? "Registering..." : "Append to ItemInfo.txt"}
          </Button>
        </div>
      )}
    </div>
  );
}
