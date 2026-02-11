# The Complete Guide to Effects in PKO (Pirates King Online)

This document is an exhaustive technical reference covering every aspect of the effect system in PKO/TOP (Tales of Pirates). It is written from the perspective of the game engine's C++ source code, the binary `.eff` file format, and the data pipeline that connects items, characters, and visual effects on screen.

---

## Table of Contents

1. [Conceptual Overview](#1-conceptual-overview)
2. [The .eff Binary File Format](#2-the-eff-binary-file-format)
3. [Sub-Effects: The Building Blocks](#3-sub-effects-the-building-blocks)
4. [Effect Geometry (CEffectModel)](#4-effect-geometry-ceffectmodel)
5. [The Keyframe Animation System](#5-the-keyframe-animation-system)
6. [Texture Animation Systems](#6-texture-animation-systems)
7. [Alpha Blending and the D3D Rendering Pipeline](#7-alpha-blending-and-the-d3d-rendering-pipeline)
8. [Colors: How They Work Per-Vertex](#8-colors-how-they-work-per-vertex)
9. [Billboarding](#9-billboarding)
10. [Rotation Systems](#10-rotation-systems)
11. [Deformable Meshes (Cylinders and Cones)](#11-deformable-meshes-cylinders-and-cones)
12. [Path Animation (CEffPath)](#12-path-animation-ceffpath)
13. [Strip Effects (Weapon Trails)](#13-strip-effects-weapon-trails)
14. [The Compound Effect Manager (CMPModelEff)](#14-the-compound-effect-manager-cmpmodeleff)
15. [The Client-Side Effect System (CMagicEff)](#15-the-client-side-effect-system-cmagiceff)
16. [Item Forge/Refine Effects](#16-item-forgerefine-effects)
17. [The Glow System (Item Lit)](#17-the-glow-system-item-lit)
18. [Glow Animation Types (ItemLitAnim)](#18-glow-animation-types-itemlitanim)
19. [Scene Effects and the Particle Pipeline](#19-scene-effects-and-the-particle-pipeline)
20. [Effect Attachment: Bones and Dummy Points](#20-effect-attachment-bones-and-dummy-points)
21. [Shade Effects](#21-shade-effects)
22. [The Resource Manager (CMPResManger)](#22-the-resource-manager-cmpresmanger)
23. [Effect File Version History](#23-effect-file-version-history)
24. [Appendix A: D3DBLEND Constants](#appendix-a-d3dblend-constants)
25. [Appendix B: Effect Type Enum](#appendix-b-effect-type-enum)
26. [Appendix C: Complete Data Flow Diagrams](#appendix-c-complete-data-flow-diagrams)

---

## 1. Conceptual Overview

The PKO effect system is a multi-layered architecture built on top of Direct3D 8 (later adapted to use a custom rendering abstraction `MPRender`). At its core, an **effect** is a time-based animation applied to a piece of geometry, producing visual phenomena like spell circles, weapon glows, hit sparks, and environmental particles.

### The Big Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Game World                               │
│                                                                 │
│   ┌──────────┐     ┌──────────────┐     ┌──────────────────┐   │
│   │ Character │────▶│ CMagicEff    │────▶│ CMPModelEff      │   │
│   │ (bones)   │     │ (scene node) │     │ (compound effect)│   │
│   └──────────┘     └──────────────┘     └──────┬───────────┘   │
│                                                 │               │
│                           ┌─────────────────────┼───────┐       │
│                           │                     │       │       │
│                     ┌─────▼──────┐  ┌───────────▼┐  ┌──▼───┐   │
│                     │ I_Effect   │  │ I_Effect   │  │Strip │   │
│                     │ (sub-eff 0)│  │ (sub-eff 1)│  │Effect│   │
│                     └─────┬──────┘  └────────────┘  └──────┘   │
│                           │                                     │
│               ┌───────────┼───────────────┐                     │
│               │           │               │                     │
│         ┌─────▼────┐ ┌────▼─────┐ ┌──────▼──────┐              │
│         │CEffModel │ │CTexCoord │ │CTexList     │              │
│         │(geometry)│ │List (UV) │ │(texture)    │              │
│         └──────────┘ └──────────┘ └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

Every effect file (`.eff`) contains one or more **sub-effects**. Each sub-effect is an independent animated layer with its own geometry, texture, blend mode, and keyframe data. The compound manager (`CMPModelEff`) orchestrates all sub-effects together, handling global transforms like rotation, scaling, translation, and path following.

Effects are integrated into the game world through `CMagicEff`, which is a scene node. This means effects participate in the scene graph and can be attached to characters, items, or world positions.

### Effect Categories in Gameplay

| Category | Example | How It Works |
|----------|---------|--------------|
| **Skill/Magic** | Fireball, heal circle | Triggered by skill use, bound to caster or target |
| **Forge/Refine** | Weapon glow + particles | Persistent on equipped items, based on refine level |
| **Item Glow (Lit)** | Scrolling/rotating texture overlay | UV-animated texture layer on weapon/armor mesh |
| **Scene Effect** | Environmental particles, waterfalls | Placed at world coordinates, looping |
| **Hit Effect** | Spark on damage | Spawned at impact point, plays once |
| **Strip/Trail** | Weapon swing trail | Two attachment points on a weapon, builds ribbon geometry each frame |
| **Font Effect** | Damage numbers | Billboard text sprites with fade-out |

---

## 2. The .eff Binary File Format

An `.eff` file is a binary file with a versioned header followed by an array of sub-effects. All values are **little-endian**. The format has evolved through 7 versions, each adding new fields while maintaining backward compatibility.

### File Header

| Offset | Type | Field | Description |
|--------|------|-------|-------------|
| 0 | u32 | `version` | Format version (1-7). Determines which fields are present in sub-effects. |
| 4 | i32 | `idxTech` | Shader technique index. Selects which rendering technique from `CMPEffectFile` to use. Most effects use `0`. |
| 8 | u8 | `usePath` | Boolean: does this effect follow a path animation? |
| 9 | char[32] | `pathName` | Null-padded filename of a `.csf` or `.let` path file. |
| 41 | u8 | `useSound` | Boolean: does this effect play a sound? |
| 42 | char[32] | `soundName` | Null-padded sound filename. |
| 74 | u8 | `rotating` | Boolean: does the entire effect auto-rotate? |
| 75 | f32[3] | `rotaVec` | Rotation axis vector `[x, y, z]`. When `rotating` is true, the effect spins around this axis. |
| 87 | f32 | `rotaVel` | Rotation velocity (radians per second). |
| 91 | i32 | `effNum` | Number of sub-effects that follow. |
| 95 | ... | sub-effects | `effNum` sub-effect structures (variable size, version-dependent). |

### Design Notes

- The **path** system allows effects to follow predefined 3D curves (projectile trajectories, orbital paths).
- The **rotating** flag provides a simple way to make an entire effect spin (e.g., a rotating shield aura) without keyframing each sub-effect individually.
- The **technique index** ties into the D3D effect file system (`CMPEffectFile`), which manages HLSL shader passes. A technique index of `0` means "use the default technique."

---

## 3. Sub-Effects: The Building Blocks

Each sub-effect (`I_Effect` in the engine) is a self-contained animated visual element. A single `.eff` file can contain multiple sub-effects that composite together.

### Sub-Effect Binary Layout

Fields are read sequentially. Version-gated fields only exist if the file version exceeds the threshold.

| Type | Field | Description |
|------|-------|-------------|
| char[32] | `effectName` | Human-readable name for this layer (e.g., "ring_outer", "glow_core"). |
| i32 | `effectType` | Determines texture animation mode. See [Appendix B](#appendix-b-effect-type-enum). |
| D3DBLEND (i32) | `srcBlend` | Source blend factor for alpha compositing. See [Section 7](#7-alpha-blending-and-the-d3d-rendering-pipeline). |
| D3DBLEND (i32) | `destBlend` | Destination blend factor. |
| f32 | `length` | Total animation duration in seconds. |
| u16 | `frameCount` | Number of keyframes. |
| f32[frameCount] | `frameTimes` | Time offset for each keyframe (seconds). |
| Vec3[frameCount] | `frameSizes` | Scale `[x, y, z]` per keyframe. Default `[1, 1, 1]`. |
| Vec3[frameCount] | `frameAngles` | Euler rotation `[pitch, yaw, roll]` per keyframe (radians). |
| Vec3[frameCount] | `framePositions` | Translation `[x, y, z]` per keyframe. |
| Vec4[frameCount] | `frameColors` | RGBA color `[r, g, b, a]` per keyframe, values 0.0-1.0. |
| u16 | `verCount` | Vertex count for this sub-effect's geometry. |
| u16 | `coordCount` | Number of UV coordinate animation frames. |
| f32 | `coordFrameTime` | Duration of each UV frame (seconds). |
| Vec2[coordCount][verCount] | `coordList` | UV coordinates per frame per vertex. |
| u16 | `texCount` | Number of texture variant frames. |
| f32 | `texFrameTime` | Duration of each texture frame (seconds). |
| char[32] | `texName` | Base texture filename. |
| Vec2[texCount][verCount] | `texList` | Alternative UV sets per frame per vertex. |
| char[32] | `modelName` | Geometry type. See [Section 4](#4-effect-geometry-ceffectmodel). |
| u8 | `billboard` | Boolean: should this sub-effect always face the camera? |
| i32 | `vsIndex` | Vertex shader index (rarely used, legacy). |

**Version > 1 adds:**

| Type | Field | Description |
|------|-------|-------------|
| i32 | `segments` | Cylinder segment count (3-32). |
| f32 | `height` | Cylinder height. |
| f32 | `topRadius` | Cylinder top radius. |
| f32 | `botRadius` | Cylinder bottom radius. |

**Version > 2 adds:**

| Type | Field | Description |
|------|-------|-------------|
| u16 | `frameTexCount` | Number of per-frame textures. |
| f32 | `frameTexTime` | Duration per frame texture. |
| char[32][frameTexCount] | `frameTexNames` | Texture filename per frame. |
| f32 | `frameTexTime2` | Secondary texture timing (used for cross-fade). |

**Version > 3 adds:**

| Type | Field | Description |
|------|-------|-------------|
| i32 | `useParam` | If > 0, per-frame cylinder parameters are present. |
| CylinderParams[frameCount] | `perFrameCylinder` | Per-frame cylinder overrides (only if `useParam > 0`). Each contains: `segments` (i32), `height` (f32), `topRadius` (f32), `botRadius` (f32). |

**Version > 4 adds:**

| Type | Field | Description |
|------|-------|-------------|
| u8 | `rotaLoop` | Boolean: continuous rotation around an arbitrary axis. |
| Vec4 | `rotaLoopVec` | `[x, y, z, speed]`: rotation axis and angular velocity. |

**Version > 5 adds:**

| Type | Field | Description |
|------|-------|-------------|
| u8 | `alpha` | Boolean: explicitly enable alpha blending for this sub-effect. |

**Version > 6 adds:**

| Type | Field | Description |
|------|-------|-------------|
| u8 | `rotaBoard` | Boolean: when combined with `billboard`, preserves keyframed rotation on top of camera-facing behavior. |

---

## 4. Effect Geometry (CEffectModel)

Every sub-effect renders onto a piece of geometry. The `modelName` field determines what shape is used.

### Built-in Geometry Types

| `modelName` Value | Shape | Vertex Count | Orientation | Use Case |
|-------------------|-------|-------------- |-------------|----------|
| `""` (empty) | Rectangle | 4 | XY plane (faces +Z) | Default. Most flat effects like spell circles, glows. |
| `"Rect"` | Rectangle | 4 | XY plane (faces +Z) | Same as empty string. |
| `"RectZ"` | Rectangle | 4 | XZ plane (faces +Y) | Ground-projected effects (shadows, circles on floor). |
| `"RectPlane"` | Rectangle | 4 | XZ plane (faces +Y) | Alias for RectZ. |
| `"Triangle"` | Triangle | 3 | XY plane | Simple triangular effects. |
| `"TrianglePlane"` | Triangle | 3 | XZ plane | Ground-projected triangular effects. |
| `"Cylinder"` | Cylinder | `(segments+1)*2` | Vertical (Y-axis) | Beams, pillars of light, aura columns. |
| `"Cone"` | Cone | `(segments+1)*2` | Vertical (Y-axis) | Conical effects, expanding beams. |
| `"Sphere"` | Sphere | ~400 (20x20) | All directions | Spherical shields, explosions. |
| `"anything.lgo"` | External model | Varies | From file | Complex shapes loaded from game model files. |

### Vertex Format

All effect geometry uses the `SEFFECT_VERTEX` structure:

```cpp
struct SEFFECT_VERTEX {
    D3DXVECTOR3 m_SPos;      // Position (x, y, z)
    FLOAT       m_fIdx;      // Vertex index (used for VS indirect addressing)
    DWORD       m_dwDiffuse; // Per-vertex color (ARGB packed)
    D3DXVECTOR2 m_SUV;       // Texture coordinates (u, v)
};
// FVF: D3DFVF_XYZB1 | D3DFVF_DIFFUSE | D3DFVF_TEX1
```

The `m_fIdx` field is unique to this system. It's a float that acts as an index into a vertex shader constant array. When the engine uses vertex shaders (VS), it uploads UV coordinates into shader constants at registers `c9+i`, and `m_fIdx` tells the shader which register to read for that vertex's UVs. This allows UV animation without re-locking the vertex buffer.

### How Geometry is Created

The engine determines geometry at load time:

```cpp
// Simplified from I_Effect::BoundingRes()
if (modelName == "Cylinder" || modelName == "Cone") {
    model->CreateTob(modelName, segments, height, topRadius, botRadius);
} else if (modelName == "Rect") {
    model->CreateRect();           // 4 vertices, XY plane
} else if (modelName == "RectZ") {
    model->CreateRectZ();          // 4 vertices, XZ plane
} else if (modelName == "Triangle") {
    model->CreateTriangle();       // 3 vertices, XY plane
} else if (modelName == "TrianglePlane") {
    model->CreatePlaneTriangle();  // 3 vertices, XZ plane
} else if (strstr(modelName, ".lgo")) {
    model->LoadModel(modelName);   // Load external 3D model
}
```

### Rectangle Geometry Detail

A `Rect` (XY plane) is the most common geometry. It creates 4 vertices forming a quad centered at the origin:

```
(-0.5, 0.5)──────(0.5, 0.5)
     │                  │
     │     (origin)     │
     │                  │
(-0.5,-0.5)──────(0.5,-0.5)
```

UV coordinates map `(0,0)` to top-left and `(1,1)` to bottom-right by default.

### Cylinder Geometry Detail

A cylinder is defined by four parameters:

- **segments**: Number of radial divisions (3 = triangle cross-section, 32 = smooth circle)
- **height**: Distance between top and bottom rings
- **topRadius**: Radius of the upper ring
- **botRadius**: Radius of the lower ring

When `topRadius != botRadius`, you get a truncated cone. When `topRadius == 0`, you get a true cone. The vertices are arranged in two rings (top and bottom) with `segments + 1` vertices each (the last vertex overlaps the first to close the UV seam).

---

## 5. The Keyframe Animation System

The animation controller (`CEffectCortrol`) drives per-frame state for each sub-effect. It maintains the current interpolated values for size, angle, position, and color.

### State Variables

```cpp
class CEffectCortrol {
    float       m_fCurTime;      // Accumulated time since play started
    WORD        m_wCurFrame;     // Current keyframe index
    D3DXCOLOR   m_dwCurColor;    // Interpolated RGBA color
    D3DXVECTOR3 m_SCurSize;      // Interpolated scale [x, y, z]
    D3DXVECTOR3 m_SCurAngle;     // Interpolated rotation [pitch, yaw, roll]
    D3DXVECTOR3 m_SCurPos;       // Interpolated translation [x, y, z]
    // ... UV animation state ...
};
```

### Frame Advance Logic

Each game tick, the engine:

1. Adds delta time (`dwDailTime`) to `m_fCurTime`.
2. Checks if `m_fCurTime` exceeds the current keyframe's duration (`frameTimes[m_wCurFrame]`).
3. If yes, advances `m_wCurFrame` and subtracts the consumed time.
4. Computes a **lerp factor** `t` = (time into current segment) / (segment duration).
5. Linearly interpolates between `frame[current]` and `frame[next]` for all properties.

### Interpolation Functions

The engine uses Direct3D math helpers for interpolation:

```cpp
// Size interpolation (linear)
D3DXVec3Lerp(&outSize, &frameSizes[idx1], &frameSizes[idx2], lerp);

// Angle interpolation (linear)
D3DXVec3Lerp(&outAngle, &frameAngles[idx1], &frameAngles[idx2], lerp);

// Position interpolation (linear)
D3DXVec3Lerp(&outPos, &framePos[idx1], &framePos[idx2], lerp);

// Color interpolation (linear)
D3DXColorLerp(&outColor, &frameColors[idx1], &frameColors[idx2], lerp);
```

All interpolation is **linear** (LERP). There is no spline or bezier interpolation in the engine's effect system. The `D3DXVec3Lerp` function computes `result = a + (b - a) * t`.

### Optimization: Same-Value Detection

The engine pre-computes `_bSizeSame`, `_bAngleSame`, `_bPosSame`, and `_bColorSame` flags. If all keyframes have the same value for a property, the interpolation is skipped entirely:

```cpp
void I_Effect::GetLerpSize(D3DXVECTOR3* pSOut, WORD wIdx1, WORD wIdx2, float fLerp) {
    if (_wFrameCount == 1 || _bSizeSame) {
        *pSOut = _vecFrameSize[0];  // Skip interpolation
        return;
    }
    D3DXVec3Lerp(pSOut, &_vecFrameSize[wIdx1], &_vecFrameSize[wIdx2], fLerp);
}
```

### Transform Composition

The final transform matrix for a sub-effect is built in `CEffectCortrol::GetTransformMatrix()`:

```cpp
void GetTransformMatrix(D3DXMATRIX* pSOut, D3DXMATRIX* pRota = NULL) {
    D3DXMATRIX scaleMat, rotMat;

    // 1. Build scale matrix
    D3DXMatrixScaling(&scaleMat, m_SCurSize.x, m_SCurSize.y, m_SCurSize.z);

    // 2. Build rotation matrix (YawPitchRoll order)
    D3DXMatrixRotationYawPitchRoll(&rotMat,
        m_SCurAngle.y,   // Yaw   (Y-axis rotation)
        m_SCurAngle.x,   // Pitch (X-axis rotation)
        m_SCurAngle.z);  // Roll  (Z-axis rotation)

    // 3. If external rotation provided (rotaLoop), compose
    if (pRota) {
        rotMat = rotMat * (*pRota);
    }

    // 4. Final = Scale * Rotation
    *pSOut = scaleMat * rotMat;

    // 5. Set translation directly in matrix
    pSOut->_41 = m_SCurPos.x;
    pSOut->_42 = m_SCurPos.y;
    pSOut->_43 = m_SCurPos.z;
}
```

**Key insight**: The rotation order is **YawPitchRoll** (`D3DXMatrixRotationYawPitchRoll`), which applies rotations in the order Y, X, Z. The angle vector stores `[pitch(x), yaw(y), roll(z)]`. This is a common source of confusion when porting to other engines.

---

## 6. Texture Animation Systems

PKO effects support three distinct texture animation mechanisms, controlled by the `effectType` field. Each addresses a different visual need.

### effectType = 0: EFFECT_NONE (Static)

The texture is applied once and does not change. UV coordinates come from the geometry's default mapping. This is the simplest mode.

### effectType = 1: EFFECT_FRAMETEX (Frame Texture Animation)

**Purpose**: Swap the entire texture each frame, like a flipbook/sprite sheet animation.

**How it works**: The `CTexFrame` class manages a list of texture filenames (`frameTexNames`). Each frame, a different texture is loaded and applied to the geometry. The frame advance is independent of the keyframe system, using its own `frameTexTime` interval.

```cpp
lwITex* CTexFrame::GetCurTexture(WORD& wCurIndex, float& fCurTime, float fDailTime) {
    fCurTime += fDailTime;
    if (fCurTime >= m_fFrameTime) {
        fCurTime -= m_fFrameTime;
        wCurIndex++;
        if (wCurIndex >= m_wTexCount) {
            wCurIndex = 0;  // Loop
        }
    }
    return m_vecTexs[wCurIndex];
}
```

**Use case**: Explosions, fire animations, or any effect that uses a sequence of pre-rendered textures.

### effectType = 2: EFFECT_MODELUV (Per-Vertex UV Coordinate Animation)

**Purpose**: Smoothly animate UV coordinates per vertex. This allows texture scrolling, rotation, and complex warping effects.

**How it works**: The `CTexCoordList` class stores multiple sets of UV coordinates (one per animation frame, each set having one UV per vertex). The engine interpolates between UV sets using the same lerp mechanism as keyframes.

```cpp
void CTexCoordList::GetCurCoord(
    S_BVECTOR<D3DXVECTOR2>& vecOutCoord,
    WORD& wCurIndex,
    float& fCurTime,
    float fDailTime
) {
    fCurTime += fDailTime;
    if (fCurTime >= m_fFrameTime) {
        fCurTime -= m_fFrameTime;
        wCurIndex++;
        if (wCurIndex >= m_wCoordCount - 1) {
            wCurIndex = 0;
        }
    }
    // Interpolate between current and next UV set
    float lerp = fCurTime / m_fFrameTime;
    for (int i = 0; i < m_wVerCount; i++) {
        D3DXVec2Lerp(&vecOutCoord[i],
            &m_vecCoordList[wCurIndex][i],
            &m_vecCoordList[wCurIndex + 1][i],
            lerp);
    }
}
```

The interpolated UVs are then written to the vertex buffer or uploaded to vertex shader constants.

**Use case**: Scrolling energy textures, rotating rune circles, pulsing patterns.

### effectType = 3: EFFECT_MODELTEXTURE (Discrete UV Set Switching)

**Purpose**: Switch between pre-defined UV layouts without interpolation. Similar to EFFECT_MODELUV but snaps between frames instead of blending.

**How it works**: The `CTexList` class stores UV sets and a texture reference. Each frame, the next UV set is applied instantly.

```cpp
void CTexList::GetCurTexture(
    S_BVECTOR<D3DXVECTOR2>& coord,
    WORD& wCurIndex,
    float& fCurTime,
    float fDailTime
) {
    fCurTime += fDailTime;
    if (fCurTime >= m_fFrameTime) {
        fCurTime -= m_fFrameTime;
        wCurIndex++;
        if (wCurIndex >= m_wTexCount) {
            wCurIndex = 0;
        }
    }
    // No interpolation - direct copy
    for (int i = 0; i < verCount; i++) {
        coord[i] = m_vecTexList[wCurIndex][i];
    }
}
```

**Use case**: Sprite sheets where each cell is a complete frame, text effects.

### effectType = 4: EFFECT_MODEL (Static Model)

**Purpose**: Render a 3D model without any texture animation. The model may have its own animations (played via `PlayModel()`), but the effect system does not manipulate its UVs.

**Use case**: Complex 3D shapes as effect elements (weapons, shields, sigils loaded from `.lgo` files).

### UV Upload Methods

The engine supports two methods for applying UV coordinates to the geometry:

**1. Vertex Shader Path** (`FillModelUV`): UV coordinates are uploaded as vertex shader constants at registers `c9+i`:
```cpp
void FillModelUV(CEffectModel* pCModel) {
    for (WORD i = 0; i < pCModel->GetVerCount(); i++) {
        pCModel->GetDev()->SetVertexShaderConstant(9 + i, m_vecCurCoord[i], 1);
    }
}
```

**2. Software Path** (`FillModelUVSoft`): UV coordinates are written directly into the vertex buffer:
```cpp
void FillModelUVSoft(CEffectModel* pCModel) {
    SEFFECT_VERTEX* pVertex;
    pCModel->Lock((BYTE**)&pVertex);
    for (WORD i = 0; i < pCModel->GetVerCount(); ++i) {
        pVertex[i].m_SUV = *m_vecCurCoord[i];
    }
    pCModel->Unlock();
}
```

The software path is used when hardware vertex shaders are unavailable or when the resource manager's `m_bUseSoft` flag is set.

---

## 7. Alpha Blending and the D3D Rendering Pipeline

Alpha blending is fundamental to how effects appear transparent, additive, or subtractive against the scene.

### How D3D Alpha Blending Works

For readers unfamiliar with the concept: when a pixel is drawn on screen, the GPU can either replace the existing color entirely, or **blend** the new color with what's already there. The blending formula is:

```
FinalColor = (SourceColor × SrcBlend) + (DestColor × DestBlend)
```

Where:
- **SourceColor** = the color of the pixel being drawn (from the effect)
- **DestColor** = the color already in the framebuffer (the scene behind the effect)
- **SrcBlend** and **DestBlend** = factors that control how much each contributes

For a deeper explanation of GPU blending, see: [LearnOpenGL - Blending](https://learnopengl.com/Advanced-OpenGL/Blending) (the concepts are identical between D3D and OpenGL).

### Common Blend Mode Combinations

| SrcBlend | DestBlend | Visual Result | Use Case |
|----------|-----------|---------------|----------|
| SrcAlpha (5) | InvSrcAlpha (6) | **Standard transparency** | Semi-transparent effects, fading |
| SrcAlpha (5) | One (2) | **Additive with alpha** | Glowing effects, fire, energy |
| One (2) | One (2) | **Pure additive** | Very bright glows, lens flares |
| Zero (1) | SrcColor (3) | **Multiplicative** | Darkening, shadows |
| SrcColor (3) | One (2) | **Soft additive** | Subtle glow layers |
| SrcAlpha (5) | SrcColor (3) | **Colored additive** | Tinted energy effects |

### Per-Sub-Effect Blend Control

Each sub-effect stores its own `srcBlend` and `destBlend` values. During rendering, the engine sets these as D3D render states:

```cpp
void I_Effect::Render() {
    m_pDev->SetRenderState(D3DRS_SRCBLEND, _eSrcBlend);
    m_pDev->SetRenderState(D3DRS_DESTBLEND, _eDestBlend);
    m_pCModel->RenderModel();
}
```

Alpha blending is enabled globally for the effect pass:
```cpp
m_pDev->SetRenderState(D3DRS_ALPHABLENDENABLE, TRUE);
```

### Z-Buffer Considerations

Effects typically **read** the depth buffer (so they occlude correctly behind solid objects) but **do not write** to it (so they don't prevent other effects from rendering in front of them):

```cpp
m_pDev->SetRenderState(D3DRS_ZENABLE, TRUE);
m_pDev->SetRenderState(D3DRS_ZWRITEENABLE, FALSE);
```

The `CMPModelEff::UseZBuffer(bool)` method can override this behavior for special cases.

---

## 8. Colors: How They Work Per-Vertex

Colors in the effect system operate at two levels: the **keyframe color** (animation-driven) and the **vertex diffuse color** (per-vertex in the geometry).

### Keyframe Color

Each keyframe defines an RGBA color (`D3DXCOLOR` = `[r, g, b, a]`, each 0.0 to 1.0). Between keyframes, colors are linearly interpolated. The interpolated color is stored in `CEffectCortrol::m_dwCurColor`.

### How Color Reaches the Vertex Buffer

During the render pass, the engine writes the interpolated color into every vertex's `m_dwDiffuse` field. This happens when the vertex buffer is locked and updated each frame:

```cpp
// Pseudocode from CMPModelEff::FrameMove()
for (each vertex in model) {
    vertex.m_dwDiffuse = D3DCOLOR_COLORVALUE(
        curColor.r,
        curColor.g,
        curColor.b,
        curColor.a
    );
}
```

### Alpha Channel as Fade Control

The most common use of color animation is **fade-in/fade-out**. A typical effect keyframe sequence:

```
Frame 0: color = [1, 1, 1, 0]     ← fully transparent (invisible)
Frame 1: color = [1, 1, 1, 1]     ← fully opaque (visible)
Frame 2: color = [1, 1, 1, 1]     ← stays visible
Frame 3: color = [1, 1, 1, 0]     ← fades out
```

### Color Tinting

Effects can be tinted by using non-white RGB values. For example, a red glow:

```
Frame 0: color = [1, 0.2, 0.2, 0]   ← invisible red
Frame 1: color = [1, 0.2, 0.2, 1]   ← visible red
```

The vertex color is multiplied with the texture color in the pixel pipeline (via `D3DTSS_COLOROP = D3DTOP_MODULATE`), so a white texture tinted red becomes red, and a multi-colored texture gets its colors modulated.

### Runtime Alpha Override

The `CMPModelEff::SetAlpha(float)` method allows external systems to override the alpha value:

```cpp
void SetAlpha(float fAlpha) {
    for (int n = 0; n < m_iEffNum; ++n) {
        m_vecCortrol[n]->m_dwCurColor.a = fAlpha;
    }
}
```

This is used by the forge effect system to control overall effect opacity based on refine level.

---

## 9. Billboarding

Billboarding makes a flat effect always face the camera, regardless of the camera's position. This is essential for effects like sparks, spell indicators, and damage numbers.

### How It Works

The engine provides a **billboard matrix** through `I_Effect::setBillBoardMatrix()`. This matrix is the inverse of the camera's view rotation, which effectively cancels out the camera's orientation when multiplied with the effect's transform.

```cpp
// During rendering, if billboard is enabled:
if (_bBillBoard) {
    // _SpmatBBoard is the inverse view rotation matrix
    D3DXMATRIX finalTransform = subEffectTransform * (*_SpmatBBoard);
    m_pDev->SetTransform(D3DTS_WORLD, &finalTransform);
}
```

### RotaBoard: Billboard + Rotation

In version 6+, the `rotaBoard` flag was added. When both `billboard` and `rotaBoard` are true, the sub-effect faces the camera but also applies keyframed rotation. The rotation is composed with the billboard matrix:

```
Final = Scale × FrameRotation × BillboardMatrix × Translation
```

Without `rotaBoard`, billboard effects discard all rotation:

```
Final = Scale × BillboardMatrix × Translation
```

This distinction matters for effects like spinning coins (billboard + rotation) vs. simple spark particles (billboard only).

### Board vs. Non-Board Geometry

The engine distinguishes geometry types:

```cpp
bool IsBoard() { return (!IsChangeably() && !IsItem()); }
```

- **Board** geometry (rects, triangles): Can be billboarded.
- **Changeable** geometry (cylinders, cones): Cannot be billboarded (they have 3D volume).
- **Item** geometry (.lgo models): Cannot be billboarded.

---

## 10. Rotation Systems

PKO effects have three rotation mechanisms that can stack:

### 1. Global Effect Rotation (`rotating` flag in header)

When enabled, the entire compound effect rotates around `rotaVec` at `rotaVel` radians per second. This is applied at the `CMPModelEff` level:

```cpp
void CMPModelEff::GetTransMatrix(D3DXMATRIX& mat) {
    if (m_bRotating) {
        m_fCurRotat += m_fRotaVel * deltaTime;
        if (m_fCurRotat >= 2π) m_fCurRotat -= 2π;
        D3DXMatrixRotationAxis(&m_SmatRota, &m_SVerRota, m_fCurRotat);
    }
    mat = m_SmatScale * m_SmatRota * m_SMatTempRota * m_SmatTrans;
}
```

### 2. Per-Keyframe Rotation (`frameAngles`)

Each keyframe can specify a rotation. This is interpolated and applied per sub-effect in the `CEffectCortrol::GetTransformMatrix()` method using `D3DXMatrixRotationYawPitchRoll`.

### 3. Rotation Loop (`rotaLoop` in sub-effect, version 5+)

A sub-effect can have its own continuous rotation around an arbitrary axis. This is independent of the keyframe rotation:

```cpp
void GetRotaLoopMatrix(D3DXMATRIX* pmat, float& pCurRota, float fTime) {
    pCurRota += _vRotaLoop.w * fTime;  // .w = angular velocity
    if (pCurRota >= 2π) pCurRota -= 2π;
    D3DXMatrixRotationAxis(pmat,
        &D3DXVECTOR3(_vRotaLoop.x, _vRotaLoop.y, _vRotaLoop.z),
        pCurRota);
}
```

### Composition Order

When all three systems are active:

```
SubEffect Transform = Scale × (FrameRotation × RotaLoopRotation) × Position
Compound Transform  = SubEffect × GlobalRotation × CompoundScale × CompoundTranslation
Final               = Compound × BoneMatrix (if attached to skeleton)
```

---

## 11. Deformable Meshes (Cylinders and Cones)

Cylinders and cones are **deformable** meshes whose parameters can change per-keyframe. This is the `useParam` / `perFrameCylinder` system added in version 4.

### Per-Frame Cylinder Parameters

When `useParam > 0`, each keyframe can have different cylinder dimensions:

```cpp
struct ModelParam {
    int   iSegments;
    float fHei;         // Height
    float fTopRadius;
    float fBottomRadius;
    std::vector<D3DXVECTOR3> vecVer;  // Pre-computed vertex positions
    void Create();      // Generates vertex positions from parameters
};
```

### Rendering Deformable Meshes

During rendering, the engine interpolates between two `ModelParam` states (the current and next keyframe):

```cpp
void CEffectModel::RenderTob(ModelParam* last, ModelParam* next, float lerp) {
    // For each vertex, interpolate between last and next positions
    for (int i = 0; i < vertexCount; i++) {
        D3DXVec3Lerp(&finalVertex[i].m_SPos,
            &last->vecVer[i],
            &next->vecVer[i],
            lerp);
    }
    // Write to vertex buffer and draw
}
```

### Use Cases

- **Expanding beam**: topRadius animates from 0 to large value
- **Pulsing column**: height oscillates between frames
- **Tornado**: both radii and height change per frame
- **Laser**: thin cylinder that stretches in height

---

## 12. Path Animation (CEffPath)

Effects can follow predefined 3D paths, creating trajectories for projectiles, orbital motion, or complex movement patterns.

### Path File Formats

**`.csf` format** (Custom Spline File):

```
Offset  Type     Field
0       char[3]  "csf" (magic bytes)
3       i32      version
7       i32      pointCount
11+     Vec3[]   control points (pointCount × 12 bytes)
```

**`.let` format**: Uses `lwEfxTrack`, a more complex animation track format from the engine.

### Path Data Structure

```cpp
class CEffPath {
    D3DXVECTOR3 m_vecPath[200];   // Control points (max 200)
    float       m_vecDist[200];   // Pre-computed distance between consecutive points
    D3DXVECTOR3 m_vecDir[200];    // Pre-computed normalized direction vectors
    int         m_iFrameCount;    // Number of control points
    float       m_fVel;           // Movement velocity (units per second)

    int         m_iCurFrame;      // Current segment index
    float       m_fCurDist;       // Distance traveled in current segment
    D3DXVECTOR3 m_vCurPos;        // Current interpolated position
};
```

### Path Following Logic

The path follower moves at constant velocity along line segments between control points:

```cpp
void CEffPath::FrameMove(float fDailTime) {
    float fvel = m_fVel * fDailTime;
    m_fCurDist += fvel;

    // Walk segments until remaining distance is consumed
    while (m_fCurDist >= m_vecDist[m_iCurFrame]) {
        m_fCurDist -= m_vecDist[m_iCurFrame];
        m_iCurFrame++;
        if (m_iCurFrame >= m_iFrameCount - 1) {
            m_iCurFrame = 0;  // Loop
            m_bEnd = true;
        }
    }

    // Interpolate position within current segment
    m_vCurPos = m_vecPath[m_iCurFrame]
              + (m_vecDir[m_iCurFrame] * m_fCurDist);
}
```

This is a linear interpolation along the path segments. The effect's position is set to `m_vCurPos` each frame.

---

## 13. Strip Effects (Weapon Trails)

Strip effects (`CMPStrip`) create ribbon-like trails behind moving objects, commonly used for weapon swing effects.

### Concept

Two **dummy points** on a weapon (e.g., blade tip and blade base) are tracked each frame. The engine records their world-space positions and builds a triangle strip mesh that connects successive pairs. As the weapon moves, new vertex pairs are appended and old ones fade out.

```
Frame 0:    Frame 1:    Frame 2:
D1──D1'     D1──D1'     D1──D1'──D1''
│   │       │  ╱│       │  ╱│  ╱│
│   │       │╱  │       │╱  │╱  │
D2──D2'     D2──D2'     D2──D2'──D2''
```

### Key Properties

```cpp
class CMPStrip {
    int       m_iMaxLen;           // Maximum trail length (vertex pairs)
    int       _iDummy[2];          // Two dummy point indices on the weapon
    D3DXCOLOR _dwColor;            // Trail color (ARGB)
    float     _fLife;              // Fade lifetime (seconds until fully transparent)
    float     _fStep;              // Time between new vertex pair additions
    s_string  _strTexName;         // Trail texture
    D3DBLEND  _eSrcBlend;          // Source blend factor
    D3DBLEND  _eDestBlend;         // Destination blend factor
};
```

### Vertex Structure

```cpp
struct Strip_Vertex {
    D3DXVECTOR3 m_SPos;       // World-space position
    DWORD       m_dwDiffuse;  // Color with alpha for fading
    D3DXVECTOR2 m_SUV;        // Texture coordinates
};
// FVF: D3DFVF_XYZ | D3DFVF_DIFFUSE | D3DFVF_TEX1
```

### Trail Building

Each update step, the engine:

1. Gets the world-space positions of both dummy points from the weapon's bone matrices.
2. Creates two new `Strip_Vertex` entries (one for each dummy point).
3. Sets UV coordinates: `y=1` for dummy 1, `y=0` for dummy 2, `x` increases along the trail.
4. Appends to the vertex path buffer.

### Trail Fading

Each vertex pair has a `track` that accumulates time. As the track's time approaches `_fLife`, the alpha is reduced:

```cpp
void track::FrameMove(float fDailTime, D3DXCOLOR& dwColor, float fLife) {
    if (m_fCurTime >= fLife) {
        dwColor.a = 0;    // Fully faded
        return;
    }
    dwColor.a = 1.0f - (m_fCurTime / fLife);  // Linear fade
    m_fCurTime += fDailTime;
}
```

The oldest vertices fade out naturally. When their alpha reaches 0, they are popped from the front of the buffer.

---

## 14. The Compound Effect Manager (CMPModelEff)

`CMPModelEff` is the orchestrator that manages all sub-effects within a single `.eff` file. It handles:

- Playing/stopping all sub-effects together
- Applying global transforms (scale, rotation, translation)
- Path following
- Bone binding
- Sound synchronization
- Shader technique selection

### Per-Frame Update

```cpp
void CMPModelEff::FrameMove(DWORD dwDailTime) {
    float fDail = (float)dwDailTime / 1000.0f;  // Convert ms to seconds

    for (int n = 0; n < m_iEffNum; n++) {
        I_Effect* pEffect = m_vecEffect[n];
        CEffectCortrol* pCtrl = m_vecCortrol[n];

        if (!pCtrl->IsPlay()) continue;

        // 1. Advance keyframe time
        pCtrl->m_fCurTime += fDail;

        // 2. Find current keyframe
        while (pCtrl->m_fCurTime >= pEffect->getFrameTime(pCtrl->m_wCurFrame)) {
            pCtrl->m_fCurTime -= pEffect->getFrameTime(pCtrl->m_wCurFrame);
            pCtrl->m_wCurFrame++;

            if (pCtrl->m_wCurFrame >= pEffect->getFrameCount()) {
                // Loop or stop based on play mode
                if (m_bLoop) {
                    pCtrl->m_wCurFrame = 0;
                } else {
                    pCtrl->Stop();
                    break;
                }
            }
        }

        // 3. Compute lerp factor
        float lerp = pCtrl->m_fCurTime / pEffect->getFrameTime(pCtrl->m_wCurFrame);
        WORD next = min(pCtrl->m_wCurFrame + 1, pEffect->getFrameCount() - 1);

        // 4. Interpolate all properties
        pEffect->GetLerpSize(&pCtrl->m_SCurSize, pCtrl->m_wCurFrame, next, lerp);
        pEffect->GetLerpAngle(&pCtrl->m_SCurAngle, pCtrl->m_wCurFrame, next, lerp);
        pEffect->GetLerpPos(&pCtrl->m_SCurPos, pCtrl->m_wCurFrame, next, lerp);
        pEffect->GetLerpColor(&pCtrl->m_dwCurColor, pCtrl->m_wCurFrame, next, lerp);

        // 5. Advance UV/texture animations (independent timing)
        pEffect->GetLerpCoord(pCtrl->m_vecCurCoord, ...);
        pEffect->GetLerpTexture(pCtrl->m_lpCurTex, ...);
        pEffect->GetLerpFrame(pCtrl->m_wCurTexIndex, ...);
    }

    // 6. Update path animation
    if (m_bUsePath && m_pPath) {
        m_CPathCtrl.Update(fDail, m_pPath);
    }
}
```

### Rendering Pipeline

```cpp
void CMPModelEff::Render() {
    D3DXMATRIX matWorld, matSub;

    // 1. Compute compound transform
    GetTransMatrix(matWorld);

    // 2. Apply bone binding
    if (m_bBindbone) {
        matWorld = matWorld * m_SpmatBone;
    }

    // 3. Apply path offset
    if (m_bUsePath) {
        D3DXVECTOR3* pathPos = m_pPath->GetCurPos();
        matWorld._41 += pathPos->x;
        matWorld._42 += pathPos->y;
        matWorld._43 += pathPos->z;
    }

    // 4. Set shader technique
    if (m_pCEffectFile) {
        m_pCEffectFile->SetTechnique(m_iIdxTech);
        m_pCEffectFile->Begin();
    }

    // 5. Render each sub-effect
    for (int n = 0; n < m_iEffNum; n++) {
        I_Effect* pEffect = m_vecEffect[n];
        CEffectCortrol* pCtrl = m_vecCortrol[n];

        // Get sub-effect transform
        pCtrl->GetTransformMatrix(&matSub, rotaLoopMatrix);
        D3DXMATRIX finalMat = matSub * matWorld;

        // Handle billboard
        if (pEffect->IsBillBoard()) {
            // Apply billboard matrix
        }

        m_pDev->SetTransform(D3DTS_WORLD, &finalMat);

        // Set blend mode
        pEffect->Render();  // Sets blend states and draws
    }

    // 6. End shader
    if (m_pCEffectFile) {
        m_pCEffectFile->End();
    }
}
```

---

## 15. The Client-Side Effect System (CMagicEff)

`CMagicEff` bridges the engine's effect system with the game world. It's a scene node that handles:

### Effect Types

```cpp
enum {
    EFF_SCENE  = 0,  // Scene-wide effects (no owner)
    EFF_CHA    = 1,  // Character effects (bind to character)
    EFF_ITEM   = 2,  // Item effects (bind to item)
    EFF_STRIP  = 3,  // Trail/strip effects
    EFF_SELF   = 4,  // Self-contained effects
    EFF_HIT    = 5,  // Hit/collision effects
    EFF_MAGIC  = 6,  // Skill/magic effects
    EFF_FONT   = 7,  // Text/damage number effects
};
```

### Scene Effect Object Types

```cpp
enum EFFOBJ_TYPE {
    EFFOBJ_SHADE           = 1,  // Shader-based shadow
    EFFOBJ_SHADEANI        = 2,  // Animated shadow
    EFFOBJ_PARTICLE_RIPPLE = 3,  // Water ripple particle
    EFFOBJ_PARTICLE_TRACE  = 4,  // Trace particle
    EFFOBJ_SCENE           = 5,  // Scene effect
    EFFOBJ_PARTICLE        = 6,  // Particle system
    EFFOBJ_PART            = 7,  // Particle part control
};
```

### Effect Delay System

Some effects need to be synchronized with server events (like a projectile hitting its target). The `CEffDelay` class handles this:

```cpp
class CEffDelay {
    enum { enumPos, enumHitEffect };
    int   m_iType;       // enumPos or enumHitEffect
    DWORD m_dwStartTime; // When the delay started
    DWORD m_dwDelayTime; // How long to wait
};
```

When a skill is used, the effect can be queued with a delay. It only plays when the delay expires or a server harm packet confirms the hit.

---

## 16. Item Forge/Refine Effects

Forge (refine) effects are the glowing particle effects visible on upgraded equipment. This is a multi-stage lookup system that maps an item's refine level to specific visual effects.

### The Complete Lookup Chain

```
Step 1: Item ID → ItemRefineInfo
    Lookup: ItemRefineInfo.bin[item_id]
    Result: effect_category mapping (14-element array)

Step 2: Stone Category → Refine Effect ID
    Input:  3 forge stones (types)
    Compute: stone_effect_category(stone1, stone2, stone3) → category (0-14)
    Lookup: ItemRefineInfo.values[category] → refine_effect_id

Step 3: Refine Effect → Visual Components
    Lookup: ItemRefineEffectInfo.bin[refine_effect_id]
    Result: light_id + effect_ids[4][4] + dummy_ids[4]
            (indexed by [character_type][tier])

Step 4: Compute Tier from Refine Level
    total_level = sum of all stone levels
    tier = 0 if level ≤ 4
           1 if level 5-8
           2 if level 9-12
           3 if level ≥ 13

Step 5: Resolve Visual Components
    Glow:      item.lit[light_id] → texture + animation type
    Particles: sceneffectinfo[base_id * 10 + tier] → .par filename
```

### Stone Effect Categories

Different combinations of forge stones produce different visual effects. The category system uses deduplication and sum/product matching:

```
Category 0:  No effect
Category 1:  Single stone type (type A)
Category 2:  Single stone type (type B)
...
Category 5:  Mix of two stone types
...
Category 11: All three different stone types
...
Category 14: Specific triple combination
```

### Alpha (Opacity) by Refine Level

The overall opacity of forge effects increases with refine level:

```
Level  0-1:  80/255  → 140/255  (barely visible → faint)
Level  1-5:  140/255 → 200/255  (faint → moderate)
Level  5-9:  200/255 → 255/255  (moderate → full)
Level  9-13: 255/255            (always full)
```

This is computed with linear interpolation within each tier:

```rust
fn compute_forge_alpha(total_level: u32) -> f32 {
    let level_alpha: [f32; 4] = [80.0, 140.0, 200.0, 255.0];
    let level_base: [f32; 4]  = [60.0, 60.0, 55.0, 0.0];

    if total_level <= 1 { return 80.0 / 255.0; }
    if total_level >= 13 { return 1.0; }

    let tl = total_level - 1;
    let tier = (tl / 4) as usize;
    let frac = (tl % 4) as f32 / 4.0;
    (level_alpha[tier] + frac * level_base[tier]) / 255.0
}
```

### Progressive Particle Reveal

At lower tiers, some scene effect IDs don't exist in `sceneffectinfo.bin`. The system simply skips those entries. At higher tiers, more entries exist, causing more particle layers to appear. This creates a "blooming" effect where upgrades progressively reveal more visual complexity.

---

## 17. The Glow System (Item Lit)

The "lit" system adds a glowing texture overlay to weapons and armor. Unlike particle effects, glow is rendered as an additional texture pass on the item mesh itself.

### item.lit Binary Format

```
Header (24 bytes):
    u32  version
    u32  type
    u32  mask[4]

u32  item_count

Per Item:
    u32      id              // Item ID
    char[64] descriptor      // Display name
    char[128] file           // Base glow texture filename
    u32      lit_count       // Number of glow layers (typically 4, one per tier)

    Per Lit Layer (144 bytes each):
        u32      id          // Layer ID
        char[128] file       // Glow texture for this tier
        u32      anim_type   // Animation type (0-8)
        u32      transp_type // Transparency mode
        f32      opacity     // Base opacity (0.0 - 1.0)
```

### Glow Rendering

The glow texture is rendered as an additional pass on the item mesh. The mesh's existing UV coordinates are used, but the texture and its UV transform are animated. The glow is additively blended on top of the base item texture.

### Tier-Based Glow Selection

Each item can have up to 4 glow layers (one per forge tier). As the refine level increases, the active glow layer changes:

| Tier | Stone Level | Glow Layer | Visual |
|------|-------------|------------|--------|
| 0 | 0-4 | `lits[0]` | Faint shimmer |
| 1 | 5-8 | `lits[1]` | Moderate glow |
| 2 | 9-12 | `lits[2]` | Strong glow |
| 3 | 13+ | `lits[3]` | Maximum glow |

---

## 18. Glow Animation Types (ItemLitAnim)

The glow animation system uses the engine's `lwIAnimKeySetPRS` (Position/Rotation/Scale keyframe) interface to animate UV transforms. Each animation type is a hardcoded function that sets up specific keyframes.

### Animation Type Table

| Index | Name | Frames | Keys | Description |
|-------|------|--------|------|-------------|
| 0 | NULL | - | - | No animation. Static glow. |
| 1 | 120f-rot | 0-119 | Z-axis rotation: 0→π→2π | **120-frame clockwise rotation.** The glow texture rotates around the UV center over 120 frames (4 seconds at 30fps). |
| 2 | 120f-pos | 0-119 | Position: (0,0,0)→(1,1,0) | **120-frame position scroll.** UV coordinates translate diagonally. |
| 3 | 360f-pos-u | 0-359 | Position: (0,0,0)→(0,1,0) | **360-frame V-axis scroll.** Texture scrolls along V (vertical) over 12 seconds. |
| 4 | 360f-pos-v | 0-359 | Position: (0,0,0)→(1,0,0) | **360-frame U-axis scroll.** Texture scrolls along U (horizontal) over 12 seconds. |
| 5 | 360f-pos-uv | 0-359 | Position: (0,0,0)→(1,1,0) | **360-frame diagonal scroll.** Both U and V scroll simultaneously. |
| 6 | 360f-pos/rot | 0-359 | Position: (0,0,0)→(1,1,0) + Z-rotation: 0→π→2π | **360-frame scroll + rotation.** Combined diagonal scroll and rotation. |
| 7 | 360f-pos/rot-neg | 0-359 | Position: (0,0,0)→(1,1,0) + Z-rotation: 2π→π→0 | **360-frame scroll + counter-rotation.** Same as type 6 but rotation is reversed. |
| 8 | 720f-rot | 0-719 | Z-axis rotation: 0→π→2π | **720-frame rotation.** Very slow rotation over 24 seconds. |

### Implementation Detail

Each animation type is a function that constructs keyframes:

```cpp
// Type 1: 120-frame clockwise rotation
LW_RESULT lwLitAnimTexCoord0(lwIAnimKeySetPRS* ctrl) {
    lwVector3 axis(0.0f, 0.0f, 1.0f);  // Z-axis

    lwKeyQuaternion buf[3];
    buf[0].key = 0;    buf[0].data = AxisAngle(axis, 0.0f);      // Start: 0°
    buf[1].key = 60;   buf[1].data = AxisAngle(axis, PI);        // Middle: 180°
    buf[2].key = 119;  buf[2].data = AxisAngle(axis, 2*PI);      // End: 360°

    ctrl->AddKeyRotation(0, buf, 3);
    return LW_RET_OK;
}
```

All keyframes use `AKST_LINEAR` (linear interpolation). The 3-key rotation pattern (0, PI, 2PI) with a middle key at the halfway point ensures smooth continuous rotation without quaternion shortest-path issues.

### Timing

The game runs at **30 fps** for animation purposes:
- 120 frames = 4 seconds
- 360 frames = 12 seconds
- 720 frames = 24 seconds

### UV Transform Application

The animation produces a 4x4 matrix that transforms UV coordinates. For position-type animations, this is a translation matrix. For rotation types, it's a rotation around the UV origin `(0, 0)` (not the center `(0.5, 0.5)` — this is an important implementation detail).

---

## 19. Scene Effects and the Particle Pipeline

Scene effects tie together particle systems and the data tables that configure them.

### sceneffectinfo.bin Format

```
Per Entry (208 bytes):
    Base CRawDataInfo (108 bytes):
        i32      bExist           // Active flag (1 = valid entry)
        char[72] szDataName       // .par particle file or .eff effect file
        i32      nID              // Scene effect ID

    Derived fields (100 bytes):
        char[16] szName           // Display name
        char[16] szPhotoName      // Icon name
        i32      nPhotoTexID      // Texture ID (internal)
        i32      nEffType         // Effect type (0-2)
        i32      nObjType         // Object type
        i32      nDummyNum        // Number of attachment points (0-8)
        i32[8]   nDummy           // Dummy point IDs (-1 = unused)
        i32      nDummy2          // Secondary dummy
        i32      nHeightOff       // Height offset
        f32      fPlayTime        // Animation duration
        i32      LightID          // Associated glow effect ID
        i32      fBaseSize        // Base scale factor
```

### ID Computation

Scene effect IDs for forge effects are computed as:

```
scene_effect_id = base_effect_id * 10 + effect_level
```

For example, if a weapon's forge effect base ID is `335` and the current tier is `2`, the scene effect ID is `3352`.

### Dummy Point Attachment

The `nDummy` array specifies which dummy points on the character/item the particles attach to. A value of `-1` means "no attachment" (particles spawn at the effect's world position). Multiple dummy points allow particles to emit from different locations on the item.

---

## 20. Effect Attachment: Bones and Dummy Points

Effects can be attached to specific bones or dummy points on characters and items.

### Character Dummy Points

Characters have 16+ predefined attachment points:

| Dummy | ID | Location |
|-------|----|----------|
| dummy_0 | 0 | Head |
| dummy_1 | 1 | Right hand |
| dummy_2 | 2 | Left hand |
| dummy_3 | 3 | Chest |
| dummy_4 | 4 | Back |
| dummy_5 | 5 | Right foot |
| dummy_6 | 6 | Left foot |
| dummy_7 | 7 | Waist |
| ... | ... | ... |

### Bone Binding

`CMPModelEff::BindingBone()` takes a bone's world matrix and applies it as an additional transform:

```cpp
void BindingBone(D3DXMATRIX pmatBone, bool bFollow = false) {
    m_bBindbone = bFollow;
    if (m_bBindbone)
        m_SpmatBone = pmatBone;
    else
        D3DXMatrixIdentity(&m_SpmatBone);
}
```

When `bFollow` is true, the effect follows the bone as it animates (e.g., a fire effect on a character's hand moves with the hand). When false, the bone matrix is only used once to set the initial position.

### Runtime Matrix Retrieval

For effects bound to dummy points, the engine retrieves the dummy's world matrix at runtime:

```cpp
void GetRunningDummyMatrix(D3DXMATRIX* pmat, int idx) {
    if (m_vecEffect[0]->IsItem()) {
        m_vecEffect[0]->m_pCModel->GetObjDummyRunTimeMatrix(
            (lwMatrix44*)pmat, idx);
    }
}
```

This ensures the effect stays correctly positioned even as the character animates.

---

## 21. Shade Effects

Shade effects are a specialized rendering technique for ground shadows and glow projections.

### Shade Vertex Format

Shade effects use a different vertex format with two UV sets:

```cpp
struct SEFFECT_SHADE_VERTEX {
    D3DXVECTOR3 m_SPos;      // Position
    DWORD       m_dwDiffuse; // Color
    D3DXVECTOR2 m_SUV;       // First UV set (shadow texture)
    D3DXVECTOR2 m_SUV2;      // Second UV set (modulation texture)
};
// FVF: D3DFVF_XYZ | D3DFVF_DIFFUSE | D3DFVF_TEX2
```

### Shade Configuration (CShadeInfo)

```cpp
struct CShadeInfo {
    float fSize;          // Shadow size
    bool  bAni;           // Animated?
    int   iRow;           // Sprite sheet rows
    int   iCol;           // Sprite sheet columns
    bool  bAlphaTest;     // Use alpha testing?
    int   iAlphaBlend;    // Blend type
    DWORD dwColor;        // Shadow color (ARGB)
    int   iType;          // 0=static, 1=animated
};
```

### Grid-Based Shade

The shade system supports a grid mesh (`CreateShadeModel`) that can deform to follow terrain. The `iGridCrossNum` parameter controls the grid resolution for more accurate ground projection.

---

## 22. The Resource Manager (CMPResManger)

`CMPResManger` is a singleton that manages all effect resources:

- **Textures**: Loaded by name, cached by ID. `GetTextureID(name)` → `GetTextureByID(id)`.
- **Effect files**: `.fx` shader files loaded as `CMPEffectFile` objects.
- **Effect parameters**: `EffParameter` structs keyed by effect name.
- **Paths**: `CEffPath` objects keyed by path name.
- **Models**: `CEffectModel` geometry objects (pooled for reuse).
- **Timing**: Global delta time pointer (`GetDailTime()`).

When an effect is loaded, `BindingRes()` is called to resolve all resource references:

```cpp
int I_Effect::BoundingRes(CMPResManger* pResMagr) {
    // 1. Load texture
    int texId = pResMagr->GetTextureID(m_CTextruelist.m_vecTexName);
    if (texId < 0) return 1;  // Missing texture

    // 2. Get or create geometry
    CEffectModel* model = pResMagr->GetModel(m_strModelName);
    if (!model) return 2;  // Missing model

    // 3. Load frame textures (if EFFECT_FRAMETEX)
    for (auto& texName : m_CTexFrame.m_vecTexName) {
        int id = pResMagr->GetTextureID(texName);
        m_CTexFrame.m_vecTexs.push_back(pResMagr->GetTextureLw(id));
    }

    return 0;  // Success
}
```

---

## 23. Effect File Version History

| Version | Features Added | Notes |
|---------|----------------|-------|
| 1 | Base format: sub-effects with keyframes, UV coords, textures, geometry | Original release |
| 2 | Cylinder/cone parameters (segments, height, radii) | Added 3D deformable meshes |
| 3 | Per-frame texture names (`frameTexNames`) | Flipbook texture support |
| 4 | Per-frame cylinder parameters (`perFrameCylinder`) | Morphing 3D shapes |
| 5 | `rotaLoop` (continuous arbitrary-axis rotation) | More rotation options |
| 6 | `alpha` (explicit alpha blend flag) | Better blend control |
| 7 | `rotaBoard` (billboard + rotation) | Billboard rotation preservation |

All versions are backward-compatible. When loading an older file, newer fields receive default values (false/0/empty).

---

## Appendix A: D3DBLEND Constants

These are the Direct3D 8/9 blend factors used by both the effect system and the strip system.

| Name | Value | Factor Applied | Description |
|------|-------|----------------|-------------|
| `D3DBLEND_ZERO` | 1 | `(0, 0, 0, 0)` | Multiply by zero. Removes contribution entirely. |
| `D3DBLEND_ONE` | 2 | `(1, 1, 1, 1)` | No scaling. Full contribution. |
| `D3DBLEND_SRCCOLOR` | 3 | `(Rs, Gs, Bs, As)` | Multiply by the source pixel color. |
| `D3DBLEND_INVSRCCOLOR` | 4 | `(1-Rs, 1-Gs, 1-Bs, 1-As)` | Multiply by inverse source color. |
| `D3DBLEND_SRCALPHA` | 5 | `(As, As, As, As)` | Multiply by source alpha. The most common factor. |
| `D3DBLEND_INVSRCALPHA` | 6 | `(1-As, 1-As, 1-As, 1-As)` | Multiply by inverse source alpha. Standard transparency destination. |
| `D3DBLEND_DESTALPHA` | 7 | `(Ad, Ad, Ad, Ad)` | Multiply by destination alpha. |
| `D3DBLEND_INVDESTALPHA` | 8 | `(1-Ad, 1-Ad, 1-Ad, 1-Ad)` | Multiply by inverse destination alpha. |
| `D3DBLEND_DESTCOLOR` | 9 | `(Rd, Gd, Bd, Ad)` | Multiply by destination color. |
| `D3DBLEND_INVDESTCOLOR` | 10 | `(1-Rd, 1-Gd, 1-Bd, 1-Ad)` | Multiply by inverse destination color. |
| `D3DBLEND_SRCALPHASAT` | 11 | `(f, f, f, 1)` where `f = min(As, 1-Ad)` | Clamped source alpha. |
| `D3DBLEND_BOTHSRCALPHA` | 12 | Src=SrcAlpha, Dst=InvSrcAlpha | Legacy shortcut (deprecated). |
| `D3DBLEND_BOTHINVSRCALPHA` | 13 | Src=InvSrcAlpha, Dst=SrcAlpha | Legacy shortcut (deprecated). |

For reference, see: [Microsoft D3DBLEND documentation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dblend)

---

## Appendix B: Effect Type Enum

```cpp
enum EFFECT_TYPE {
    EFFECT_NONE         = 0,  // Static texture, no animation
    EFFECT_FRAMETEX     = 1,  // Per-frame texture switching (flipbook)
    EFFECT_MODELUV      = 2,  // Per-vertex UV coordinate interpolation
    EFFECT_MODELTEXTURE = 3,  // Discrete UV set switching (no interpolation)
    EFFECT_MODEL        = 4,  // 3D model effect (uses model's own rendering)
};
```

### Decision Guide

| I want to... | Use type |
|--------------|----------|
| Show a static glow texture | `EFFECT_NONE (0)` |
| Animate through explosion frames | `EFFECT_FRAMETEX (1)` |
| Smoothly scroll a texture across a surface | `EFFECT_MODELUV (2)` |
| Flip between sprite sheet cells | `EFFECT_MODELTEXTURE (3)` |
| Render a complex 3D model as part of an effect | `EFFECT_MODEL (4)` |

---

## Appendix C: Complete Data Flow Diagrams

### Effect File Loading

```
.eff file on disk
    │
    ├──→ EffFile header (version, path, sound, rotation)
    │
    └──→ SubEffect[0..N]
             │
             ├──→ Keyframe data (sizes, angles, positions, colors)
             ├──→ UV animation data (coordList OR texList)
             ├──→ Texture references (texName, frameTexNames)
             ├──→ Geometry type (modelName)
             └──→ Rendering flags (blend, billboard, alpha, rotaLoop)
```

### Runtime Effect Lifecycle

```
1. LOAD
   CMPModelEff::LoadFromFile("effect.eff")
       ├── Parse header → EffParameter
       └── Parse sub-effects → I_Effect[]

2. BIND
   CMPModelEff::BindingRes(resMgr)
       ├── Resolve textures (name → ID → pointer)
       ├── Resolve geometry (name → CEffectModel)
       ├── Resolve path (name → CEffPath)
       └── Resolve shader technique (idx → CMPEffectFile)

3. PLAY
   CMPModelEff::Play(loopCount)
       └── CEffectCortrol::Play() for each sub-effect

4. FRAME UPDATE (every tick)
   CMPModelEff::FrameMove(deltaTime)
       ├── Advance keyframe timers
       ├── Interpolate size/angle/position/color
       ├── Advance UV/texture animations
       └── Update path position

5. RENDER (every frame)
   CMPModelEff::Render()
       ├── Compute compound transform (scale × rotation × translation)
       ├── Apply bone matrix (if bound)
       ├── Apply path offset (if pathed)
       ├── Set shader technique
       └── For each sub-effect:
           ├── Compute sub-effect transform
           ├── Apply billboard (if enabled)
           ├── Fill vertex buffer (colors, UVs)
           ├── Set blend states
           └── Draw geometry

6. STOP
   CMPModelEff::Stop()
       └── Reset all controllers
```

### Forge Effect Resolution

```
Player equips item with forge stones
    │
    ▼
Item Database
    ├── item_id → ItemRefineInfo.bin
    │       └── stone_effect_category(s1, s2, s3) → category
    │               └── values[category] → refine_effect_id
    │
    ├── refine_effect_id → ItemRefineEffectInfo.bin
    │       ├── light_id → item.lit
    │       │       └── Per-tier glow: texture + anim_type + opacity
    │       │
    │       ├── effect_ids[char_type][tier] → base_effect_id
    │       │       └── scene_effect_id = base_id * 10 + tier
    │       │               └── sceneffectinfo.bin[scene_effect_id]
    │       │                       └── .par filename + dummy points
    │       │
    │       └── dummy_ids[tier] → attachment point on character
    │
    ├── total_level → compute_forge_alpha() → overall opacity
    │
    └── char_type → fChaEffectScale[char_type] → size multiplier
```

---

## Further Reading

- **Direct3D 8/9 Rendering States**: [Microsoft D3DRENDERSTATETYPE](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3drenderstatetype)
- **Alpha Blending Explained**: [LearnOpenGL - Blending](https://learnopengl.com/Advanced-OpenGL/Blending)
- **D3DXMatrixRotationYawPitchRoll**: [Microsoft Docs](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dxmatrixrotationyawpitchroll)
- **Quaternion Rotation**: [3Blue1Brown - Quaternions Visualized](https://www.youtube.com/watch?v=d4EgbgTm0Bg)
- **Billboard Rendering**: [OpenGL Wiki - Billboarding](https://www.khronos.org/opengl/wiki/Billboarding)
- **Vertex Buffer Objects**: [LearnOpenGL - Hello Triangle](https://learnopengl.com/Getting-started/Hello-Triangle) (conceptually similar to D3D vertex buffers)

---

*This document was written by analyzing the PKO game client source code (Engine SDK and Client modules) and the pko-tools Rust/TypeScript reimplementation. All structures, constants, and algorithms are derived from the actual codebase.*
