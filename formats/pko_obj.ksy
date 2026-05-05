meta:
  id: pko_obj
  title: PKO Scene Object Placement (.obj)
  endian: le
  file-extension: obj
doc: |
  Binary scene-object placement format loaded by CSceneObjFile::Load()
  in the PKO client engine.

  Layout:
    - 44-byte header (title[16], version, file_size, section dims, section_obj_num)
    - Section index: section_cnt_x * section_cnt_y x (offset:s4, count:s4)
    - Per section at offset: count x 20-byte MSVC-aligned SSceneObjInfo records

  The 20-byte record size comes from MSVC default struct alignment (no #pragma pack):
    sTypeID(s2) + 2 pad + nX(s4) + nY(s4) + sHeightOff(s2) + sYawAngle(s2) + sScale(s2) + 2 pad

  Inspector note:
    Placement records are not top-level. They live under:
      section_index[i].objects
    Most section entries are empty, so in a viewer you usually want to find a
    section entry where count > 0 (or has_objects == true), then expand its
    objects array.

seq:
  - id: title
    size: 16
    doc: "File header -- 16-byte magic 'HF Object File!'"
  - id: version
    type: s4
    doc: "Format version (100-600)"
  - id: file_size
    type: s4
    doc: "Total file size in bytes"
  - id: section_cnt_x
    type: s4
    doc: "Number of sections horizontally"
  - id: section_cnt_y
    type: s4
    doc: "Number of sections vertically"
  - id: section_width
    type: s4
    doc: "Section width in tiles (typically 8)"
  - id: section_height
    type: s4
    doc: "Section height in tiles (typically 8)"
  - id: section_obj_num
    type: s4
    doc: "Maximum objects per section (typically 25)"
  - id: section_index
    type: section_index_entry
    repeat: expr
    repeat-expr: section_cnt_x * section_cnt_y

types:
  section_index_entry:
    seq:
      - id: offset
        type: s4
        doc: "File offset to object data for this section (-1 if empty)"
      - id: count
        type: s4
        doc: "Number of objects in this section"
    instances:
      section_no:
        value: _index
      section_index_x:
        value: _index % _root.section_cnt_x
      section_index_y:
        value: _index / _root.section_cnt_x
      has_objects:
        value: offset > 0 and count > 0
      section_origin_x_cm:
        value: section_index_x * _root.section_width * 100
      section_origin_y_cm:
        value: section_index_y * _root.section_height * 100
      first_object:
        pos: offset
        type: scene_obj_info(this)
        if: offset > 0 and count > 0
      objects:
        pos: offset
        type: scene_obj_info(this)
        repeat: expr
        repeat-expr: count
        if: offset > 0 and count > 0

  scene_obj_info:
    params:
      - id: section
        type: section_index_entry
    doc: |
      SSceneObjInfo -- 20-byte MSVC-aligned record.
      sTypeID top 2 bits = type (0=model, 1=effect), lower 14 = ID.
    seq:
      - id: type_id
        type: s2
        doc: "Bitpacked: top 2 bits = type (0=model, 1=effect), lower 14 bits = object ID"
      - id: pad1
        size: 2
        doc: "MSVC struct alignment padding"
      - id: nx
        type: s4
        doc: "X coordinate relative to section origin (tile units)"
      - id: ny
        type: s4
        doc: "Y coordinate relative to section origin (tile units)"
      - id: height_off
        type: s2
        doc: "Height offset from terrain"
      - id: yaw_angle
        type: s2
        doc: "Yaw rotation angle (degrees)"
      - id: scale
        type: s2
        doc: "Scale factor (reserved, currently unused)"
      - id: pad2
        size: 2
        doc: "MSVC struct alignment padding"
    instances:
      obj_type:
        value: (type_id & 0xffff) >> 14
      obj_id:
        value: type_id & 0x3fff
      world_x:
        value: (nx + section.section_origin_x_cm) / 100.0
      world_y:
        value: (ny + section.section_origin_y_cm) / 100.0
      world_z:
        value: height_off / 100.0
