import React from "react";
import { useState } from "react";
import { ChevronDown, ChevronRight, Bone, MapPin } from "lucide-react";

export type BoneNode = {
  name: string;
  isDummy: boolean;
  id: number;
  parentBoneId?: number;
  children: BoneNode[];
};

/**
 * Build a tree of bone/dummy nodes from a flat list extracted from a glTF scene.
 * Bones are linked by parent_id, dummies are attached to their parent bone.
 */
export function buildBoneTree(
  bones: { name: string; id: number; parentId: number }[],
  dummies: { name: string; id: number; parentBoneId: number }[],
): BoneNode[] {
  const nodeMap = new Map<number, BoneNode>();

  // Create bone nodes
  for (const b of bones) {
    nodeMap.set(b.id, {
      name: b.name,
      isDummy: false,
      id: b.id,
      children: [],
    });
  }

  // Build hierarchy
  const roots: BoneNode[] = [];
  for (const b of bones) {
    const node = nodeMap.get(b.id)!;
    const parent = nodeMap.get(b.parentId);
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Attach dummies to their parent bones
  for (const d of dummies) {
    const dummyNode: BoneNode = {
      name: d.name,
      isDummy: true,
      id: d.id,
      parentBoneId: d.parentBoneId,
      children: [],
    };
    const parent = nodeMap.get(d.parentBoneId);
    if (parent) {
      parent.children.push(dummyNode);
    } else {
      roots.push(dummyNode);
    }
  }

  return roots;
}

function TreeNode({
  node,
  selectedName,
  onSelect,
  depth,
}: {
  node: BoneNode;
  selectedName: string | null;
  onSelect: (name: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedName === node.name;

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[11px] ${
          isSelected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-muted/50"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(node.name)}
      >
        {hasChildren ? (
          <button
            className="shrink-0 p-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {node.isDummy ? (
          <MapPin className="h-3 w-3 shrink-0 text-amber-500" />
        ) : (
          <Bone className="h-3 w-3 shrink-0 text-blue-400" />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((child, i) => (
          <TreeNode
            key={`${child.name}-${i}`}
            node={child}
            selectedName={selectedName}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export default function BoneTreeView({
  roots,
  selectedName,
  onSelect,
}: {
  roots: BoneNode[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  if (roots.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground">
        No bones found.
      </div>
    );
  }

  return (
    <div className="max-h-60 overflow-y-auto">
      {roots.map((root, i) => (
        <TreeNode
          key={`${root.name}-${i}`}
          node={root}
          selectedName={selectedName}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </div>
  );
}
