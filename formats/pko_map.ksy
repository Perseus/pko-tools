meta:
  id: pko_map
  title: PKO terrain map
  endian: le
  file-extension: map
doc: |
  Derived from MPMapData.cpp and MPMapDef.h.
  Layout:
  1) MPMapFileHeader
  2) Section offset table (u4 * sectionCount)
  3) Section tile blobs referenced by offsets

seq:
  - id: header
    type: map_header
  - id: section_index
    type: section_ptr((header.n_section_width * header.n_section_height), header.n_map_flag)
    repeat: expr
    repeat-expr: (header.n_width / header.n_section_width) * (header.n_height / header.n_section_height)

types:
  map_header:
    seq:
      - id: n_map_flag
        type: s4
      - id: n_width
        type: s4
      - id: n_height
        type: s4
      - id: n_section_width
        type: s4
      - id: n_section_height
        type: s4

  section_ptr:
    params:
      - id: tile_count
        type: s4
      - id: map_flag
        type: s4
    seq:
      - id: offset
        type: u4
    instances:
      section:
        io: _root._io
        pos: offset
        if: offset != 0
        type:
          switch-on: map_flag
          cases:
            780626: section_old(tile_count)
            780627: section_new(tile_count)

  section_new:
    params:
      - id: tile_count
        type: s4
    seq:
      - id: tiles
        type: tile_new
        repeat: expr
        repeat-expr: tile_count

  section_old:
    params:
      - id: tile_count
        type: s4
    seq:
      - id: tiles
        type: tile_old
        repeat: expr
        repeat-expr: tile_count

  tile_new:
    seq:
      - id: dw_tile_info
        type: u4
      - id: bt_tile_info
        type: u1
      - id: s_color_565
        type: u2
      - id: c_height
        type: s1
      - id: s_region
        type: s2
      - id: bt_island
        type: u1
      - id: bt_block
        type: u1
        repeat: expr
        repeat-expr: 4
    instances:
      tex0:
        value: bt_tile_info
      alpha0:
        value: 15
      tex1:
        value: (dw_tile_info >> 26) & 63
      alpha1:
        value: (dw_tile_info >> 22) & 15
      tex2:
        value: (dw_tile_info >> 16) & 63
      alpha2:
        value: (dw_tile_info >> 12) & 15
      tex3:
        value: (dw_tile_info >> 6) & 63
      alpha3:
        value: (dw_tile_info >> 2) & 15
      height_m:
        value: c_height * 0.1

  tile_old:
    seq:
      - id: t
        type: u1
        repeat: expr
        repeat-expr: 8
      - id: s_height
        type: s2
      - id: dw_color
        type: u4
      - id: s_region
        type: s2
      - id: bt_island
        type: u1
      - id: bt_block
        type: u1
        repeat: expr
        repeat-expr: 4
    instances:
      tex0:
        value: t[0]
      alpha0:
        value: t[1]
      tex1:
        value: t[2]
      alpha1:
        value: t[3]
      tex2:
        value: t[4]
      alpha2:
        value: t[5]
      tex3:
        value: t[6]
      alpha3:
        value: t[7]
      height_m:
        value: s_height / 100.0
