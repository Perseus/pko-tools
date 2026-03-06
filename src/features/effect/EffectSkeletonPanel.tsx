import React, { useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, CircleDot, Layers } from "lucide-react";
import {
  effectDataAtom,
  effectPlaybackAtom,
  selectedEffectAtom,
  selectedEffectSkeletonNodeAtom,
} from "@/store/effect";
import {
  buildEffectSkeletonGraph,
  type EffectSkeletonEffectNode,
  type EffectSkeletonNode,
  type EffectSkeletonSubEffectNode,
} from "@/features/effect/effectSkeleton";

function formatVec3(value: [number, number, number]): string {
  return value.map((part) => part.toFixed(2)).join(", ");
}

function formatEulerDegrees(value: [number, number, number]): string {
  return value.map((part) => `${(part * 180 / Math.PI).toFixed(1)}°`).join(", ");
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all text-foreground/90">{value}</span>
    </div>
  );
}

function SkeletonTreeNode({
  nodeId,
  nodes,
  selectedNodeId,
  onSelect,
}: {
  nodeId: string;
  nodes: Record<string, EffectSkeletonNode>;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const node = nodes[nodeId];
  const [expanded, setExpanded] = useState(node.depth < 2);
  const hasChildren = node.childrenIds.length > 0;
  const isSelected = node.id === selectedNodeId;

  return (
    <div>
      <button
        type="button"
        className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] ${
          isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
        }`}
        style={{ paddingLeft: `${node.depth * 12 + 6}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <span
            className="flex h-3 w-3 shrink-0 items-center justify-center"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {node.kind === "effect" ? (
          <Layers className="h-3 w-3 shrink-0 text-sky-400" />
        ) : (
          <CircleDot className="h-3 w-3 shrink-0 text-amber-400" />
        )}
        <span className="truncate">{node.label}</span>
        {node.kind === "subEffect" && (
          <span className="truncate text-[9px] text-muted-foreground">
            {node.geometryLabel}
          </span>
        )}
      </button>
      {expanded && hasChildren && node.childrenIds.map((childId) => (
        <SkeletonTreeNode
          key={childId}
          nodeId={childId}
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function EffectNodeDetails({ node }: { node: EffectSkeletonEffectNode }) {
  return (
    <div className="space-y-2">
      <Row label="Type" value="Effect" />
      <Row label="Name" value={node.effectName} />
      <Row label="Technique" value={node.techniqueIndex} />
      <Row label="Sub-effects" value={node.subEffectCount} />
      <Row label="Rotating" value={node.rotating ? "Yes" : "No"} />
      <Row label="Local Pos" value={formatVec3(node.localPosition)} />
      <Row label="Local Rot" value={formatEulerDegrees(node.localRotation)} />
      <Row label="World Pos" value={formatVec3(node.worldPosition)} />
      <Row label="World Rot" value={formatEulerDegrees(node.worldRotation)} />
    </div>
  );
}

function SubEffectNodeDetails({
  node,
  parent,
}: {
  node: EffectSkeletonSubEffectNode;
  parent: EffectSkeletonNode | null;
}) {
  return (
    <div className="space-y-2">
      <Row label="Type" value={`Sub-effect #${node.subEffectIndex + 1} (${node.effectType})`} />
      <Row label="Name" value={node.effectName || `Sub-effect ${node.subEffectIndex + 1}`} />
      <Row label="Parent" value={parent?.label ?? "(root)"} />
      <Row label="Geometry" value={node.geometryLabel} />
      <Row label="Duration" value={`${node.duration.toFixed(2)}s`} />
      <Row label="Texture" value={node.textureName || "(none)"} />
      <Row label="Model" value={node.modelName || "(builtin / none)"} />
      <Row label="Local Pos" value={formatVec3(node.localPosition)} />
      <Row label="Local Rot" value={formatEulerDegrees(node.localRotation)} />
      <Row label="Local Scale" value={formatVec3(node.localScale)} />
      <Row label="World Pos" value={formatVec3(node.worldPosition)} />
      <Row label="World Rot" value={formatEulerDegrees(node.worldRotation)} />
      <Row label="World Scale" value={formatVec3(node.worldScale)} />
      <Row label="Flags" value={node.flags.length > 0 ? node.flags.join(", ") : "(none)"} />
      {(node.flags.includes("billboard") || node.flags.includes("rotaBoard")) && (
        <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
          Billboarded layers face the camera at render time, so the skeleton view shows their authored rotation, not the final camera-facing rotation.
        </div>
      )}
    </div>
  );
}

export default function EffectSkeletonPanel() {
  const effectData = useAtomValue(effectDataAtom);
  const selectedEffect = useAtomValue(selectedEffectAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const [selectedNodeId, setSelectedNodeId] = useAtom(selectedEffectSkeletonNodeAtom);

  const graph = useMemo(() => {
    if (!effectData) {
      return null;
    }

    return buildEffectSkeletonGraph({
      effectFile: effectData,
      effectName: selectedEffect ?? "Current effect",
      currentTime: playback.currentTime,
      isLooping: playback.isLooping,
    });
  }, [effectData, playback.currentTime, playback.isLooping, selectedEffect]);

  useEffect(() => {
    if (!graph) {
      return;
    }
    if (!selectedNodeId || !graph.nodes[selectedNodeId]) {
      setSelectedNodeId(graph.rootId);
    }
  }, [graph, selectedNodeId, setSelectedNodeId]);

  if (!graph) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No effect loaded.
      </div>
    );
  }

  const selectedNode = graph.nodes[selectedNodeId ?? graph.rootId] ?? graph.nodes[graph.rootId];
  const parentNode = selectedNode.parentId ? graph.nodes[selectedNode.parentId] ?? null : null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border px-3 py-2">
        <div className="text-[11px] font-semibold">Effect Skeleton</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          Click nodes in the tree or viewport to inspect the current effect's authored local transforms and composed world transforms.
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2 text-[11px] font-semibold">
          Hierarchy
        </div>
        <div className="max-h-[320px] overflow-y-auto px-2 py-2">
          <SkeletonTreeNode
            nodeId={graph.rootId}
            nodes={graph.nodes}
            selectedNodeId={selectedNode.id}
            onSelect={setSelectedNodeId}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border px-3 py-2">
        <div className="text-[11px] font-semibold">Selected Node</div>
        <div className="mb-2 mt-0.5 text-[10px] text-muted-foreground">
          {selectedNode.label}
        </div>
        {selectedNode.kind === "effect" ? (
          <EffectNodeDetails node={selectedNode} />
        ) : (
          <SubEffectNodeDetails node={selectedNode} parent={parentNode} />
        )}
      </div>
    </div>
  );
}
