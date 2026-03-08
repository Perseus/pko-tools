meta:
  id: pko_par
  title: PKO Particle Controller (.par)
  endian: le
  file-extension: par
doc: |
  Binary particle controller format loaded by CMPPartCtrl::LoadFromFile and
  CMPPartSys::LoadFromFile in the PKO client engine.

seq:
  - id: version
    type: u4
    valid:
      min: 2
      max: 15
  - id: part_name
    type: str
    size: 32
    encoding: ASCII
  - id: part_num
    type: s4
  - id: length
    type: f4
    if: version >= 3
  - id: part_systems
    type: part_sys(version)
    repeat: expr
    repeat-expr: part_num
  - id: strip_num
    type: s4
    if: version >= 7
  - id: strips
    type: strip
    repeat: expr
    repeat-expr: strip_num
    if: version >= 7
  - id: model_num
    type: s4
    if: version >= 8
  - id: models
    type: cha_model
    repeat: expr
    repeat-expr: model_num
    if: version >= 8

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

  eff_path_dist_slot:
    seq:
      - id: value
        type: f4
      - id: pad0
        type: f4
      - id: pad1
        type: f4

  eff_path:
    seq:
      - id: frame_count
        type: s4
      - id: vel
        type: f4
      - id: path_points
        type: vec3
        repeat: expr
        repeat-expr: frame_count
      - id: dirs
        type: vec3
        repeat: expr
        repeat-expr: segment_count
      - id: dists
        type: eff_path_dist_slot
        repeat: expr
        repeat-expr: segment_count
    instances:
      segment_count:
        value: 'frame_count > 0 ? frame_count - 1 : 0'

  strip:
    seq:
      - id: max_len
        type: s4
      - id: dummy
        type: s4
        repeat: expr
        repeat-expr: 2
      - id: color
        type: color4f
      - id: life
        type: f4
      - id: step
        type: f4
      - id: tex_name
        type: str
        size: 32
        encoding: ASCII
      - id: src_blend
        type: s4
      - id: dest_blend
        type: s4

  cha_model:
    seq:
      - id: id
        type: s4
      - id: vel
        type: f4
      - id: play_type
        type: s4
      - id: cur_pose
        type: s4
      - id: src_blend
        type: s4
      - id: dest_blend
        type: s4
      - id: cur_color
        type: color4f

  part_sys:
    params:
      - id: version
        type: u4
    seq:
      - id: type
        type: s4
      - id: part_name
        type: str
        size: 32
        encoding: ASCII
      - id: par_num
        type: s4
      - id: tex_name
        type: str
        size: 32
        encoding: ASCII
      - id: model_name
        type: str
        size: 32
        encoding: ASCII
      - id: range
        type: f4
        repeat: expr
        repeat-expr: 3
      - id: frame_count
        type: u2
      - id: frame_size
        type: f4
        repeat: expr
        repeat-expr: frame_count
      - id: frame_angle
        type: vec3
        repeat: expr
        repeat-expr: frame_count
      - id: frame_color
        type: color4f
        repeat: expr
        repeat-expr: frame_count
      - id: billboard
        type: u1
      - id: src_blend
        type: s4
      - id: dest_blend
        type: s4
      - id: min_filter
        type: s4
      - id: mag_filter
        type: s4
      - id: life
        type: f4
      - id: vecl
        type: f4
      - id: dir
        type: vec3
      - id: accel
        type: vec3
      - id: step
        type: f4
      - id: model_range_flag
        type: u1
        if: version > 3
      - id: model_range_name
        type: str
        size: 32
        encoding: ASCII
        if: version > 3
      - id: offset
        type: vec3
        if: version > 4
      - id: delay_time
        type: f4
        if: version > 5
      - id: play_time
        type: f4
        if: version > 5
      - id: use_path
        type: u1
        if: version > 8
      - id: path
        type: eff_path
        if: version > 8 and use_path != 0
      - id: shade
        type: u1
        if: version > 9
      - id: hit_eff_name
        type: str
        size: 32
        encoding: ASCII
        if: version > 10
      - id: point_range_count
        type: u2
        if: version > 11 and model_range_flag != 0
      - id: point_ranges
        type: vec3
        repeat: expr
        repeat-expr: point_range_count
        if: version > 11 and model_range_flag != 0
      - id: roadom
        type: s4
        if: version > 12
      - id: model_dir
        type: u1
        if: version > 13
      - id: mediay
        type: u1
        if: version > 14
