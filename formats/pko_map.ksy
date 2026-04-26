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
doc-ref: "MPMapData.cpp, MPMapDef.h, MPTile.h"

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
        doc: "File format version. 780626 = old format (21 bytes/tile), 780627 = new format (15 bytes/tile)"
      - id: n_width
        type: s4
        doc: "Map width in tiles"
      - id: n_height
        type: s4
        doc: "Map height in tiles"
      - id: n_section_width
        type: s4
        doc: "Section width in tiles (typically 8)"
      - id: n_section_height
        type: s4
        doc: "Section height in tiles (typically 8)"

  section_ptr:
    params:
      - id: tile_count
        type: s4
      - id: map_flag
        type: s4
    seq:
      - id: offset
        type: u4
        doc: "Absolute file offset to this section's tile data (0 = empty section)"
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
    doc: "New format tile (15 bytes). Packed texture layers, RGB565 color, 1-byte height."
    seq:
      - id: dw_tile_info
        type: u4
        doc: "Packed texture layers 1-3 + alpha values. Bits [26:32) tex1, [22:26) alpha1, [16:22) tex2, [12:16) alpha2, [6:12) tex3, [2:6) alpha3"
      - id: bt_tile_info
        type: u1
        doc: "Texture layer 0 ID (0-255). Base texture of the 4-layer stack"
      - id: s_color_565
        type: u2
        doc: "Vertex color in RGB565 format. R[11:16), G[5:11), B[0:5)"
      - id: c_height
        type: s1
        doc: "Tile height (signed). Each unit = 0.1 meters. Range: -12.8m to +12.7m"
      - id: s_region
        type: s2
        doc: "Region membership bitmask. Bit N = region N+1. 0 = water/unassigned"
      - id: bt_island
        type: u1
        doc: "Island index for navigation (0-200). 0 = not part of any island"
      - id: bt_block
        type: u1
        doc: "Obstacle flags for 4 sub-tiles (NW, NE, SW, SE). Bit 7 = blocked, bits 0-6 = height offset"
        repeat: expr
        repeat-expr: 4
    instances:
      tex0:
        value: bt_tile_info
        doc: "Base texture ID"
      alpha0:
        value: 15
        doc: "Base texture alpha (always 15)"
      tex1:
        value: (dw_tile_info >> 26) & 63
        doc: "Texture layer 1 ID (0-63)"
      alpha1:
        value: (dw_tile_info >> 22) & 15
        doc: "Alpha blend for layer 1 (0-15)"
      tex2:
        value: (dw_tile_info >> 16) & 63
        doc: "Texture layer 2 ID (0-63)"
      alpha2:
        value: (dw_tile_info >> 12) & 15
        doc: "Alpha blend for layer 2 (0-15)"
      tex3:
        value: (dw_tile_info >> 6) & 63
        doc: "Texture layer 3 ID (0-63)"
      alpha3:
        value: (dw_tile_info >> 2) & 15
        doc: "Alpha blend for layer 3 (0-15)"
      height_m:
        value: c_height * 0.1
        doc: "Height in meters (c_height * 0.1)"

  tile_old:
    doc: "Old format tile (21 bytes). Explicit texture/alpha bytes, RGB8888 color, 2-byte height."
    seq:
      - id: t
        type: u1
        doc: "8-byte texture/alpha array: [tex0, alpha0, tex1, alpha1, tex2, alpha2, tex3, alpha3]"
        repeat: expr
        repeat-expr: 8
      - id: s_height
        type: s2
        doc: "Tile height in centimeters (signed 16-bit). Range: -327.68m to +327.68m"
      - id: dw_color
        type: u4
        doc: "Vertex color in ARGB8888 format (little-endian)"
      - id: s_region
        type: s2
        doc: "Region membership bitmask (same as tile_new)"
      - id: bt_island
        type: u1
        doc: "Island index for navigation (same as tile_new)"
      - id: bt_block
        type: u1
        doc: "Obstacle flags for 4 sub-tiles (same as tile_new)"
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
        doc: "Height in meters (s_height / 100.0)"
