# Review Request: Render State Parity Pipeline Plan

## Question

Review this plan for correctness, completeness, and risks. The plan implements a render state parity pipeline to faithfully reproduce PKO (Pirate King Online) engine blend modes in Unity. Focus on:

1. **Correctness**: Does the D3D-to-Unity blend mapping accurately reproduce PKO engine behavior?
2. **Encoding strategy**: Is encoding render state via material name suffixes (`__PKO_T{n}_A{n}_O{n}`) the right approach vs glTF extras or other mechanisms?
3. **Shader architecture**: Is making TOP/Effect property-driven (`Blend [_SrcBlend] [_DstBlend]`) sufficient for all 9 transparency types? Do we need separate shaders for subtractive (type 5)?
4. **Opacity interaction**: When opacity != 1.0 and transp_type == ADDITIVE, the engine overrides SrcBlend from ONE to SRCALPHA. The plan encodes opacity in the suffix but doesn't detail the Unity-side override logic clearly enough.
5. **Render queue**: Should different blend modes use different render queues? Currently all effect materials use queue 3000.
6. **DepthOnly pass**: The plan adds a DepthOnly pass to TOP/Effect. For additive effects with ZWrite Off, does this make sense? Could it cause artifacts?
7. **Edge cases**: Types 6-8 (SUBTRACTIVE1-3) fall through to ONE/ONE in the engine. Is treating them identically to type 1 correct?
8. **Backward compatibility**: The plan replaces `__PKO_BLEND_ADD` with `__PKO_T1_A0_O100`. Is the transition strategy sound?
9. **Phase ordering**: Is doing Rust exporter → Shader → C# replacer the right sequence?

Be critical. Identify blind spots and risks.

## The Plan

```markdown
# Render State Parity Pipeline

## Context

PKO buildings/scene objects use 9 transparency types (0-8) with distinct D3D blend modes, per-material alpha test with engine-overridden ALPHAREF=129, and opacity-modulated blending. Our current pipeline only distinguishes two cases: **FILTER (type 0)** and **ADDITIVE (type 1)**. Types 2-8 are silently treated as type 0, losing their blend semantics. Additionally, the additive path forces `AlphaMode::Opaque` in glTF, discarding any alpha test that coexists with additive blending.

**The fix:** Encode per-material PKO render state data through glTF material name suffixes → read in Unity's `TOPMaterialReplacer` → configure property-driven blend modes on a unified shader.

### What NOT to change (confirmed against engine source)

- **Sampler state**: Current hardcoded Linear + LinearMipmapLinear + Repeat is **correct** — `RenderStateMgr.cpp` `_rsa_sceneobj` (lines 59-73) overrides device defaults to LINEAR or ANISOTROPIC for all scene objects. NOT POINT.
- **TSS atoms**: Dead code in engine — `lwTex::BeginSet()` line 264-266 has TSS application commented out. No need to parse or export these.

### PKO Engine Blend Mode Reference (lwResourceMgr.cpp:2087-2109)

| transp_type | Name | SrcBlend | DestBlend | Visual |
|-------------|------|----------|-----------|--------|
| 0 | FILTER | (no blend set) | (no blend set) | Opaque / alpha-test |
| 1 | ADDITIVE | ONE | ONE | Pure additive glow |
| 2 | ADDITIVE1 | SRCCOLOR | ONE | High-brightness additive |
| 3 | ADDITIVE2 | SRCCOLOR | INVSRCCOLOR | Soft/low additive |
| 4 | ADDITIVE3 | SRCALPHA | DESTALPHA | Alpha-weighted additive |
| 5 | SUBTRACTIVE | ZERO | INVSRCCOLOR | Darkening/shadow |
| 6-8 | SUBTRACTIVE1-3 | ONE | ONE | (fall-through, same as type 1) |

**Opacity interaction** (lines 2140-2148): When `opacity != 1.0` AND `transp_type == ADDITIVE`, SrcBlend is overridden from ONE to SRCALPHA.

### Phase A: Rust exporter encodes blend state

- Add constants for transp types 2-8 in lmo.rs
- Write structured material name suffix: `materialName__PKO_T{transp_type}_A{alpha_ref}_O{opacity_pct}`
- Fix additive+alpha-test: set AlphaMode::Mask instead of Opaque when alpha_test_enabled
- Use parsed src_blend/dest_blend from LmoMaterial when available, fall back to engine defaults

### Phase B: Property-driven blend in TOP/Effect shader

- Replace hardcoded `Blend One One` with `Blend [_SrcBlend] [_DstBlend]`
- Add _SrcBlend, _DstBlend, _AlphaTest, _Cutoff, _Cull properties
- Add DepthOnly pass for alpha-tested additive objects
- Defaults: _SrcBlend=1 (One), _DstBlend=1 (One) for backward compat

### Phase C: TOPMaterialReplacer reads suffix and configures materials

- Parse `__PKO_T{n}_A{n}_O{n}` suffix
- Map transp_type to Unity BlendMode via lookup table
- Handle alpha test on effect materials
- Handle opacity override (ADDITIVE + opacity < 1 → SrcAlpha)
- Backward compat: still detect old `__PKO_BLEND_ADD` suffix

### Phase D: Exporter suffix encoding (Rust)

- Replace `__PKO_BLEND_ADD` with structured `__PKO_T{n}_A{n}_O{n}` suffix
- FILTER with alpha test encoded as `__PKO_T0_A129_O100`
```

## Context: PKO Engine Source (Ground Truth)

### lwMtlTexAgent::BeginSet() — lwResourceMgr.cpp:2066-2155

```cpp
LW_RESULT lwMtlTexAgent::BeginSet()
{
    lwIDeviceObject* dev_obj = _res_mgr->GetDeviceObject();
    dev_obj->SetMaterial(&_mtl);

    if(_transp_type != MTLTEX_TRANSP_FILTER)
    {
        DWORD id[2] = { LW_INVALID_INDEX, LW_INVALID_INDEX };
        _rsa_0.FindState(&id[0], D3DRS_SRCBLEND);
        _rsa_0.FindState(&id[1], D3DRS_DESTBLEND);

        DWORD v[2] = {D3DBLEND_ONE, D3DBLEND_ONE};  // DEFAULT for unhandled types
        switch(_transp_type)
        {
        case MTLTEX_TRANSP_ADDITIVE:    v[0] = D3DBLEND_ONE;      v[1] = D3DBLEND_ONE;          break;
        case MTLTEX_TRANSP_ADDITIVE1:   v[0] = D3DBLEND_SRCCOLOR; v[1] = D3DBLEND_ONE;          break; // high
        case MTLTEX_TRANSP_ADDITIVE2:   v[0] = D3DBLEND_SRCCOLOR; v[1] = D3DBLEND_INVSRCCOLOR;  break; // low
        case MTLTEX_TRANSP_ADDITIVE3:   v[0] = D3DBLEND_SRCALPHA; v[1] = D3DBLEND_DESTALPHA;    break; // low-high
        case MTLTEX_TRANSP_SUBTRACTIVE: v[0] = D3DBLEND_ZERO;     v[1] = D3DBLEND_INVSRCCOLOR;  break;
        }
        _rsa_0.SetValue(id[0], v[0]);
        _rsa_0.SetValue(id[1], v[1]);
    }

    // Opacity interaction
    if(_opacity != 1.0f)
    {
        dev_obj->SetRenderState(D3DRS_ZWRITEENABLE, 0);
        dev_obj->SetRenderState(D3DRS_TEXTUREFACTOR, D3DCOLOR_ARGB((BYTE)(_opacity * 255), 0, 0, 0));
        dev_obj->SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
        dev_obj->SetTextureStageState(0, D3DTSS_ALPHAARG2, D3DTA_TFACTOR);

        if(_transp_type != MTLTEX_TRANSP_FILTER)
        {
            if(_transp_type == MTLTEX_TRANSP_ADDITIVE)
            {
                if(id[0] != LW_INVALID_INDEX)
                {
                    _rsa_0.GetStateAtom(&rsa, id[0]);
                    _opacity_reserve_rs[0] = rsa->value0;
                    rsa->value0 = D3DBLEND_SRCALPHA;   // Override SrcBlend to SRCALPHA
                    rsa->value1 = D3DBLEND_SRCALPHA;
                }
            }
        }
    }
    // ... continues with texture binding and alpha test setup
}
```

### Transparency type enum — lwITypes2.h:462-471

```cpp
enum lwMtlTexInfoTransparencyTypeEnum {
    MTLTEX_TRANSP_FILTER =      0,
    MTLTEX_TRANSP_ADDITIVE =    1,
    MTLTEX_TRANSP_ADDITIVE1 =   2,
    MTLTEX_TRANSP_ADDITIVE2 =   3,
    MTLTEX_TRANSP_ADDITIVE3 =   4,
    MTLTEX_TRANSP_SUBTRACTIVE = 5,
    MTLTEX_TRANSP_SUBTRACTIVE1 = 6,
    MTLTEX_TRANSP_SUBTRACTIVE2 = 7,
    MTLTEX_TRANSP_SUBTRACTIVE3 = 8,
};
```

## Context: Current Rust Exporter

### build_lmo_material() — scene_model.rs:319-454

```rust
fn build_lmo_material(builder: &mut GltfBuilder, mat: &lmo::LmoMaterial, name: &str, project_dir: &Path, load_textures: bool) {
    let is_additive = mat.transp_type == lmo::TRANSP_ADDITIVE;  // ONLY checks type 1

    let alpha_mode = if is_additive {
        Checked::Valid(gltf_json::material::AlphaMode::Opaque)  // Forces Opaque for additive!
    } else if mat.alpha_test_enabled {
        Checked::Valid(gltf_json::material::AlphaMode::Mask)
    } else if mat.opacity < 0.99 {
        Checked::Valid(gltf_json::material::AlphaMode::Blend)
    } else {
        Checked::Valid(gltf_json::material::AlphaMode::Opaque)
    };

    let alpha_cutoff = if !is_additive && mat.alpha_test_enabled {
        // ... cutoff logic with opacity scaling, default 129/255
        Some(gltf_json::material::AlphaCutoff(cutoff))
    } else {
        None  // Alpha cutoff DISCARDED for additive materials
    };

    let material_name = if is_additive {
        format!("{}__PKO_BLEND_ADD", name)  // Only signals type 1
    } else {
        name.to_string()
    };

    // Sampler: hardcoded to Linear + LinearMipmapLinear + Repeat
    builder.samplers.push(gltf_json::texture::Sampler {
        mag_filter: Some(Checked::Valid(gltf_json::texture::MagFilter::Linear)),
        min_filter: Some(Checked::Valid(gltf_json::texture::MinFilter::LinearMipmapLinear)),
        wrap_s: Checked::Valid(gltf_json::texture::WrappingMode::Repeat),
        wrap_t: Checked::Valid(gltf_json::texture::WrappingMode::Repeat),
        ..Default::default()
    });

    // Material pushed with extras: None (no custom data)
    builder.materials.push(gltf_json::Material {
        alpha_cutoff, alpha_mode, extras: None, name: Some(material_name),
        // ... pbr, emissive, etc
    });
}
```

### LmoMaterial struct — lmo.rs:117-128

```rust
pub struct LmoMaterial {
    pub diffuse: [f32; 4],
    pub ambient: [f32; 4],
    pub emissive: [f32; 4],
    pub opacity: f32,
    pub transp_type: u32,           // 0-8
    pub alpha_test_enabled: bool,
    pub alpha_ref: u8,              // Usually 129
    pub src_blend: Option<u32>,     // Parsed from LMO but NEVER USED in export
    pub dest_blend: Option<u32>,    // Parsed from LMO but NEVER USED in export
    pub tex_filename: Option<String>,
}
```

### Constants — lmo.rs:59-60

```rust
pub const TRANSP_FILTER: u32 = 0;
pub const TRANSP_ADDITIVE: u32 = 1;
// Types 2-8: NO CONSTANTS DEFINED
```

## Context: Current Unity Pipeline

### TOPMaterialReplacer.cs — Material replacement logic

```csharp
// Detection: material name suffix
const string BlendAddSuffix = "__PKO_BLEND_ADD";

// In Awake loop:
if (matName.EndsWith(BlendAddSuffix))
{
    mats[i] = GetOrCreateEffectMaterial(tex, sharpSparkle, sharpSparkleAlphaClip);
}
else
{
    bool alphaTest = TryGetAlphaCutoutSettings(mats[i], out float cutoff);
    mats[i] = GetOrCreateMaterial(topShader, shaderName, tex, alphaTest, cutoff);
}

// Effect materials: hardcoded blend, no per-material variation
static Material GetOrCreateEffectMaterial(Texture tex, bool sharpSparkle, float sharpAlphaClip)
{
    var mat = new Material(effectShader);
    mat.SetFloat("_SharpSparkleAB", sharpSparkle ? 1f : 0f);
    mat.SetFloat("_SharpAlphaClip", Mathf.Clamp01(sharpAlphaClip));
    mat.renderQueue = 3000;
    mat.SetOverrideTag("RenderType", "Transparent");
    // NO blend mode configuration — relies on shader hardcoded Blend One One
}
```

### TOP_Effect.shader — Current hardcoded additive

```hlsl
Shader "TOP/Effect"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        [Toggle] _SharpSparkleAB ("Sharp Sparkle A/B", Float) = 0
        _SharpAlphaClip ("Sharp Alpha Clip", Range(0, 1)) = 0.22
    }
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent" }
        Pass
        {
            Name "ForwardLit"
            Blend One One           // HARDCODED — all effects are pure additive
            ZWrite Off
            Cull Off
            // ... vertex color * texture, alpha clip
        }
        // NO DepthOnly pass
    }
}
```

## Instructions

You are providing an independent review. Be critical and thorough.
- Analyze the plan against the PKO engine source code provided
- Identify risks, tradeoffs, and blind spots
- Suggest alternatives if you see better approaches
- Be direct and opinionated — don't hedge
- Structure your response with clear headings
- Focus especially on the D3D-to-Unity blend mapping correctness and the material name encoding strategy
