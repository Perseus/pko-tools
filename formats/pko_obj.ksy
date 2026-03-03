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
    - Section index: section_cnt_x * section_cnt_y × (offset:s4, count:s4)
    - Per section at offset: count × 20-byte MSVC-aligned SSceneObjInfo records

  The 20-byte record size comes from MSVC default struct alignment (no #pragma pack):
    sTypeID(s2) + 2 pad + nX(s4) + nY(s4) + sHeightOff(s2) + sYawAngle(s2) + sScale(s2) + 2 pad

seq:
  - id: title
    size: 16
  - id: version
    type: s4
  - id: file_size
    type: s4
  - id: section_cnt_x
    type: s4
  - id: section_cnt_y
    type: s4
  - id: section_width
    type: s4
  - id: section_height
    type: s4
  - id: section_obj_num
    type: s4
  - id: section_index
    type: section_index_entry
    repeat: expr
    repeat-expr: section_cnt_x * section_cnt_y

types:
  section_index_entry:
    seq:
      - id: offset
        type: s4
      - id: count
        type: s4

  scene_obj_info:
    doc: |
      SSceneObjInfo — 20-byte MSVC-aligned record.
      sTypeID top 2 bits = type (0=model, 1=effect), lower 14 = ID.
    seq:
      - id: type_id
        type: s2
      - id: pad1
        size: 2
      - id: nx
        type: s4
      - id: ny
        type: s4
      - id: height_off
        type: s2
      - id: yaw_angle
        type: s2
      - id: scale
        type: s2
      - id: pad2
        size: 2
