import { useState } from "react";
import { useAtomValue } from "jotai";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currentProjectAtom } from "@/store/project";
import { useToast } from "@/hooks/use-toast";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";
import {
  decompileItemRefineInfo,
  decompileItemRefineEffectInfo,
  decompileSceneEffectInfo,
  decompileStoneInfo,
} from "@/commands/item";

const TABLES = [
  { label: "ItemRefineInfo", fn: decompileItemRefineInfo },
  { label: "ItemRefineEffectInfo", fn: decompileItemRefineEffectInfo },
  { label: "sceneffectinfo", fn: decompileSceneEffectInfo },
  { label: "StoneInfo", fn: decompileStoneInfo },
] as const;

export function DecompileTablesPanel({ open }: { open: boolean }) {
  const currentProject = useAtomValue(currentProjectAtom);
  const { toast } = useToast();
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  if (!open) return null;

  async function handleDecompile(label: string, fn: (projectId: string) => Promise<{ records_total: number; records_written: number; records_skipped: number; output_path: string }>) {
    const projectId = currentProject?.id;
    if (!projectId) return;

    setLoading((prev) => ({ ...prev, [label]: true }));
    try {
      const result = await fn(projectId);
      toast({
        title: `Decompiled ${label}`,
        description: (
          <div className="flex flex-col gap-1">
            <span>{result.records_written} records written ({result.records_skipped} skipped)</span>
            <button
              onClick={() => revealItemInDir(result.output_path)}
              className="text-xs text-blue-400 hover:text-blue-300 underline text-left cursor-pointer"
            >
              Open in Explorer
            </button>
          </div>
        ),
      });
    } catch (err: unknown) {
      toast({
        title: `Error decompiling ${label}`,
        description: (err as Error).toString(),
        variant: "destructive",
      });
    } finally {
      setLoading((prev) => ({ ...prev, [label]: false }));
    }
  }

  return (
    <Card className="absolute top-4 left-4 w-56 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border shadow-lg z-50">
      <CardHeader className="pb-2 px-3 pt-3">
        <CardTitle className="text-xs font-medium">Decompile Tables</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="flex flex-col gap-1">
          {TABLES.map(({ label, fn }) => (
            <button
              key={label}
              disabled={loading[label] || !currentProject}
              className="text-[11px] px-2 py-1.5 rounded border border-border hover:bg-accent transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              onClick={() => handleDecompile(label, fn)}
            >
              {loading[label] && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
              <span className="font-mono">{label}.bin</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
