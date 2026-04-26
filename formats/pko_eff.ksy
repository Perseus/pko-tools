meta:
  id: pko_eff
  title: PKO Model Effect Set (.eff)
  endian: le
  file-extension: eff
doc: |
  Binary model-effect format loaded by CMPResManger::LoadEffectFromFile and
  I_Effect::LoadFromFile in the PKO client engine.

seq:
  - id: version
    type: u4
    doc: "Format version (1-7). Controls which optional fields are present."
  - id: idx_tech
    type: s4
    doc: "Technique/shader index (-1 = default, 0+ = custom shader ID)"
  - id: use_path
    type: u1
    doc: "If nonzero, effect follows a path trajectory"
  - id: path_name
    type: str
    size: 32
    encoding: ASCII
    doc: "Path filename (null-padded, used when use_path != 0)"
  - id: use_sound
    type: u1
    doc: "If nonzero, effect has associated sound"
  - id: sound_name
    type: str
    size: 32
    encoding: ASCII
    doc: "Sound filename (null-padded, used when use_sound != 0)"
  - id: rotating
    type: u1
    doc: "If nonzero, effect continuously rotates around rota_axis"
  - id: rota_axis
    type: vec3
    doc: "Rotation axis vector (normalized) for continuous rotation"
  - id: rota_vel
    type: f4
    doc: "Rotation velocity in radians/second"
  - id: effect_count
    type: s4
    doc: "Number of sub-effects in this file"
  - id: effects
    type: effect(version)
    repeat: expr
    repeat-expr: effect_count
    doc: "Array of sub-effect definitions"

enums:
  effect_type:
    0:
      id: none
      doc: "No effect (placeholder)"
    1:
      id: frametex
      doc: "Frame-based texture animation"
    2:
      id: modeluv
      doc: "Model with UV animation"
    3:
      id: modeltexture
      doc: "Model with texture animation"
    4:
      id: model
      doc: "Model-based effect (mesh geometry)"

  d3d_blend_mode:
    1:
      id: zero
      doc: "Blend factor is (0, 0, 0, 0)"
    2:
      id: one
      doc: "Blend factor is (1, 1, 1, 1)"
    3:
      id: src_color
      doc: "Blend factor is (Rs, Gs, Bs, As)"
    4:
      id: inv_src_color
      doc: "Blend factor is (1-Rs, 1-Gs, 1-Bs, 1-As)"
    5:
      id: src_alpha
      doc: "Blend factor is (As, As, As, As)"
    6:
      id: inv_src_alpha
      doc: "Blend factor is (1-As, 1-As, 1-As, 1-As)"
    7:
      id: dest_alpha
      doc: "Blend factor is (Ad, Ad, Ad, Ad)"
    8:
      id: inv_dest_alpha
      doc: "Blend factor is (1-Ad, 1-Ad, 1-Ad, 1-Ad)"
    9:
      id: dest_color
      doc: "Blend factor is (Rd, Gd, Bd, Ad)"
    10:
      id: inv_dest_color
      doc: "Blend factor is (1-Rd, 1-Gd, 1-Bd, 1-Ad)"

types:
  vec2:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4

  vec3:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4

  vec4:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4
      - id: w
        type: f4

  color4f:
    doc: "RGBA color with float components (0.0-1.0 range)"
    seq:
      - id: r
        type: f4
      - id: g
        type: f4
      - id: b
        type: f4
      - id: a
        type: f4

  cylinder_param:
    doc: "Per-keyframe cylinder/cone geometry parameters for deformable effects"
    seq:
      - id: segments
        type: s4
        doc: "Number of sides (radial segments)"
      - id: hei
        type: f4
        doc: "Height"
      - id: top_radius
        type: f4
        doc: "Top radius"
      - id: bottom_radius
        type: f4
        doc: "Bottom radius"

  texcoord_coord_set:
    doc: "UV coordinates for one animation frame"
    params:
      - id: ver_count
        type: u2
    seq:
      - id: coords
        type: vec2
        repeat: expr
        repeat-expr: ver_count

  tex_list_entry:
    doc: "Texture UV data for one animation frame"
    params:
      - id: ver_count
        type: u2
    seq:
      - id: coords
        type: vec2
        repeat: expr
        repeat-expr: ver_count

  effect:
    params:
      - id: version
        type: u4
    seq:
      - id: effect_name
        type: str
        size: 32
        encoding: ASCII
        doc: "Unique name for this sub-effect (null-padded to 32 bytes)"
      - id: effect_type
        type: s4
        enum: effect_type
        doc: "Effect rendering type — determines how geometry and textures are combined"
      - id: src_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D source blend factor. Default: src_alpha(5)"
      - id: dest_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D destination blend factor. Default: inv_src_alpha(6)"
      - id: length
        type: f4
        doc: "Effect duration in seconds"
      - id: frame_count
        type: u2
        doc: "Number of animation keyframes"
      - id: frame_time
        type: f4
        repeat: expr
        repeat-expr: frame_count
        doc: "Duration of each keyframe in seconds"
      - id: frame_size
        type: vec3
        repeat: expr
        repeat-expr: frame_count
        doc: "Scale factors (X,Y,Z) at each keyframe"
      - id: frame_angle
        type: vec3
        repeat: expr
        repeat-expr: frame_count
        doc: "Rotation angles (pitch, yaw, roll in radians) at each keyframe"
      - id: frame_pos
        type: vec3
        repeat: expr
        repeat-expr: frame_count
        doc: "Position offset (X,Y,Z) at each keyframe"
      - id: frame_color
        type: color4f
        repeat: expr
        repeat-expr: frame_count
        doc: "RGBA diffuse color at each keyframe (0.0-1.0)"
      - id: texcoord_ver_count
        type: u2
        doc: "Number of vertices in UV animation"
      - id: texcoord_coord_count
        type: u2
        doc: "Number of UV animation frames"
      - id: texcoord_frame_time
        type: f4
        doc: "Duration per UV animation frame in seconds"
      - id: texcoord_lists
        type: texcoord_coord_set(texcoord_ver_count)
        repeat: expr
        repeat-expr: texcoord_coord_count
        doc: "UV coordinates for each animation frame"
      - id: tex_count
        type: u2
        doc: "Number of texture animation frames"
      - id: tex_frame_time
        type: f4
        doc: "Duration per texture animation frame in seconds"
      - id: tex_name
        type: str
        size: 32
        encoding: ASCII
        doc: "Base texture filename (null-padded)"
      - id: tex_lists
        type: tex_list_entry(texcoord_ver_count)
        repeat: expr
        repeat-expr: tex_count
        doc: "Texture UV data for each animation frame"
      - id: model_name
        type: str
        size: 32
        encoding: ASCII
        doc: "Mesh type string (Triangle, TrianglePlane, Rect, RectPlane, Cylinder, Cone, Sphere) or .lgo file path"
      - id: billboard
        type: u1
        doc: "Billboard mode: 0 = world-oriented, 1 = camera-facing"
      - id: vs_index
        type: s4
        doc: "Vertex shader index: 0 = default, 1 = model, 2 = billboard"
      - id: n_segments
        type: s4
        if: version > 1
        doc: "Number of sides for cylinder/cone geometry (v2+)"
      - id: r_height
        type: f4
        if: version > 1
        doc: "Height of cylinder/cone geometry (v2+)"
      - id: r_radius
        type: f4
        if: version > 1
        doc: "Top radius of cylinder/cone (v2+)"
      - id: r_bot_radius
        type: f4
        if: version > 1
        doc: "Bottom radius of cylinder/cone (v2+)"
      - id: texframe_count
        type: u2
        if: version > 2
        doc: "Number of texture frame animations (v3+)"
      - id: texframe_time_a
        type: f4
        if: version > 2
        doc: "Duration per texture frame start (v3+)"
      - id: texframe_names
        type: str
        size: 32
        encoding: ASCII
        repeat: expr
        repeat-expr: texframe_count
        if: version > 2
        doc: "Texture frame filenames (v3+)"
      - id: texframe_time_b
        type: f4
        if: version > 2
        doc: "Duration per texture frame end for blending (v3+)"
      - id: use_param
        type: s4
        if: version > 3
        doc: "If > 0, cylinder deformation params are present per keyframe (v4+)"
      - id: cylinder_params
        type: cylinder_param
        repeat: expr
        repeat-expr: frame_count
        if: version > 3 and use_param > 0
        doc: "Per-keyframe cylinder geometry parameters (v4+)"
      - id: rota_loop
        type: u1
        if: version > 4
        doc: "If nonzero, continuous rotation loop enabled (v5+)"
      - id: rota_loop_v
        type: vec4
        if: version > 4
        doc: "Rotation loop axis (X,Y,Z) and angular velocity (W) (v5+)"
      - id: alpha
        type: u1
        if: version > 5
        doc: "If nonzero, alpha blending enabled (v6+)"
      - id: rota_board
        type: u1
        if: version > 6
        doc: "If nonzero, billboard rotates with effect (v7+)"
