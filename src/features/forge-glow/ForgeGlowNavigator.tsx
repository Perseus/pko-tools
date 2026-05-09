import { useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  createForgeGlowDraft,
  deleteForgeGlowDraft,
  listForgeGlowDrafts,
  listForgeGlowGems,
  loadForgeGlowDraft,
} from "@/commands/forge-glow";
import { getItemList } from "@/commands/item";
import { currentProjectAtom } from "@/store/project";
import {
  activeForgeGlowDraftAtom,
  forgeGlowDraftsAtom,
  selectedForgeGlowVariantIdAtom,
} from "@/store/forge-glow";
import type { ForgeGlowGemOption, ForgeRecipeInputs } from "@/types/forge-glow";
import type { Item } from "@/types/item";

const CHAR_TYPES = [
  { value: 0, label: "Lance" },
  { value: 1, label: "Carsise" },
  { value: 2, label: "Phyllis" },
  { value: 3, label: "Ami" },
];

const FORGE_GLOW_WEAPON_ITEM_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 14, 15]);

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function modelIdForCharType(item: Item, charType: number): string {
  if (charType === 1) return item.model_carsise;
  if (charType === 2) return item.model_phyllis;
  if (charType === 3) return item.model_ami;
  return item.model_lance;
}

function hasForgeGlowWeaponModelForChar(item: Item, charType: number): boolean {
  const modelId = modelIdForCharType(item, charType).trim();
  return modelId.length > 0 && modelId !== "0";
}

export function filterForgeGlowWeaponOptions(
  items: Item[],
  query: string,
  charType: number,
): Item[] {
  const lower = query.trim().toLowerCase();
  return items
    .filter(
      (item) =>
        FORGE_GLOW_WEAPON_ITEM_TYPES.has(item.item_type) &&
        hasForgeGlowWeaponModelForChar(item, charType),
    )
    .filter(
      (item) =>
        !lower ||
        item.name.toLowerCase().includes(lower) ||
        String(item.id).includes(lower),
    )
    .slice(0, 24);
}

export function formatGemOption(gem: ForgeGlowGemOption): string {
  return `${gem.itemId} · ${gem.itemName} · type ${gem.stoneType}`;
}

function filterGemOptions(
  options: ForgeGlowGemOption[],
  query: string,
): ForgeGlowGemOption[] {
  const lower = query.trim().toLowerCase();
  if (!lower) return options.slice(0, 12);
  return options
    .filter(
      (gem) =>
        gem.itemName.toLowerCase().includes(lower) ||
        String(gem.itemId).includes(lower) ||
        String(gem.stoneType).includes(lower),
    )
    .slice(0, 12);
}

export default function ForgeGlowNavigator() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [drafts, setDrafts] = useAtom(forgeGlowDraftsAtom);
  const [activeDraft, setActiveDraft] = useAtom(activeForgeGlowDraftAtom);
  const setVariantId = useSetAtom(selectedForgeGlowVariantIdAtom);
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [gemOptions, setGemOptions] = useState<ForgeGlowGemOption[]>([]);
  const [query, setQuery] = useState("");
  const [weaponPickerOpen, setWeaponPickerOpen] = useState(false);
  const [weaponItemId, setWeaponItemId] = useState("");
  const [charType, setCharType] = useState(0);
  const [gems, setGems] = useState([
    { itemId: "", query: "", level: "1" },
    { itemId: "", query: "", level: "1" },
    { itemId: "", query: "", level: "1" },
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
    listForgeGlowGems(currentProject.id)
      .then(setGemOptions)
      .catch(() => setGemOptions([]));
  }, [currentProject?.id]);

  const filteredItems = useMemo(() => {
    return filterForgeGlowWeaponOptions(items, query, charType);
  }, [items, query, charType]);

  useEffect(() => {
    if (!items.length || !weaponItemId) return;
    const selected = items.find((item) => item.id === numberValue(weaponItemId));
    if (!selected || !hasForgeGlowWeaponModelForChar(selected, charType)) {
      setWeaponItemId("");
      setQuery("");
      setWeaponPickerOpen(true);
    }
  }, [charType, items, weaponItemId]);

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
              onFocus={() => setWeaponPickerOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setWeaponItemId("");
                setWeaponPickerOpen(true);
              }}
              placeholder="Choose valid weapon"
            />
            <Button size="icon" variant="outline" className="shrink-0">
              <Search className="h-4 w-4" />
            </Button>
          </div>
          {weaponPickerOpen && filteredItems.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-background">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="grid w-full grid-cols-[64px_1fr_48px] gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setWeaponItemId(String(item.id));
                    setQuery(item.name);
                    setWeaponPickerOpen(false);
                  }}
                >
                  <span className="font-mono text-muted-foreground">{item.id}</span>
                  <span className="truncate">{item.name}</span>
                  <span className="text-right font-mono text-muted-foreground">
                    T{item.item_type}
                  </span>
                </button>
              ))}
            </div>
          )}
          <Input
            value={weaponItemId}
            readOnly
            placeholder="Selected weapon id"
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
          {gems.map((gem, index) => {
            const selectedGem = gemOptions.find(
              (option) => String(option.itemId) === gem.itemId,
            );

            return (
              <div key={index} className="grid grid-cols-[1fr_64px] gap-2">
                <div className="min-w-0 space-y-1">
                  <Input
                    value={gem.query}
                    onChange={(event) => {
                      const nextQuery = event.target.value;
                      const exact = gemOptions.find(
                        (option) =>
                          String(option.itemId) === nextQuery.trim() ||
                          formatGemOption(option) === nextQuery,
                      );
                      setGems((current) =>
                        current.map((entry, idx) =>
                          idx === index
                            ? {
                                ...entry,
                                itemId: exact ? String(exact.itemId) : "",
                                query: nextQuery,
                              }
                            : entry,
                        ),
                      );
                    }}
                    placeholder={`Search gem ${index + 1}`}
                  />
                  {selectedGem && (
                    <div className="grid grid-cols-[56px_1fr_48px] gap-2 rounded-md bg-muted px-2 py-1 text-xs">
                      <span className="font-mono text-muted-foreground">
                        {selectedGem.itemId}
                      </span>
                      <span className="truncate font-medium">{selectedGem.itemName}</span>
                      <span className="text-right font-mono text-muted-foreground">
                        T{selectedGem.stoneType}
                      </span>
                    </div>
                  )}
                  {gem.query.trim() && !gem.itemId && (
                    <div className="max-h-36 overflow-y-auto rounded-md border border-border bg-background">
                      {filterGemOptions(gemOptions, gem.query).map((option) => (
                        <button
                          key={option.itemId}
                          type="button"
                          className="grid w-full grid-cols-[56px_1fr_48px] gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted"
                          onClick={() =>
                            setGems((current) =>
                              current.map((entry, idx) =>
                                idx === index
                                  ? {
                                      ...entry,
                                      itemId: String(option.itemId),
                                      query: formatGemOption(option),
                                    }
                                  : entry,
                              ),
                            )
                          }
                        >
                          <span className="font-mono text-muted-foreground">
                            {option.itemId}
                          </span>
                          <span className="truncate">{option.itemName}</span>
                          <span className="text-right font-mono text-muted-foreground">
                            T{option.stoneType}
                          </span>
                        </button>
                      ))}
                      {filterGemOptions(gemOptions, gem.query).length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No gem found.
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
            );
          })}
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
