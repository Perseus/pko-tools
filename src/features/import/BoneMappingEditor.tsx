import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  BoneMapping,
  BoneMappingEntry,
  MappingConfidence,
} from "@/types/import";

const PKO_BONE_OPTIONS = [
  "Bip01",
  "Bip01 Pelvis",
  "Bip01 Spine",
  "Bip01 Spine1",
  "Bip01 Neck",
  "Bip01 Head",
  "Bip01 L Clavicle",
  "Bip01 L UpperArm",
  "Bip01 L Forearm",
  "Bip01 L Hand",
  "Bip01 R Clavicle",
  "Bip01 R UpperArm",
  "Bip01 R Forearm",
  "Bip01 R Hand",
  "Bip01 L Thigh",
  "Bip01 L Calf",
  "Bip01 L Foot",
  "Bip01 L Toe0",
  "Bip01 R Thigh",
  "Bip01 R Calf",
  "Bip01 R Foot",
  "Bip01 R Toe0",
];

function confidenceBadge(confidence: MappingConfidence) {
  switch (confidence) {
    case "Exact":
      return (
        <span className="text-[10px] px-1 rounded bg-green-900/50 text-green-400">
          Exact
        </span>
      );
    case "High":
      return (
        <span className="text-[10px] px-1 rounded bg-green-900/30 text-green-300">
          High
        </span>
      );
    case "Medium":
      return (
        <span className="text-[10px] px-1 rounded bg-yellow-900/30 text-yellow-300">
          Med
        </span>
      );
    case "Low":
      return (
        <span className="text-[10px] px-1 rounded bg-orange-900/30 text-orange-300">
          Low
        </span>
      );
    case "Manual":
      return (
        <span className="text-[10px] px-1 rounded bg-blue-900/30 text-blue-300">
          Manual
        </span>
      );
    case "Unmapped":
      return (
        <span className="text-[10px] px-1 rounded bg-red-900/30 text-red-400">
          --
        </span>
      );
  }
}

function MappingRow({
  entry,
  usedTargets,
  onChangeTarget,
}: {
  entry: BoneMappingEntry;
  usedTargets: Set<string>;
  onChangeTarget: (sourceIndex: number, targetName: string | null) => void;
}) {
  const isUnmapped = entry.confidence === "Unmapped";

  return (
    <div
      className={`flex items-center gap-2 py-1 px-2 rounded text-xs ${
        isUnmapped ? "bg-red-950/20" : "bg-muted/30"
      }`}
    >
      <span className="flex-1 font-mono truncate" title={entry.source_name}>
        {entry.source_name}
      </span>

      <span className="text-muted-foreground">→</span>

      <select
        className="flex-1 h-6 text-xs rounded border border-input bg-background px-1"
        value={entry.target_name ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          onChangeTarget(entry.source_index, val === "" ? null : val);
        }}
      >
        <option value="">-- unmapped --</option>
        {PKO_BONE_OPTIONS.map((name) => {
          const used =
            usedTargets.has(name) && entry.target_name !== name;
          return (
            <option key={name} value={name} disabled={used}>
              {name}
              {used ? " (used)" : ""}
            </option>
          );
        })}
      </select>

      {confidenceBadge(entry.confidence)}
    </div>
  );
}

type BoneMappingEditorProps = {
  mapping: BoneMapping;
  onChangeMapping: (
    sourceIndex: number,
    targetName: string | null
  ) => void;
};

export function BoneMappingEditor({
  mapping,
  onChangeMapping,
}: BoneMappingEditorProps) {
  const usedTargets = new Set(
    mapping.entries
      .filter((e) => e.target_name !== null)
      .map((e) => e.target_name!)
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {mapping.mapped_count} / {mapping.entries.length} mapped
        </span>
        <span>
          Source: {mapping.source_type}
        </span>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground px-2">
        <span className="flex-1">Source Bone</span>
        <span className="w-4" />
        <span className="flex-1">PKO Target</span>
        <span className="w-10" />
      </div>

      <ScrollArea className="h-64 border rounded">
        <div className="space-y-0.5 p-1">
          {mapping.entries.map((entry) => (
            <MappingRow
              key={entry.source_index}
              entry={entry}
              usedTargets={usedTargets}
              onChangeTarget={onChangeMapping}
            />
          ))}
        </div>
      </ScrollArea>

      {mapping.missing_target_count > 0 && (
        <p className="text-xs text-yellow-400">
          {mapping.missing_target_count} PKO bones have no source mapping
        </p>
      )}
    </div>
  );
}
