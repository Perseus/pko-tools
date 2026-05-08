import { useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { createForgeGlowDraft, deleteForgeGlowDraft, listForgeGlowDrafts, loadForgeGlowDraft } from "@/commands/forge-glow";
import { getItemList } from "@/commands/item";
import { currentProjectAtom } from "@/store/project";
import {
  activeForgeGlowDraftAtom,
  forgeGlowDraftsAtom,
  selectedForgeGlowVariantIdAtom,
} from "@/store/forge-glow";
import type { ForgeRecipeInputs } from "@/types/forge-glow";
import type { Item } from "@/types/item";

const CHAR_TYPES = [
  { value: 0, label: "Lance" },
  { value: 1, label: "Carsise" },
  { value: 2, label: "Phyllis" },
  { value: 3, label: "Ami" },
];

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ForgeGlowNavigator() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [drafts, setDrafts] = useAtom(forgeGlowDraftsAtom);
  const [activeDraft, setActiveDraft] = useAtom(activeForgeGlowDraftAtom);
  const setVariantId = useSetAtom(selectedForgeGlowVariantIdAtom);
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [weaponItemId, setWeaponItemId] = useState("");
  const [charType, setCharType] = useState(0);
  const [gems, setGems] = useState([
    { itemId: "", level: "1" },
    { itemId: "", level: "1" },
    { itemId: "", level: "1" },
  ]);
  const [creating, setCreating] = useState(false);

  const refreshDrafts = async () => {
    if (!currentProject) return;
    const nextDrafts = await listForgeGlowDrafts(currentProject.id);
    setDrafts(nextDrafts);
  };

  useEffect(() => {
    if (!currentProject) return;
    refreshDrafts().catch(() => setDrafts([]));
    getItemList(currentProject.id).then(setItems).catch(() => setItems([]));
  }, [currentProject?.id]);

  const filteredItems = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return [];
    return items
      .filter(
        (item) =>
          item.name.toLowerCase().includes(lower) ||
          String(item.id).includes(lower),
      )
      .slice(0, 12);
  }, [items, query]);

  async function createDraft() {
    if (!currentProject) return;
    const itemId = numberValue(weaponItemId);
    if (!itemId) {
      toast({ title: "Weapon item id required" });
      return;
    }

    const inputs: ForgeRecipeInputs = {
      weaponItemId: itemId,
      charType,
      gems: gems.map((gem) => ({
        itemId: numberValue(gem.itemId),
        level: numberValue(gem.level),
      })),
    };

    setCreating(true);
    try {
      const draft = await createForgeGlowDraft(
        currentProject.id,
        `Forge glow ${itemId}`,
        inputs,
      );
      setActiveDraft(draft);
      setVariantId(draft.activeVariantId);
      await refreshDrafts();
      toast({ title: "Forge glow draft created" });
    } catch (err) {
      toast({ title: "Draft creation failed", description: String(err) });
    } finally {
      setCreating(false);
    }
  }

  async function openDraft(draftId: string) {
    if (!currentProject) return;
    try {
      const draft = await loadForgeGlowDraft(currentProject.id, draftId);
      setActiveDraft(draft);
      setVariantId(draft.activeVariantId);
    } catch (err) {
      toast({ title: "Could not load draft", description: String(err) });
    }
  }

  async function removeDraft(draftId: string) {
    if (!currentProject) return;
    try {
      await deleteForgeGlowDraft(currentProject.id, draftId);
      if (activeDraft?.id === draftId) setActiveDraft(null);
      await refreshDrafts();
    } catch (err) {
      toast({ title: "Could not delete draft", description: String(err) });
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="space-y-1">
        <div className="text-sm font-semibold">Forge Glow Bench</div>
        <div className="text-xs text-muted-foreground">{currentProject?.name}</div>
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            New Draft
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void refreshDrafts()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="forge-glow-search">Weapon</Label>
          <div className="flex gap-2">
            <Input
              id="forge-glow-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search id or name"
            />
            <Button size="icon" variant="outline" className="shrink-0">
              <Search className="h-4 w-4" />
            </Button>
          </div>
          {filteredItems.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-background">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="grid w-full grid-cols-[64px_1fr] gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setWeaponItemId(String(item.id));
                    setQuery(item.name);
                  }}
                >
                  <span className="font-mono text-muted-foreground">{item.id}</span>
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </div>
          )}
          <Input
            value={weaponItemId}
            onChange={(event) => setWeaponItemId(event.target.value)}
            placeholder="Weapon item id"
            inputMode="numeric"
          />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {CHAR_TYPES.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={charType === option.value ? "secondary" : "ghost"}
              className="h-7 text-xs"
              onClick={() => setCharType(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Gems</div>
          {gems.map((gem, index) => (
            <div key={index} className="grid grid-cols-[1fr_64px] gap-2">
              <Input
                value={gem.itemId}
                onChange={(event) =>
                  setGems((current) =>
                    current.map((entry, idx) =>
                      idx === index ? { ...entry, itemId: event.target.value } : entry,
                    ),
                  )
                }
                placeholder={`Gem ${index + 1} item id`}
                inputMode="numeric"
              />
              <Input
                value={gem.level}
                onChange={(event) =>
                  setGems((current) =>
                    current.map((entry, idx) =>
                      idx === index ? { ...entry, level: event.target.value } : entry,
                    ),
                  )
                }
                inputMode="numeric"
              />
            </div>
          ))}
        </div>

        <Button className="w-full gap-2" onClick={createDraft} disabled={creating}>
          <Plus className="h-4 w-4" />
          {creating ? "Creating" : "Create Draft"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          Drafts
        </div>
        <ScrollArea className="h-full pr-2">
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="rounded-md border border-border bg-background p-2"
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => void openDraft(draft.id)}
                >
                  <div className="truncate text-sm font-medium">{draft.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {draft.weaponName} · {draft.variantCount} variants
                  </div>
                </button>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => void removeDraft(draft.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
