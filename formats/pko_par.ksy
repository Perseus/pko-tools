meta:
  id: pko_par
  title: PKO Particle Controller (.par)
  endian: le
  file-extension: par
doc: |
  Binary particle controller format loaded by CMPPartCtrl::LoadFromFile and
  CMPPartSys::LoadFromFile in the PKO client engine.
  Controls particle emitters, strip/ribbon trails, and embedded model attachments.
doc-ref: "MPParticleCtrl.h, MPParticleSys.h, MPParticleSys.cpp"

seq:
  - id: version
    type: u4
    valid:
      min: 2
      max: 15
    doc: "Format version. Controls which fields are present (v3+ adds length, v7+ strips, v8+ models, v9+ paths, etc.)"
  - id: part_name
    type: str
    size: 32
    encoding: ASCII
    doc: "Particle controller name (null-padded to 32 bytes)"
  - id: part_num
    type: s4
    doc: "Number of particle systems (emitters) in this controller"
  - id: length
    type: f4
    if: version >= 3
    doc: "Total duration of the particle effect in seconds"
  - id: part_systems
    type: part_sys(version)
    repeat: expr
    repeat-expr: part_num
    doc: "Array of particle system emitter definitions"
  - id: strip_num
    type: s4
    if: version >= 7
    doc: "Number of strip/ribbon trail emitters"
  - id: strips
    type: strip
    repeat: expr
    repeat-expr: strip_num
    if: version >= 7
    doc: "Array of strip/ribbon trail definitions (e.g., weapon swing trails)"
  - id: model_num
    type: s4
    if: version >= 8
    doc: "Number of embedded 3D model attachments"
  - id: models
    type: cha_model
    repeat: expr
    repeat-expr: model_num
    if: version >= 8
    doc: "Array of embedded model definitions (e.g., spinning weapon models in effects)"

enums:
  particle_system_type:
    1:
      id: snow
      doc: "Falling snow particles"
    2:
      id: fire
      doc: "Rising fire/flame particles"
    3:
      id: blast
      doc: "Radial explosion burst"
    4:
      id: ripple
      doc: "Expanding ripple rings (water/impact)"
    5:
      id: model
      doc: "3D model used as particle (e.g., spinning debris)"
    6:
      id: strip
      doc: "Strip/ribbon trail particle"
    7:
      id: wind
      doc: "Wind-blown directional particles"
    8:
      id: arrow
      doc: "Projectile/arrow trajectory particle"
    9:
      id: round
      doc: "Circular orbit particles"
    10:
      id: blast2
      doc: "Explosion variant 2"
    11:
      id: blast3
      doc: "Explosion variant 3"
    12:
      id: shrink
      doc: "Particles that shrink over lifetime"
    13:
      id: shade
      doc: "Ground shadow/shade projection"
    14:
      id: range
      doc: "Range-based area emitter"
    15:
      id: range2
      doc: "Range-based area emitter variant 2"
    16:
      id: dummy
      doc: "Invisible/placeholder emitter (used for timing)"
    17:
      id: line_single
      doc: "Single straight-line particle trail"
    18:
      id: line_round
      doc: "Circular line trail"

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

  d3d_texture_filter:
    0:
      id: none
      doc: "No filtering (mipmapping disabled for this stage)"
    1:
      id: point
      doc: "Nearest-neighbor (point) sampling"
    2:
      id: linear
      doc: "Bilinear interpolation"
    3:
      id: anisotropic
      doc: "Anisotropic filtering (higher quality at oblique angles)"

  animation_play_type:
    0:
      id: invalid
      doc: "No animation / invalid state"
    1:
      id: once
      doc: "Play animation once then stop"
    2:
      id: loop
      doc: "Loop animation continuously"
    3:
      id: frame
      doc: "Hold on a specific frame"
    4:
      id: once_smooth
      doc: "Play once with smooth interpolation"
    5:
      id: loop_smooth
      doc: "Loop with smooth interpolation"
    6:
      id: pause
      doc: "Pause at current frame"
    7:
      id: continue_play
      doc: "Continue from current position"

types:
  vec2:
    doc: "2D float vector"
    seq:
      - id: x
        type: f4
      - id: y
        type: f4

  vec3:
    doc: "3D float vector"
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4

  color4f:
    doc: "RGBA color with float components (0.0-1.0 range)"
    seq:
      - id: r
        type: f4
        doc: "Red component (0.0-1.0)"
      - id: g
        type: f4
        doc: "Green component (0.0-1.0)"
      - id: b
        type: f4
        doc: "Blue component (0.0-1.0)"
      - id: a
        type: f4
        doc: "Alpha component (0.0 = transparent, 1.0 = opaque)"

  eff_path_dist_slot:
    doc: "Distance slot for effect path segments. Only the value field is used; pad fields are reserved."
    seq:
      - id: value
        type: f4
        doc: "Cumulative distance along the path at this segment"
      - id: pad0
        type: f4
        doc: "Reserved/unused"
      - id: pad1
        type: f4
        doc: "Reserved/unused"

  eff_path:
    doc: "Spline path that particles follow. Defines control points, directions, and segment distances."
    seq:
      - id: frame_count
        type: s4
        doc: "Number of path control points"
      - id: vel
        type: f4
        doc: "Movement velocity along the path (units/second)"
      - id: path_points
        type: vec3
        repeat: expr
        repeat-expr: frame_count
        doc: "Control point positions in 3D space"
      - id: dirs
        type: vec3
        repeat: expr
        repeat-expr: segment_count
        doc: "Direction vectors between consecutive control points"
      - id: dists
        type: eff_path_dist_slot
        repeat: expr
        repeat-expr: segment_count
        doc: "Cumulative distance along each path segment"
    instances:
      segment_count:
        value: 'frame_count > 0 ? frame_count - 1 : 0'
        doc: "Number of segments = control points - 1"

  strip:
    doc: "Strip/ribbon trail definition. Creates a trailing ribbon behind moving objects (e.g., weapon swing trails, magic streaks)."
    seq:
      - id: max_len
        type: s4
        doc: "Maximum number of trail segments to keep before oldest are removed"
      - id: dummy
        type: s4
        repeat: expr
        repeat-expr: 2
        doc: "Dummy bone attachment indices (start and end points on the skeleton)"
      - id: color
        type: color4f
        doc: "Base color/tint of the strip trail"
      - id: life
        type: f4
        doc: "How long each trail segment lives before fading (seconds)"
      - id: step
        type: f4
        doc: "Minimum distance between trail sample points (world units)"
      - id: tex_name
        type: str
        size: 32
        encoding: ASCII
        doc: "Texture filename for the strip surface (null-padded, relative to texture/effect/)"
      - id: src_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D source blend factor for alpha blending (typically src_alpha=5)"
      - id: dest_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D destination blend factor for alpha blending (typically one=2 for additive)"

  cha_model:
    doc: "Embedded 3D model attachment. Renders a .lgo model as part of the effect (e.g., orbiting weapons, spinning objects)."
    seq:
      - id: id
        type: s4
        doc: "Model ID reference (indexes into the effect's model table)"
      - id: vel
        type: f4
        doc: "Rotation/animation velocity (radians/second or playback speed)"
      - id: play_type
        type: s4
        enum: animation_play_type
        doc: "Animation playback mode for the embedded model"
      - id: cur_pose
        type: s4
        doc: "Initial animation frame/pose index"
      - id: src_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D source blend factor for the model's alpha blending"
      - id: dest_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D destination blend factor for the model's alpha blending"
      - id: cur_color
        type: color4f
        doc: "Color tint applied to the model (multiplied with texture color)"

  part_sys:
    doc: "Particle system (emitter) definition. Controls spawn behavior, appearance, physics, and lifetime of particles."
    doc-ref: "MPParticleSys.h, MPParticleSys.cpp::LoadFromFile"
    params:
      - id: version
        type: u4
    seq:
      - id: type
        type: s4
        enum: particle_system_type
        doc: "Emitter behavior type — determines spawn pattern and movement logic"
      - id: part_name
        type: str
        size: 32
        encoding: ASCII
        doc: "Particle system name (null-padded, for editor/debug identification)"
      - id: par_num
        type: s4
        doc: "Maximum number of live particles this emitter can have simultaneously"
      - id: tex_name
        type: str
        size: 32
        encoding: ASCII
        doc: "Texture filename for particles (null-padded, relative to texture/effect/)"
      - id: model_name
        type: str
        size: 32
        encoding: ASCII
        doc: "Model filename if type=model (null-padded, relative to model/effect/). Empty for non-model types."
      - id: range
        type: f4
        repeat: expr
        repeat-expr: 3
        doc: "Spawn volume dimensions [width, height, depth] — particles spawn randomly within this box"
      - id: frame_count
        type: u2
        doc: "Number of keyframes for size/angle/color animation over particle lifetime"
      - id: frame_size
        type: f4
        repeat: expr
        repeat-expr: frame_count
        doc: "Keyframed particle size (billboard scale) at each frame over lifetime"
      - id: frame_angle
        type: vec3
        repeat: expr
        repeat-expr: frame_count
        doc: "Keyframed rotation angles (euler XYZ in radians) at each frame over lifetime"
      - id: frame_color
        type: color4f
        repeat: expr
        repeat-expr: frame_count
        doc: "Keyframed RGBA color at each frame over lifetime (particles interpolate between these)"
      - id: billboard
        type: u1
        doc: "Billboard mode: 0 = world-oriented quad, 1 = camera-facing billboard"
      - id: src_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D source blend factor. Common: src_alpha(5) for normal alpha, one(2) for additive glow"
      - id: dest_blend
        type: s4
        enum: d3d_blend_mode
        doc: "D3D destination blend factor. Common: inv_src_alpha(6) for normal alpha, one(2) for additive"
      - id: min_filter
        type: s4
        enum: d3d_texture_filter
        doc: "Texture minification filter (used when texture is smaller than screen pixels)"
      - id: mag_filter
        type: s4
        enum: d3d_texture_filter
        doc: "Texture magnification filter (used when texture is larger than screen pixels)"
      - id: life
        type: f4
        doc: "Lifetime of each particle in seconds (particle is removed after this duration)"
      - id: vecl
        type: f4
        doc: "Initial velocity magnitude (speed) of emitted particles"
      - id: dir
        type: vec3
        doc: "Initial emission direction vector (combined with vecl for initial velocity)"
      - id: accel
        type: vec3
        doc: "Acceleration vector applied each frame (e.g., gravity = [0, -9.8, 0])"
      - id: step
        type: f4
        doc: "Time interval between particle spawns (seconds). Lower = more particles"
      - id: model_range_flag
        type: u1
        if: version > 3
        doc: "If nonzero, particles spawn from vertices of a named model instead of the range box"
      - id: model_range_name
        type: str
        size: 32
        encoding: ASCII
        if: version > 3
        doc: "Model filename whose vertices define spawn positions (used when model_range_flag != 0)"
      - id: offset
        type: vec3
        if: version > 4
        doc: "Position offset from the effect's origin (local space translation)"
      - id: delay_time
        type: f4
        if: version > 5
        doc: "Delay before this emitter starts spawning particles (seconds after effect begins)"
      - id: play_time
        type: f4
        if: version > 5
        doc: "Duration this emitter actively spawns particles (seconds). 0 = use controller length."
      - id: use_path
        type: u1
        if: version > 8
        doc: "If nonzero, particles follow the spline path defined below"
      - id: path
        type: eff_path
        if: version > 8 and use_path != 0
        doc: "Spline path that particles travel along (only present if use_path != 0)"
      - id: shade
        type: u1
        if: version > 9
        doc: "If nonzero, renders a projected ground shadow beneath the particle"
      - id: hit_eff_name
        type: str
        size: 32
        encoding: ASCII
        if: version > 10
        doc: "Effect filename triggered on particle hit/collision (null-padded). Used for impact sparks, etc."
      - id: point_range_count
        type: u2
        if: version > 11 and model_range_flag != 0
        doc: "Number of explicit spawn point positions (alternative to model vertex spawning)"
      - id: point_ranges
        type: vec3
        repeat: expr
        repeat-expr: point_range_count
        if: version > 11 and model_range_flag != 0
        doc: "Explicit spawn point positions in local space"
      - id: roadom
        type: s4
        if: version > 12
        doc: "Random variation factor for particle spawn parameters (velocity, size, etc.)"
      - id: model_dir
        type: u1
        if: version > 13
        doc: "If nonzero, particle quads orient to face their movement direction instead of the camera"
      - id: mediay
        type: u1
        if: version > 14
        doc: "If nonzero, clamps particle Y position to the median Y of the emitter (ground-hugging effect)"
