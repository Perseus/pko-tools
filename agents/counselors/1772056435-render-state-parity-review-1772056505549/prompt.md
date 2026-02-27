# Review Request: Render State Parity Pipeline

## Question
Review the Render State Parity Pipeline implementation across 3 phases. Focus on:
1. **Shader correctness** — Are the property-driven blend modes in TOP_Effect.shader correct for URP? Is the CBUFFER layout SRP-Batcher compatible? Are there any issues with the DepthOnly pass?
2. **Suffix parsing robustness** in TOPMaterialReplacer.cs — Any edge cases missed in TryParsePkoSuffix? Could texture names containing "__PKO_T" cause false positives? Is the parsing order (structured suffix → legacy suffix → terrain → default) correct?
3. **Rust exporter logic** — Is the type canonicalization (6-8→1) correct? Is the suffix generation correct for all opacity/alpha_ref values? Are the D3D blend constants correct?
4. **Visual regressions** — Changing alpha mode for additive+alpha-test from Opaque to Mask: could glTFast or Unity handle Mask differently for transparent-queue materials? Any sorting issues?

## Context

### PKO Engine Blend Mode Reference (lwResourceMgr.cpp:2087-2109)

| transp_type | Name | SrcBlend | DestBlend |
|-------------|------|----------|-----------|
| 0 | FILTER | (no blend) | (no blend) |
| 1 | ADDITIVE | ONE | ONE |
| 2 | ADDITIVE1 | SRCCOLOR | ONE |
| 3 | ADDITIVE2 | SRCCOLOR | INVSRCCOLOR |
| 4 | ADDITIVE3 | SRCALPHA | DESTALPHA |
| 5 | SUBTRACTIVE | ZERO | INVSRCCOLOR |
| 6-8 | (fall-through) | ONE | ONE |

**Opacity interaction** (lines 2114-2148): When opacity != 1.0:
- Engine sets ZWrite Off for ALL types
- If transp_type == 1 (ADDITIVE only): overrides SrcBlend from ONE → SRCALPHA

### File 1: TOP_Effect.shader (Unity URP shader)

```hlsl
Shader "TOP/Effect"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend ("Src Blend", Float) = 1  // One
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Dst Blend", Float) = 1  // One
        [Toggle] _ZWrite ("Z Write", Float) = 0
        _Opacity ("Opacity", Range(0, 1)) = 1.0
        [Toggle] _SharpSparkleAB ("Sharp Sparkle A/B", Float) = 0
        _SharpAlphaClip ("Sharp Alpha Clip", Range(0, 1)) = 0.22
        [Toggle(_ALPHATEST_ON)] _AlphaTest ("Alpha Test", Float) = 0
        _Cutoff ("Alpha Cutoff", Range(0,1)) = 0.5
        [Enum(Off,0,Front,1,Back,2)] _Cull ("Cull", Float) = 0
    }
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent" }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            Cull [_Cull]

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _ALPHATEST_ON
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct appdata
            {
                float4 pos : POSITION;
                float2 uv : TEXCOORD0;
                float4 color : COLOR;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float4 vertColor : COLOR0;
            };

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float _Opacity;
                float _Cutoff;
                float _SharpSparkleAB;
                float _SharpAlphaClip;
            CBUFFER_END

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = TransformObjectToHClip(v.pos.xyz);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.vertColor = v.color;
                return o;
            }

            float4 frag(v2f i) : SV_Target
            {
                float4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                float4 result = tex * i.vertColor;
                result.a *= _Opacity;

                #ifdef _ALPHATEST_ON
                    clip(result.a - _Cutoff);
                #else
                    float clipThreshold = _SharpSparkleAB > 0.5 ? _SharpAlphaClip : 0.004;
                    clip(result.a - clipThreshold);
                #endif

                return result;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }

            ZWrite [_ZWrite]
            ColorMask 0
            Cull [_Cull]

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _ALPHATEST_ON
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct appdata { float4 pos : POSITION; float2 uv : TEXCOORD0; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float _Opacity;
                float _Cutoff;
                float _SharpSparkleAB;
                float _SharpAlphaClip;
            CBUFFER_END

            v2f vert(appdata v) { v2f o; o.pos = TransformObjectToHClip(v.pos.xyz); o.uv = TRANSFORM_TEX(v.uv, _MainTex); return o; }

            float4 frag(v2f i) : SV_Target
            {
                #ifdef _ALPHATEST_ON
                    float4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                    float alpha = tex.a * _Opacity;
                    clip(alpha - _Cutoff);
                #endif
                return 0;
            }
            ENDHLSL
        }
    }
}
```

### File 2: TOPMaterialReplacer.cs (key changes only)

```csharp
// New suffix parsing
public static bool TryParsePkoSuffix(string matName, out int transpType, out int alphaRef, out int opacityByte)
{
    transpType = -1; alphaRef = 0; opacityByte = 255;
    if (string.IsNullOrEmpty(matName)) return false;

    int idx = matName.IndexOf("__PKO_T");
    if (idx < 0) return false;

    string suffix = matName.Substring(idx + "__PKO_T".Length);
    int aIdx = suffix.IndexOf("_A");
    if (aIdx < 0) return false;
    string tStr = suffix.Substring(0, aIdx);
    if (!int.TryParse(tStr, out transpType)) return false;

    string afterA = suffix.Substring(aIdx + 2);
    int oIdx = afterA.IndexOf("_O");
    if (oIdx < 0) return false;
    string aStr = afterA.Substring(0, oIdx);
    if (!int.TryParse(aStr, out alphaRef)) return false;

    string oStr = afterA.Substring(oIdx + 2);
    if (!int.TryParse(oStr, out opacityByte)) return false;

    return transpType >= 0 && transpType <= 8
        && alphaRef >= 0 && alphaRef <= 255
        && opacityByte >= 0 && opacityByte <= 255;
}

// Blend mode mapping
public static (BlendMode src, BlendMode dst) GetBlendForTranspType(int transpType)
{
    return transpType switch
    {
        1 => (BlendMode.One, BlendMode.One),
        2 => (BlendMode.SrcColor, BlendMode.One),
        3 => (BlendMode.SrcColor, BlendMode.OneMinusSrcColor),
        4 => (BlendMode.SrcAlpha, BlendMode.DstAlpha),
        5 => (BlendMode.Zero, BlendMode.OneMinusSrcColor),
        _ => (BlendMode.One, BlendMode.One),
    };
}

// Effect material creation
static Material GetOrCreateEffectMaterial(Texture tex, int transpType, int alphaRef, int opacityByte)
{
    // ...
    var (srcBlend, dstBlend) = GetBlendForTranspType(transpType);
    float opacity = opacityByte / 255f;
    if (transpType == 1 && opacityByte < 255)
        srcBlend = BlendMode.SrcAlpha;  // Opacity override for type 1 only

    mat.SetFloat("_SrcBlend", (float)srcBlend);
    mat.SetFloat("_DstBlend", (float)dstBlend);
    mat.SetFloat("_ZWrite", 0f);
    mat.SetFloat("_Opacity", opacity);

    if (alphaRef > 0) {
        mat.EnableKeyword("_ALPHATEST_ON");
        mat.SetFloat("_AlphaTest", 1f);
        mat.SetFloat("_Cutoff", alphaRef / 255f);
    }
    mat.renderQueue = 3000;
    // ...
}

// Routing logic in Awake():
// 1. Try structured suffix __PKO_T{n}_A{n}_O{n}
//    - Type 0: route to TOP/StaticMesh (cutout if alphaRef > 0)
//    - Types 1-8: route to TOP/Effect with configured blend
// 2. Fallback: legacy __PKO_BLEND_ADD → GetOrCreateEffectMaterial(tex, 1, 0, 255)
// 3. Terrain detection
// 4. Default opaque/cutout
```

### File 3: Rust exporter (scene_model.rs, key changes)

```rust
// Canonicalize types 6-8 to type 1
let effective_transp = if mat.transp_type >= 6 { 1 } else { mat.transp_type };
let is_effect = effective_transp != lmo::TRANSP_FILTER;

// Alpha mode: effect + alpha_test → Mask (was: Opaque for ALL additive)
let alpha_mode = if is_effect {
    if mat.alpha_test_enabled {
        Checked::Valid(AlphaMode::Mask)  // NEW: was Opaque
    } else {
        Checked::Valid(AlphaMode::Opaque)
    }
} else if mat.alpha_test_enabled {
    Checked::Valid(AlphaMode::Mask)
} else if mat.opacity < 0.99 {
    Checked::Valid(AlphaMode::Blend)
} else {
    Checked::Valid(AlphaMode::Opaque)
};

// Alpha cutoff now applies to ALL types with alpha test (was: excluded additive)
let alpha_cutoff = if mat.alpha_test_enabled {
    Some(AlphaCutoff((mat.alpha_ref as f32 / 255.0).clamp(0.0, 1.0)))
} else {
    None
};

// Structured suffix replaces __PKO_BLEND_ADD
let material_name = if is_effect || mat.alpha_test_enabled {
    let alpha_ref = if mat.alpha_test_enabled { mat.alpha_ref as u32 } else { 0 };
    let opacity_byte = (mat.opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
    format!("{}__PKO_T{}_A{}_O{}", name, effective_transp, alpha_ref, opacity_byte)
} else {
    name.to_string()
};
```

### File 4: lmo.rs (new constants)

```rust
pub const TRANSP_FILTER: u32 = 0;
pub const TRANSP_ADDITIVE: u32 = 1;
pub const TRANSP_ADDITIVE1: u32 = 2;  // SrcColor/One
pub const TRANSP_ADDITIVE2: u32 = 3;  // SrcColor/InvSrcColor
pub const TRANSP_ADDITIVE3: u32 = 4;  // SrcAlpha/DestAlpha
pub const TRANSP_SUBTRACTIVE: u32 = 5; // Zero/InvSrcColor
// Types 6-8 fall through to ONE/ONE in engine
```

## Key Design Decisions to Evaluate

1. **Type 0 with alpha test gets suffix** (`__PKO_T0_A129_O255`): The plan only discussed suffix for types 1-8, but type 0 with alpha_test_enabled also needs it so Unity can route to cutout queue 2450 rather than relying solely on glTF alpha mode detection.

2. **DepthOnly pass with property-driven ZWrite**: When ZWrite=0 (default for effects), the DepthOnly pass writes nothing. When ZWrite=1 + alpha test, it correctly establishes z-ordering. Is this the right approach for URP?

3. **Opacity modulation location**: Opacity is multiplied in the fragment shader (`result.a *= _Opacity`) rather than in vertex color or base color factor. This matches the D3D TEXTUREFACTOR alpha approach.

4. **Static Dictionary caches**: `s_effectCache` and `s_materialCache` are static and never cleared. Is this a concern for memory or stale state between scene loads?

## Instructions
You are providing an independent review. Be critical and thorough.
- Analyze the question in the context provided
- Identify risks, tradeoffs, and blind spots
- Suggest alternatives if you see better approaches
- Be direct and opinionated — don't hedge
- Structure your response with clear headings
