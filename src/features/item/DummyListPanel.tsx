import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkbenchDummy, DUMMY_PRESETS } from "@/types/item";
import { Plus, Crosshair, Trash2, Package, Move } from "lucide-react";
import { useAtom } from "jotai";
import { editingDummyAtom, dummyPlacementModeAtom } from "@/store/workbench";

interface DummyListPanelProps {
  dummies: WorkbenchDummy[];
  itemType: number;
  onDummiesChange: (dummies: WorkbenchDummy[]) => void;
}

export function DummyListPanel({
  dummies,
  itemType,
  onDummiesChange,
}: DummyListPanelProps) {
  const [editingDummy, setEditingDummy] = useAtom(editingDummyAtom);
  const [placementMode, setPlacementMode] = useAtom(dummyPlacementModeAtom);

  function addDummy() {
    const nextId = dummies.length > 0 ? Math.max(...dummies.map((d) => d.id)) + 1 : 0;
    const newDummy: WorkbenchDummy = {
      id: nextId,
      label: `Dummy ${nextId}`,
      position: [0, 0, 0],
    };
    onDummiesChange([...dummies, newDummy]);
    setEditingDummy(nextId);
  }

  function addPresets() {
    const presets = DUMMY_PRESETS[itemType];
    if (!presets) return;

    const startId = dummies.length > 0 ? Math.max(...dummies.map((d) => d.id)) + 1 : 0;
    const newDummies: WorkbenchDummy[] = presets.map((p, i) => ({
      id: startId + i,
      label: p.label,
      position: [...p.position] as [number, number, number],
    }));
    onDummiesChange([...dummies, ...newDummies]);
  }

  function relocateDummy(id: number) {
    setEditingDummy(id);
    setPlacementMode(true);
  }

  function removeDummy(id: number) {
    onDummiesChange(dummies.filter((d) => d.id !== id));
    if (editingDummy === id) setEditingDummy(null);
  }

  function updateDummy(id: number, updates: Partial<WorkbenchDummy>) {
    onDummiesChange(
      dummies.map((d) => (d.id === id ? { ...d, ...updates } : d))
    );
  }

  function updatePosition(id: number, axis: 0 | 1 | 2, value: number) {
    const dummy = dummies.find((d) => d.id === id);
    if (!dummy) return;
    const newPos = [...dummy.position] as [number, number, number];
    newPos[axis] = value;
    updateDummy(id, { position: newPos });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Dummies ({dummies.length})
        </label>
        <div className="flex gap-1">
          <Button
            variant={placementMode ? "default" : "ghost"}
            size="sm"
            className="h-6 px-1.5"
            onClick={() => setPlacementMode(!placementMode)}
            title="Click-to-place mode"
          >
            <Crosshair className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex gap-1">
        <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={addDummy}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
        {DUMMY_PRESETS[itemType] && (
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={addPresets}>
            <Package className="h-3 w-3 mr-1" /> Presets
          </Button>
        )}
      </div>

      {dummies.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No dummies. Add one or use presets for this item type.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-auto">
          {dummies.map((dummy) => (
            <div
              key={dummy.id}
              className={`rounded border p-1.5 text-xs space-y-1 cursor-pointer transition-colors ${
                editingDummy === dummy.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
              onClick={() => setEditingDummy(editingDummy === dummy.id ? null : dummy.id)}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-muted-foreground w-4">
                  {dummy.id}
                </span>
                <Input
                  value={dummy.label}
                  onChange={(e) => updateDummy(dummy.id, { label: e.target.value })}
                  className="h-5 text-xs flex-1 px-1"
                  onClick={(e) => e.stopPropagation()}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  title="Click on model to relocate"
                  onClick={(e) => {
                    e.stopPropagation();
                    relocateDummy(dummy.id);
                  }}
                >
                  <Move className="h-3 w-3 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDummy(dummy.id);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
              {editingDummy === dummy.id && (
                <div className="flex gap-1 items-center">
                  {(["X", "Y", "Z"] as const).map((label, axis) => (
                    <div key={label} className="flex items-center gap-0.5">
                      <span className="text-muted-foreground w-3">{label}</span>
                      <Input
                        type="number"
                        step={0.1}
                        value={dummy.position[axis]}
                        onChange={(e) =>
                          updatePosition(dummy.id, axis as 0 | 1 | 2, parseFloat(e.target.value) || 0)
                        }
                        className="h-5 text-xs w-16 px-1 font-mono"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
