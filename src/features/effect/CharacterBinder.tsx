import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { effectBindingAtom } from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { Loader2, Unlink, X } from "lucide-react";
import React from "react";
import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import BoneTreeView, { buildBoneTree, type BoneNode } from "@/features/effect/BoneTreeView";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SmallLabel } from "@/features/effect/HelpTip";

/**
 * Extract bones and dummies from a glTF JSON object.
 * Looks for nodes with extras.bone_id (bones) or extras.dummy (dummy nodes).
 */
function extractBonesFromGltf(gltfJson: Record<string, unknown>): {
  bones: { name: string; id: number; parentId: number }[];
  dummies: { name: string; id: number; parentBoneId: number }[];
} {
  const nodes = (gltfJson.nodes ?? []) as Array<{
    name?: string;
    children?: number[];
    extras?: Record<string, unknown>;
  }>;

  const bones: { name: string; id: number; parentId: number }[] = [];
  const dummies: { name: string; id: number; parentBoneId: number }[] = [];

  // Build parent map from children arrays
  const parentMap = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    const children = nodes[i].children;
    if (children) {
      for (const childIdx of children) {
        parentMap.set(childIdx, i);
      }
    }
  }

  // Map glTF node index -> bone_id for bones
  const nodeIndexToBoneId = new Map<number, number>();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const extras = node.extras;
    if (!extras) continue;

    if (typeof extras.bone_id === "number") {
      const boneId = extras.bone_id;
      nodeIndexToBoneId.set(i, boneId);

      // Find parent bone_id
      const parentNodeIdx = parentMap.get(i);
      let parentBoneId = boneId; // self-parent = root
      if (parentNodeIdx !== undefined) {
        const parentNode = nodes[parentNodeIdx];
        if (parentNode?.extras && typeof parentNode.extras.bone_id === "number") {
          parentBoneId = parentNode.extras.bone_id;
        }
      }

      bones.push({
        name: node.name ?? `Bone_${boneId}`,
        id: boneId,
        parentId: parentBoneId,
      });
    } else if (extras.dummy === true) {
      const id = typeof extras.id === "number" ? extras.id : 0;
      const parentBoneId = typeof extras.parent_bone_id === "number" ? extras.parent_bone_id : 0;
      dummies.push({
        name: node.name ?? `dummy_${id}`,
        id,
        parentBoneId,
      });
    }
  }

  return { bones, dummies };
}

export default function CharacterBinder() {
  const [binding, setBinding] = useAtom(effectBindingAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [charIdInput, setCharIdInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [gltfParsed, setGltfParsed] = useState<Record<string, unknown> | null>(null);

  const boneTree = useMemo((): BoneNode[] => {
    if (!gltfParsed) return [];
    const { bones, dummies } = extractBonesFromGltf(gltfParsed);
    if (binding.mode === "bones") return buildBoneTree(bones, []);
    if (binding.mode === "dummies") return buildBoneTree([], dummies);
    return buildBoneTree(bones, dummies);
  }, [gltfParsed, binding.mode]);

  const handleLoad = useCallback(async () => {
    if (!currentProject) return;
    const id = Number(charIdInput.trim());
    if (Number.isNaN(id) || id <= 0) return;

    setBinding((prev) => ({ ...prev, status: "loading", characterId: id }));

    try {
      const gltfJson = await invoke<string>("load_character", {
        projectId: currentProject.id,
        characterId: id,
      });

      const parsed = JSON.parse(gltfJson) as Record<string, unknown>;
      setGltfParsed(parsed);

      // Create data URI for Three.js rendering
      const dataUri = `data:model/gltf+json;base64,${btoa(gltfJson)}`;
      setBinding((prev) => ({
        ...prev,
        characterId: id,
        gltfDataUri: dataUri,
        boundBoneName: null,
        status: "loaded",
      }));
    } catch {
      setBinding((prev) => ({ ...prev, status: "error" }));
    }
  }, [currentProject, charIdInput, setBinding]);

  const handleUnbind = useCallback(() => {
    setBinding((prev) => ({
      ...prev,
      characterId: null,
      gltfDataUri: null,
      boundBoneName: null,
      status: "idle",
    }));
    setGltfParsed(null);
  }, [setBinding]);

  const handleBoneSelect = useCallback(
    (name: string) => {
      setBinding((prev) => ({
        ...prev,
        boundBoneName: prev.boundBoneName === name ? null : name,
      }));
    },
    [setBinding],
  );

  return (
    <div className="rounded-xl border border-border bg-background/70">
      <button
        className="flex w-full items-center gap-2 p-3 text-left text-sm font-semibold"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Skeleton Binding
        {binding.boundBoneName && (
          <span className="text-[10px] font-normal text-blue-400">
            {binding.boundBoneName}
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="space-y-2 px-3 pb-3">
          <div className="text-[9px] text-muted-foreground">
            Preview how an effect looks attached to a character skeleton. Load a character by ID, then click a bone or dummy node to bind.
          </div>
          {binding.status === "idle" || binding.status === "error" ? (
            <>
              <div className="space-y-1">
                <SmallLabel help="4-digit character model ID from CharacterInfo.txt. The first 4 digits of a .lgo filename. E.g. 725 = NPC model 725.">
                  Character ID
                </SmallLabel>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    min={1}
                    value={charIdInput}
                    onChange={(e) => setCharIdInput(e.target.value)}
                    placeholder="e.g. 725"
                    className="h-7 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLoad();
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-xs"
                    onClick={handleLoad}
                    disabled={!currentProject}
                  >
                    Load
                  </Button>
                </div>
              </div>
              {binding.status === "error" && (
                <div className="text-[10px] text-destructive">
                  Failed to load character. Check the ID and project.
                </div>
              )}
            </>
          ) : binding.status === "loading" ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading character...
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">
                  Character #{binding.characterId}
                </div>
                <div className="flex items-center gap-1">
                  {binding.boundBoneName && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1 text-[10px]"
                      onClick={() =>
                        setBinding((prev) => ({ ...prev, boundBoneName: null }))
                      }
                    >
                      <Unlink className="mr-1 h-3 w-3" />
                      Unbind
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0"
                    onClick={handleUnbind}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {binding.boundBoneName && (
                <div className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-400">
                  Bound to: {binding.boundBoneName}
                </div>
              )}
              <div className="flex items-center gap-1">
                {(["all", "bones", "dummies"] as const).map((m) => (
                  <button
                    key={m}
                    className={`rounded px-2 py-0.5 text-[10px] ${
                      binding.mode === m
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                    onClick={() =>
                      setBinding((prev) => ({ ...prev, mode: m }))
                    }
                  >
                    {m === "all" ? "All" : m === "bones" ? "Bones" : "Dummies"}
                  </button>
                ))}
              </div>
              <BoneTreeView
                roots={boneTree}
                selectedName={binding.boundBoneName}
                onSelect={handleBoneSelect}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
