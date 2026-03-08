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
  - id: idx_tech
    type: s4
  - id: use_path
    type: u1
  - id: path_name
    type: str
    size: 32
    encoding: ASCII
  - id: use_sound
    type: u1
  - id: sound_name
    type: str
    size: 32
    encoding: ASCII
  - id: rotating
    type: u1
  - id: rota_axis
    type: vec3
  - id: rota_vel
    type: f4
  - id: effect_count
    type: s4
  - id: effects
    type: effect(version)
    repeat: expr
    repeat-expr: effect_count

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
    seq:
      - id: segments
        type: s4
      - id: hei
        type: f4
      - id: top_radius
        type: f4
      - id: bottom_radius
        type: f4

  texcoord_coord_set:
    params:
      - id: ver_count
        type: u2
    seq:
      - id: coords
        type: vec2
        repeat: expr
        repeat-expr: ver_count

  tex_list_entry:
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
      - id: effect_type
        type: s4
      - id: src_blend
        type: s4
      - id: dest_blend
        type: s4
      - id: length
        type: f4
      - id: frame_count
        type: u2
      - id: frame_time
        type: f4
        repeat: expr
        repeat-expr: frame_count
      - id: frame_size
        type: vec3
        repeat: expr
        repeat-expr: frame_count
      - id: frame_angle
        type: vec3
        repeat: expr
        repeat-expr: frame_count
      - id: frame_pos
        type: vec3
        repeat: expr
        repeat-expr: frame_count
      - id: frame_color
        type: color4f
        repeat: expr
        repeat-expr: frame_count
      - id: texcoord_ver_count
        type: u2
      - id: texcoord_coord_count
        type: u2
      - id: texcoord_frame_time
        type: f4
      - id: texcoord_lists
        type: texcoord_coord_set(texcoord_ver_count)
        repeat: expr
        repeat-expr: texcoord_coord_count
      - id: tex_count
        type: u2
      - id: tex_frame_time
        type: f4
      - id: tex_name
        type: str
        size: 32
        encoding: ASCII
      - id: tex_lists
        type: tex_list_entry(texcoord_ver_count)
        repeat: expr
        repeat-expr: tex_count
      - id: model_name
        type: str
        size: 32
        encoding: ASCII
      - id: billboard
        type: u1
      - id: vs_index
        type: s4
      - id: n_segments
        type: s4
        if: version > 1
      - id: r_height
        type: f4
        if: version > 1
      - id: r_radius
        type: f4
        if: version > 1
      - id: r_bot_radius
        type: f4
        if: version > 1
      - id: texframe_count
        type: u2
        if: version > 2
      - id: texframe_time_a
        type: f4
        if: version > 2
      - id: texframe_names
        type: str
        size: 32
        encoding: ASCII
        repeat: expr
        repeat-expr: texframe_count
        if: version > 2
      - id: texframe_time_b
        type: f4
        if: version > 2
      - id: use_param
        type: s4
        if: version > 3
      - id: cylinder_params
        type: cylinder_param
        repeat: expr
        repeat-expr: frame_count
        if: version > 3 and use_param > 0
      - id: rota_loop
        type: u1
        if: version > 4
      - id: rota_loop_v
        type: vec4
        if: version > 4
      - id: alpha
        type: u1
        if: version > 5
      - id: rota_board
        type: u1
        if: version > 6
