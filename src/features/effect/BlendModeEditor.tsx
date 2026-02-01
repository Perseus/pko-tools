import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel, SmallLabel } from "@/features/effect/HelpTip";
import React from "react";

/**
 * D3DBLEND alpha type presets from the original PKO Effect Editor.
 * Values are D3DBLEND enum indices (D3D8):
 *   1=ZERO, 2=ONE, 3=SRCCOLOR, 4=INVSRCCOLOR, 5=SRCALPHA, 6=INVSRCALPHA
 */
const BLEND_PRESETS = [
  { name: "Normal", src: 5, dest: 6, tip: "Standard alpha transparency. Transparent areas show through." },
  { name: "Additive", src: 5, dest: 2, tip: "Adds to background. Creates glow/light effects." },
  { name: "Strong", src: 2, dest: 2, tip: "Intense additive. Very bright glow effect." },
  { name: "Color", src: 1, dest: 3, tip: "Multiplies with background color. Tints the scene." },
  { name: "Dark", src: 1, dest: 4, tip: "Inverts and multiplies. Darkening effect." },
  { name: "Subtractive", src: 1, dest: 6, tip: "Subtracts from background. Removes light." },
] as const;

type Props = {
  srcBlend: number;
  destBlend: number;
  onChange: (srcBlend: number, destBlend: number) => void;
};

export default function BlendModeEditor({ srcBlend, destBlend, onChange }: Props) {
  const activePreset = BLEND_PRESETS.find((p) => p.src === srcBlend && p.dest === destBlend);

  return (
    <div className="space-y-2">
      <FieldLabel help="Controls how this layer blends with the scene. Presets use D3D blend factors.">
        Blend Mode
      </FieldLabel>
      <div className="flex flex-wrap gap-1">
        {BLEND_PRESETS.map((preset) => (
          <Button
            key={preset.name}
            size="sm"
            variant={activePreset?.name === preset.name ? "default" : "outline"}
            className="h-6 px-2 text-[10px]"
            title={preset.tip}
            onClick={() => onChange(preset.src, preset.dest)}
          >
            {preset.name}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <SmallLabel help="Source blend factor (D3DBLEND). 1=Zero 2=One 3=SrcColor 4=InvSrcColor 5=SrcAlpha 6=InvSrcAlpha 7=DestAlpha 8=InvDestAlpha 9=DestColor 10=InvDestColor 11=SrcAlphaSat">
            Src
          </SmallLabel>
          <Input
            type="number"
            min={1}
            max={11}
            value={srcBlend}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) onChange(v, destBlend);
            }}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <SmallLabel help="Destination blend factor (D3DBLEND). Same values as Src. Common: 2=One (additive), 6=InvSrcAlpha (normal alpha).">
            Dest
          </SmallLabel>
          <Input
            type="number"
            min={1}
            max={11}
            value={destBlend}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) onChange(srcBlend, v);
            }}
            className="h-7 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
