meta:
  id: pko_lmo
  title: PKO LMO Object-Table Container
  endian: le
  file-extension: lmo
doc: |
  Root parser for the lwModelObjInfo-style LMO container.
  This phase decodes the object table and slices chunk payloads using
  absolute offsets (addr/size), matching client loader behavior.

seq:
  - id: version
    type: u4
  - id: obj_num
    type: u4
  - id: model_info_descriptor
    size: 64
    if: is_model_info_tree
  - id: model_info_obj_num
    type: u4
    if: is_model_info_tree
  - id: model_nodes
    type: model_node_info(tree_version)
    repeat: expr
    repeat-expr: tree_obj_num
    if: is_model_info_tree
  - id: objects
    type: object_entry
    repeat: expr
    repeat-expr: obj_num
    if: not is_model_info_tree

instances:
  descriptor_magic:
    pos: 8
    size: 11
    type: str
    encoding: ASCII
    if: _io.size >= 19
  is_model_info_tree:
    value: 'descriptor_magic == "lwModelInfo"'
  tree_mask:
    value: version
    if: is_model_info_tree
  tree_version:
    value: obj_num
    if: is_model_info_tree
  tree_obj_num:
    value: model_info_obj_num
    if: is_model_info_tree

types:
  model_node_head_info:
    seq:
      - id: handle
        type: u4
      - id: type
        type: u4
        valid:
          any-of: [1, 2, 3, 4]
      - id: id
        type: u4
      - id: descriptor
        size: 64
      - id: parent_handle
        type: u4
      - id: link_parent_id
        type: u4
      - id: link_id
        type: u4

  helper_dummy_obj_info:
    seq:
      - id: id
        type: u4
      - id: mat
        type: matrix44
      - id: anim_data_flag
        type: u4
      - id: anim_data
        type: anim_data_matrix
        if: anim_data_flag == 1

  model_node_info:
    params:
      - id: file_version
        type: u4
    seq:
      - id: head
        type: model_node_head_info
      - id: node_primitive
        type: geometry_chunk(file_version, 0)
        if: head.type == 1
      - id: node_bonectrl
        type: anim_data_bone(file_version)
        if: head.type == 2
      - id: node_dummy
        type: helper_dummy_obj_info
        if: head.type == 3
      - id: node_helper
        type: helper_section(file_version)
        if: head.type == 4

  object_entry:
    seq:
      - id: type
        type: u4
        valid:
          any-of: [1, 2]
      - id: addr
        type: u4
      - id: size
        type: u4
    instances:
      body_geometry:
        pos: addr
        size: size
        if: type == 1
        type: geometry_chunk(_root.version, 1)
      body_helper:
        pos: addr
        size: size
        if: type == 2
        type: helper_section(_root.version)

  geometry_chunk:
    params:
      - id: file_version
        type: u4
      - id: has_outer_legacy_prefix
        type: u1
    seq:
      - id: legacy_prefix
        type: u4
        if: file_version == 0 and has_outer_legacy_prefix != 0
      - id: header
        type: geom_obj_info_header(file_version, chunk_payload_size, header_offset)
      - id: material
        type: material_section(file_version)
        size: header.mtl_size
        if: header.mtl_size > 0
      - id: mesh
        type: mesh_section(file_version)
        size: header.mesh_size
        if: header.mesh_size > 0
      - id: helper
        type: helper_section(file_version)
        size: header.helper_size
        if: header.helper_size > 0
      - id: anim
        type: anim_section(file_version)
        size: header.anim_size
        if: header.anim_size > 0
    instances:
      chunk_payload_size:
        value: 'file_version == 0 and has_outer_legacy_prefix != 0 ? _io.size - 4 : _io.size'
      header_offset:
        value: 'file_version == 0 and has_outer_legacy_prefix != 0 ? 4 : 0'

  material_section:
    params:
      - id: file_version
        type: u4
    seq:
      - id: legacy_prefix
        type: u4
        if: has_legacy_prefix
      - id: mtl_num
        type: u4
      - id: mtl_entries
        type: mtl_entry(format_hint)
        repeat: expr
        repeat-expr: mtl_num
      - id: legacy_extra_mtl_seq
        type: material
        repeat: expr
        repeat-expr: mtl_num
        if: legacy_extra_mtl_possible
      - id: payload
        size-eos: true
    instances:
      first_u4:
        pos: 0
        type: u4
      second_u4:
        pos: 4
        type: u4
        if: _io.size >= 8
      known_version_marker:
        value: 'first_u4 == 0 or first_u4 == 1 or first_u4 == 2 or first_u4 == 4096 or first_u4 == 4097 or first_u4 == 4098 or first_u4 == 4099 or first_u4 == 4100 or first_u4 == 4101'
      has_legacy_prefix:
        value: 'file_version == 0 and _io.size >= 8 and known_version_marker and second_u4 <= 65535'
      effective_version:
        value: 'file_version == 0 ? (has_legacy_prefix ? legacy_prefix : 4096) : file_version'
      format_hint:
        value: 'effective_version == 0 ? 0 : (effective_version == 1 ? 1 : (effective_version == 2 ? 2 : 1000))'
      legacy_extra_mtl_possible:
        value: 'file_version == 0 and not has_legacy_prefix and format_hint == 1000 and (_io.size - _io.pos) == mtl_num * 68'

  mesh_section:
    params:
      - id: file_version
        type: u4
    seq:
      - id: legacy_prefix
        type: u4
        if: file_version == 0
      - id: header_v0000
        type: mesh_header_v0000
        if: header_kind == 0
      - id: header_v0003
        type: mesh_header_v0003
        if: header_kind == 1
      - id: header_v1004
        type: mesh_header_v1004
        if: header_kind == 2
      - id: subset_seq_old
        type: subset_info
        repeat: expr
        repeat-expr: subset_num
        if: header_kind != 2
      - id: vertex_element_seq
        type: vertex_element
        repeat: expr
        repeat-expr: vertex_element_num
        if: header_kind == 2 and vertex_element_num > 0
      - id: vertex_seq
        type: vector3
        repeat: expr
        repeat-expr: vertex_num
        if: vertex_num > 0
      - id: normal_seq
        type: vector3
        repeat: expr
        repeat-expr: vertex_num
        if: has_normals
      - id: texcoord_seq
        type: texcoord_channel(vertex_num)
        repeat: expr
        repeat-expr: texcoord_set_count
      - id: vercol_seq
        type: u4
        repeat: expr
        repeat-expr: vertex_num
        if: has_diffuse
      - id: blend_seq
        type: blend_info
        repeat: expr
        repeat-expr: vertex_num
        if: has_blend_data
      - id: bone_index_seq_u4
        type: u4
        repeat: expr
        repeat-expr: bone_index_num
        if: header_kind == 2 and bone_index_num > 0
      - id: bone_index_seq_u1
        type: u1
        repeat: expr
        repeat-expr: bone_index_num
        if: header_kind != 2 and has_lastbeta_ubyte4 and bone_index_num > 0
      - id: legacy_pre_index_u4
        type: u4
        repeat: expr
        repeat-expr: 2
        if: has_legacy_pre_index_pair
      - id: index_seq
        type: u4
        repeat: expr
        repeat-expr: index_num
        if: index_num > 0
      - id: subset_seq_new
        type: subset_info
        repeat: expr
        repeat-expr: subset_num
        if: header_kind == 2
    instances:
      effective_version:
        value: 'file_version == 0 ? legacy_prefix : file_version'
      header_kind:
        value: 'effective_version == 0 ? 0 : (effective_version == 1 ? 1 : (effective_version >= 4096 ? (effective_version >= 4100 ? 2 : 1) : 255))'
      fvf:
        value: 'header_kind == 0 ? header_v0000.fvf : (header_kind == 1 ? header_v0003.fvf : header_v1004.fvf)'
      vertex_num:
        value: 'header_kind == 0 ? header_v0000.vertex_num : (header_kind == 1 ? header_v0003.vertex_num : header_v1004.vertex_num)'
      index_num:
        value: 'header_kind == 0 ? header_v0000.index_num : (header_kind == 1 ? header_v0003.index_num : header_v1004.index_num)'
      subset_num:
        value: 'header_kind == 0 ? header_v0000.subset_num : (header_kind == 1 ? header_v0003.subset_num : header_v1004.subset_num)'
      bone_index_num:
        value: 'header_kind == 0 ? header_v0000.bone_index_num : (header_kind == 1 ? header_v0003.bone_index_num : header_v1004.bone_index_num)'
      vertex_element_num:
        value: 'header_kind == 2 ? header_v1004.vertex_element_num : 0'
      texcoord_set_count_raw:
        value: '(fvf & 3840) >> 8'
      texcoord_set_count:
        value: 'texcoord_set_count_raw > 4 ? 4 : texcoord_set_count_raw'
      has_normals:
        value: '(fvf & 16) != 0'
      has_diffuse:
        value: '(fvf & 64) != 0'
      has_lastbeta_ubyte4:
        value: '(fvf & 4096) != 0'
      has_blend_data:
        value: 'header_kind == 2 ? bone_index_num > 0 : has_lastbeta_ubyte4'
      has_legacy_pre_index_pair:
        value: 'header_kind == 0 and (_io.size - _io.pos) == (index_num * 4 + 8)'

  helper_section:
    params:
      - id: file_version
        type: u4
    seq:
      - id: legacy_prefix
        type: u4
        if: file_version == 0
      - id: helper_type
        type: u4
      - id: dummy_num
        type: u4
        if: (helper_type & 1) != 0
      - id: dummy_seq
        type: helper_dummy_entry(effective_version)
        repeat: expr
        repeat-expr: dummy_num
        if: (helper_type & 1) != 0
      - id: box_num
        type: u4
        if: (helper_type & 2) != 0
      - id: box_seq
        type: helper_box_info
        repeat: expr
        repeat-expr: box_num
        if: (helper_type & 2) != 0
      - id: mesh_num
        type: u4
        if: (helper_type & 4) != 0
      - id: mesh_seq
        type: helper_mesh_info
        repeat: expr
        repeat-expr: mesh_num
        if: (helper_type & 4) != 0
      - id: bbox_num
        type: u4
        if: (helper_type & 16) != 0
      - id: bbox_seq
        type: bounding_box_info
        repeat: expr
        repeat-expr: bbox_num
        if: (helper_type & 16) != 0
      - id: bsphere_num
        type: u4
        if: (helper_type & 32) != 0
      - id: bsphere_seq
        type: bounding_sphere_info
        repeat: expr
        repeat-expr: bsphere_num
        if: (helper_type & 32) != 0
    instances:
      effective_version:
        value: 'file_version == 0 ? legacy_prefix : file_version'

  anim_section:
    params:
      - id: file_version
        type: u4
    seq:
      - id: legacy_prefix
        type: u4
        if: file_version == 0
      - id: data_bone_size
        type: u4
      - id: data_mat_size
        type: u4
      - id: data_mtlopac_size
        type: u4
        repeat: expr
        repeat-expr: 16
        if: file_version >= 4101
      - id: data_texuv_size
        type: u4
        repeat: expr
        repeat-expr: 64
      - id: data_teximg_size
        type: u4
        repeat: expr
        repeat-expr: 64
      - id: anim_bone
        type: anim_data_bone(file_version)
        size: data_bone_size
        if: data_bone_size > 0
      - id: anim_mat
        type: anim_data_matrix
        size: data_mat_size
        if: data_mat_size > 0
      - id: anim_mtlopac
        type: anim_data_mtlopac_slot(data_mtlopac_size[_index])
        repeat: expr
        repeat-expr: 16
        if: file_version >= 4101
      - id: anim_texuv
        type: anim_data_texuv_slot(data_texuv_size[_index])
        repeat: expr
        repeat-expr: 64
      - id: anim_teximg
        type: anim_data_teximg_slot(data_teximg_size[_index], file_version)
        repeat: expr
        repeat-expr: 64

  geom_obj_info_header:
    params:
      - id: file_version
        type: u4
      - id: chunk_payload_size
        type: u4
      - id: header_offset
        type: u4
    seq:
      - id: legacy
        type: geom_obj_info_header_legacy
        if: header_kind == 0
      - id: modern
        type: geom_obj_info_header_modern
        if: header_kind == 1
    instances:
      legacy_mtl_size_probe:
        pos: header_offset + 76
        type: u4
      legacy_mesh_size_probe:
        pos: header_offset + 80
        type: u4
      legacy_helper_size_probe:
        pos: header_offset + 84
        type: u4
      legacy_anim_size_probe:
        pos: header_offset + 88
        type: u4
      modern_mtl_size_probe:
        pos: header_offset + 100
        type: u4
      modern_mesh_size_probe:
        pos: header_offset + 104
        type: u4
      modern_helper_size_probe:
        pos: header_offset + 108
        type: u4
      modern_anim_size_probe:
        pos: header_offset + 112
        type: u4
      legacy_plausible:
        value: 'legacy_mtl_size_probe + legacy_mesh_size_probe + legacy_helper_size_probe + legacy_anim_size_probe <= chunk_payload_size'
      modern_plausible:
        value: 'modern_mtl_size_probe + modern_mesh_size_probe + modern_helper_size_probe + modern_anim_size_probe <= chunk_payload_size'
      header_kind:
        value: 'file_version == 0 ? (modern_plausible ? 1 : 0) : 1'
      id:
        value: 'header_kind == 0 ? legacy.id : modern.id'
      parent_id:
        value: 'header_kind == 0 ? legacy.parent_id : modern.parent_id'
      geom_type:
        value: 'header_kind == 0 ? legacy.geom_type : modern.geom_type'
      mat_local:
        value: 'header_kind == 0 ? legacy.mat_local : modern.mat_local'
      mtl_size:
        value: 'header_kind == 0 ? legacy.mtl_size : modern.mtl_size'
      mesh_size:
        value: 'header_kind == 0 ? legacy.mesh_size : modern.mesh_size'
      helper_size:
        value: 'header_kind == 0 ? legacy.helper_size : modern.helper_size'
      anim_size:
        value: 'header_kind == 0 ? legacy.anim_size : modern.anim_size'

  geom_obj_info_header_legacy:
    seq:
      - id: id
        type: u4
      - id: parent_id
        type: u4
      - id: geom_type
        type: u4
      - id: mat_local
        type: matrix44
      - id: mtl_size
        type: u4
      - id: mesh_size
        type: u4
      - id: helper_size
        type: u4
      - id: anim_size
        type: u4

  geom_obj_info_header_modern:
    seq:
      - id: id
        type: u4
      - id: parent_id
        type: u4
      - id: geom_type
        type: u4
      - id: mat_local
        type: matrix44
      - id: rcci
        type: render_ctrl_create_info
      - id: state_ctrl
        type: state_ctrl
      - id: mtl_size
        type: u4
      - id: mesh_size
        type: u4
      - id: helper_size
        type: u4
      - id: anim_size
        type: u4

  render_ctrl_create_info:
    seq:
      - id: ctrl_id
        type: u4
      - id: decl_id
        type: u4
      - id: vs_id
        type: u4
      - id: ps_id
        type: u4

  state_ctrl:
    seq:
      - id: state_seq
        size: 8

  render_state_atom:
    seq:
      - id: state
        type: u4
      - id: value0
        type: u4
      - id: value1
        type: u4

  render_state_value:
    seq:
      - id: state
        type: u4
      - id: value
        type: u4

  render_state_set_2_8:
    seq:
      - id: values
        type: render_state_value
        repeat: expr
        repeat-expr: 16

  color_value_4f:
    seq:
      - id: r
        type: f4
      - id: g
        type: f4
      - id: b
        type: f4
      - id: a
        type: f4

  color_value_4b:
    seq:
      - id: b
        type: u1
      - id: g
        type: u1
      - id: r
        type: u1
      - id: a
        type: u1

  material:
    seq:
      - id: dif
        type: color_value_4f
      - id: amb
        type: color_value_4f
      - id: spe
        type: color_value_4f
      - id: emi
        type: color_value_4f
      - id: power
        type: f4

  tex_info_current:
    seq:
      - id: stage
        type: u4
      - id: level
        type: u4
      - id: usage
        type: u4
      - id: format
        type: u4
      - id: pool
        type: u4
      - id: byte_alignment_flag
        type: u4
      - id: tex_type
        type: u4
      - id: width
        type: u4
      - id: height
        type: u4
      - id: colorkey_type
        type: u4
      - id: colorkey
        type: color_value_4b
      - id: file_name
        size: 64
      - id: data_ptr
        type: u4
      - id: tss_set
        type: render_state_atom
        repeat: expr
        repeat-expr: 8

  tex_info_0000:
    seq:
      - id: stage
        type: u4
      - id: colorkey_type
        type: u4
      - id: colorkey
        type: color_value_4b
      - id: format
        type: u4
      - id: file_name
        size: 64
      - id: tss_set
        type: render_state_set_2_8

  tex_info_0001:
    seq:
      - id: stage
        type: u4
      - id: level
        type: u4
      - id: usage
        type: u4
      - id: format
        type: u4
      - id: pool
        type: u4
      - id: byte_alignment_flag
        type: u4
      - id: tex_type
        type: u4
      - id: width
        type: u4
      - id: height
        type: u4
      - id: colorkey_type
        type: u4
      - id: colorkey
        type: color_value_4b
      - id: file_name
        size: 64
      - id: data_ptr
        type: u4
      - id: tss_set
        type: render_state_set_2_8

  mtl_tex_info_current:
    seq:
      - id: opacity
        type: f4
      - id: transp_type
        type: u4
      - id: mtl
        type: material
      - id: rs_set
        type: render_state_atom
        repeat: expr
        repeat-expr: 8
      - id: tex_seq
        type: tex_info_current
        repeat: expr
        repeat-expr: 4

  mtl_tex_info_0000:
    seq:
      - id: mtl
        type: material
      - id: rs_set
        type: render_state_set_2_8
      - id: tex_seq
        type: tex_info_0000
        repeat: expr
        repeat-expr: 4

  mtl_tex_info_0001:
    seq:
      - id: opacity
        type: f4
      - id: transp_type
        type: u4
      - id: mtl
        type: material
      - id: rs_set
        type: render_state_set_2_8
      - id: tex_seq
        type: tex_info_0001
        repeat: expr
        repeat-expr: 4

  mtl_entry:
    params:
      - id: format_hint
        type: u4
    seq:
      - id: as_0000
        type: mtl_tex_info_0000
        if: format_hint == 0
      - id: as_0001
        type: mtl_tex_info_0001
        if: format_hint == 1
      - id: as_current
        type: mtl_tex_info_current
        if: format_hint != 0 and format_hint != 1

  mesh_header_v0000:
    seq:
      - id: fvf
        type: u4
      - id: pt_type
        type: u4
      - id: vertex_num
        type: u4
      - id: index_num
        type: u4
      - id: subset_num
        type: u4
      - id: bone_index_num
        type: u4
      - id: rs_set
        size: 128

  mesh_header_v0003:
    seq:
      - id: fvf
        type: u4
      - id: pt_type
        type: u4
      - id: vertex_num
        type: u4
      - id: index_num
        type: u4
      - id: subset_num
        type: u4
      - id: bone_index_num
        type: u4
      - id: rs_set
        type: render_state_atom
        repeat: expr
        repeat-expr: 8

  mesh_header_v1004:
    seq:
      - id: fvf
        type: u4
      - id: pt_type
        type: u4
      - id: vertex_num
        type: u4
      - id: index_num
        type: u4
      - id: subset_num
        type: u4
      - id: bone_index_num
        type: u4
      - id: bone_infl_factor
        type: u4
      - id: vertex_element_num
        type: u4
      - id: rs_set
        type: render_state_atom
        repeat: expr
        repeat-expr: 8

  matrix44:
    seq:
      - id: m11
        type: f4
      - id: m12
        type: f4
      - id: m13
        type: f4
      - id: m14
        type: f4
      - id: m21
        type: f4
      - id: m22
        type: f4
      - id: m23
        type: f4
      - id: m24
        type: f4
      - id: m31
        type: f4
      - id: m32
        type: f4
      - id: m33
        type: f4
      - id: m34
        type: f4
      - id: m41
        type: f4
      - id: m42
        type: f4
      - id: m43
        type: f4
      - id: m44
        type: f4

  matrix43:
    seq:
      - id: m11
        type: f4
      - id: m12
        type: f4
      - id: m13
        type: f4
      - id: m21
        type: f4
      - id: m22
        type: f4
      - id: m23
        type: f4
      - id: m31
        type: f4
      - id: m32
        type: f4
      - id: m33
        type: f4
      - id: m41
        type: f4
      - id: m42
        type: f4
      - id: m43
        type: f4

  vector3:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4

  vector2:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4

  texcoord_channel:
    params:
      - id: vertex_num
        type: u4
    seq:
      - id: values
        type: vector2
        repeat: expr
        repeat-expr: vertex_num

  blend_info:
    seq:
      - id: index_dword
        type: u4
      - id: weight
        type: f4
        repeat: expr
        repeat-expr: 4

  subset_info:
    seq:
      - id: primitive_num
        type: u4
      - id: start_index
        type: u4
      - id: vertex_num
        type: u4
      - id: min_index
        type: u4

  vertex_element:
    seq:
      - id: stream
        type: u2
      - id: offset
        type: u2
      - id: elem_type
        type: u1
      - id: method
        type: u1
      - id: usage
        type: u1
      - id: usage_index
        type: u1

  quaternion:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4
      - id: w
        type: f4

  plane:
    seq:
      - id: a
        type: f4
      - id: b
        type: f4
      - id: c
        type: f4
      - id: d
        type: f4

  box:
    seq:
      - id: center
        type: vector3
      - id: radius
        type: vector3

  sphere:
    seq:
      - id: center
        type: vector3
      - id: radius
        type: f4

  helper_dummy_entry:
    params:
      - id: effective_version
        type: u4
    seq:
      - id: as_1000
        type: helper_dummy_info_1000
        if: effective_version <= 4096
      - id: as_current
        type: helper_dummy_info
        if: effective_version >= 4097

  helper_dummy_info_1000:
    seq:
      - id: id
        type: u4
      - id: mat
        type: matrix44

  helper_dummy_info:
    seq:
      - id: id
        type: u4
      - id: mat
        type: matrix44
      - id: mat_local
        type: matrix44
      - id: parent_type
        type: u4
      - id: parent_id
        type: u4

  helper_box_info:
    seq:
      - id: id
        type: u4
      - id: type
        type: u4
      - id: state
        type: u4
      - id: box
        type: box
      - id: mat
        type: matrix44
      - id: name
        size: 32

  helper_mesh_face_info:
    seq:
      - id: vertex
        type: u4
        repeat: expr
        repeat-expr: 3
      - id: adj_face
        type: u4
        repeat: expr
        repeat-expr: 3
      - id: plane
        type: plane
      - id: center
        type: vector3

  helper_mesh_info:
    seq:
      - id: id
        type: u4
      - id: type
        type: u4
      - id: sub_type
        type: u4
      - id: name
        size: 32
      - id: state
        type: u4
      - id: mat
        type: matrix44
      - id: box
        type: box
      - id: vertex_num
        type: u4
      - id: face_num
        type: u4
      - id: vertex_seq
        type: vector3
        repeat: expr
        repeat-expr: vertex_num
      - id: face_seq
        type: helper_mesh_face_info
        repeat: expr
        repeat-expr: face_num

  bounding_box_info:
    seq:
      - id: id
        type: u4
      - id: box
        type: box
      - id: mat
        type: matrix44

  bounding_sphere_info:
    seq:
      - id: id
        type: u4
      - id: sphere
        type: sphere
      - id: mat
        type: matrix44

  bone_info_header:
    seq:
      - id: bone_num
        type: u4
      - id: frame_num
        type: u4
      - id: dummy_num
        type: u4
      - id: key_type
        type: u4

  bone_base_info:
    seq:
      - id: name
        size: 64
      - id: id
        type: u4
      - id: parent_id
        type: u4

  bone_dummy_info:
    seq:
      - id: id
        type: u4
      - id: parent_bone_id
        type: u4
      - id: mat
        type: matrix44

  bone_key_info:
    params:
      - id: key_type
        type: u4
      - id: frame_num
        type: u4
      - id: version
        type: u4
      - id: parent_id
        type: u4
    seq:
      - id: mat43_seq
        type: matrix43
        repeat: expr
        repeat-expr: frame_num
        if: key_type == 1
      - id: mat44_seq
        type: matrix44
        repeat: expr
        repeat-expr: frame_num
        if: key_type == 2
      - id: pos_seq
        type: vector3
        repeat: expr
        repeat-expr: pos_num
        if: key_type == 3
      - id: quat_seq
        type: quaternion
        repeat: expr
        repeat-expr: frame_num
        if: key_type == 3
    instances:
      pos_num:
        value: 'version >= 4099 ? frame_num : (parent_id == 4294967295 ? frame_num : 1)'

  anim_data_bone:
    params:
      - id: version
        type: u4
    seq:
      - id: legacy_prefix
        type: u4
        if: version == 0
      - id: header
        type: bone_info_header
      - id: base_seq
        type: bone_base_info
        repeat: expr
        repeat-expr: header.bone_num
      - id: invmat_seq
        type: matrix44
        repeat: expr
        repeat-expr: header.bone_num
      - id: dummy_seq
        type: bone_dummy_info
        repeat: expr
        repeat-expr: header.dummy_num
      - id: key_seq
        type: bone_key_info(header.key_type, header.frame_num, version, base_seq[_index].parent_id)
        repeat: expr
        repeat-expr: header.bone_num

  anim_data_matrix:
    seq:
      - id: frame_num
        type: u4
      - id: mat_seq
        type: matrix43
        repeat: expr
        repeat-expr: frame_num

  key_float:
    seq:
      - id: key
        type: u4
      - id: slerp_type
        type: u4
      - id: data
        type: f4

  anim_data_mtl_opacity:
    seq:
      - id: key_num
        type: u4
      - id: key_seq
        type: key_float
        repeat: expr
        repeat-expr: key_num

  anim_data_texuv:
    seq:
      - id: frame_num
        type: u4
      - id: mat_seq
        type: matrix44
        repeat: expr
        repeat-expr: frame_num

  anim_data_teximg:
    params:
      - id: version
        type: u4
    seq:
      - id: legacy_payload
        size-eos: true
        if: version == 0
      - id: data_num
        type: u4
        if: version != 0
      - id: data_seq
        type: tex_info_current
        repeat: expr
        repeat-expr: data_num
        if: version != 0

  anim_data_mtlopac_slot:
    params:
      - id: blob_size
        type: u4
    seq:
      - id: data
        type: anim_data_mtl_opacity
        size: blob_size
        if: blob_size > 0

  anim_data_texuv_slot:
    params:
      - id: blob_size
        type: u4
    seq:
      - id: data
        type: anim_data_texuv
        size: blob_size
        if: blob_size > 0

  anim_data_teximg_slot:
    params:
      - id: blob_size
        type: u4
      - id: version
        type: u4
    seq:
      - id: data
        type: anim_data_teximg(version)
        size: blob_size
        if: blob_size > 0
