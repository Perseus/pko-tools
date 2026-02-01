import { Input } from "@/components/ui/input";
import { listTextureFiles } from "@/commands/effect";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function TextureBrowser() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const currentProject = useAtomValue(currentProjectAtom);
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);

  const currentTexName = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) return "";
    return effectData.subEffects[selectedSubEffectIndex]?.texName ?? "";
  }, [effectData, selectedSubEffectIndex]);

  useEffect(() => {
    if (!isExpanded || !currentProject) return;
    setLoading(true);
    listTextureFiles(currentProject.id)
      .then((result) => {
        setFiles(result);
      })
      .catch(() => {
        setFiles([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isExpanded, currentProject]);

  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, search]);

  const selectTexture = useCallback(
    (filePath: string) => {
      if (!effectData || selectedSubEffectIndex === null) return;

      // Extract just the filename without path and extension
      const parts = filePath.split("/");
      const fileName = parts[parts.length - 1];
      const baseName = fileName.replace(/\.(tga|dds|bmp|png)$/i, "");

      const nextSubEffects = effectData.subEffects.map((se, i) =>
        i === selectedSubEffectIndex ? { ...se, texName: baseName } : se,
      );
      setEffectData({ ...effectData, subEffects: nextSubEffects });
      setDirty(true);
    },
    [effectData, selectedSubEffectIndex, setEffectData, setDirty],
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
        Texture Browser
        {files.length > 0 && (
          <span className="text-[10px] font-normal text-muted-foreground">
            ({files.length})
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="space-y-2 px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search textures..."
              className="h-7 pl-7 text-xs"
              aria-label="texture-search"
            />
          </div>
          {loading && (
            <div className="text-center text-xs text-muted-foreground">Loading...</div>
          )}
          <div
            className="max-h-60 overflow-y-auto space-y-0.5"
            role="listbox"
            aria-label="texture-list"
          >
            {filtered.map((file) => {
              const parts = file.split("/");
              const fileName = parts[parts.length - 1];
              const baseName = fileName.replace(/\.(tga|dds|bmp|png)$/i, "");
              const isSelected = currentTexName === baseName;
              return (
                <button
                  key={file}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10px] transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50 text-muted-foreground"
                  }`}
                  onClick={() => selectTexture(file)}
                >
                  <span className="flex-1 truncate">{fileName}</span>
                  <span className="shrink-0 text-[8px] text-muted-foreground/50">
                    {parts.slice(0, -1).join("/")}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && !loading && (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {files.length === 0
                  ? "No texture files found in project."
                  : "No matches found."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
