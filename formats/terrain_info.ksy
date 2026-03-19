meta:
  id: terrain_info
  title: PKO TerrainInfo Table
  endian: le
  file-extension: bin
doc: |
  Binary table used by MPTerrainSet::LoadRawDataInfo("scripts/table/TerrainInfo", ...).
  The file layout is:
  1) u4 record_size (sizeof(MPTerrainInfo))
  2) repeated MPTerrainInfo records to EOF

  For the original 32-bit client, record_size is 120 bytes.
  Important: terrain IDs are stored in each entry as `n_id` and are 1-based in this file.
  The Kaitai `entries` array is 0-based, so `entries[21]` has `n_id = 22`.
  Struct source:
  - CRawDataInfo in Common/common/include/TableData.h
  - MPTerrainInfo in engine/sdk/include/MPTerrainSet.h

seq:
  - id: record_size
    type: u4
    doc: "Size in bytes of each record (sizeof(MPTerrainInfo) = 120)"
  - id: entries
    type: terrain_info_entry
    repeat: eos
    doc: "Array of terrain info records until end-of-stream"

instances:
  has_expected_record_size:
    value: record_size == 120
  entry_count:
    value: entries.size

enums:
  terrain_type:
    0:
      id: normal
      doc: "Walkable land terrain"
    1:
      id: underwater
      doc: "Underwater surface (special shading and physics)"

types:
  terrain_info_entry:
    doc: "MPTerrainInfo record (120 bytes). CRawDataInfo base (108 bytes) + terrain fields (12 bytes)."
    seq:
      - id: b_exist_raw
        type: u4
        doc: "Whether this record is active (nonzero = yes)"
      - id: n_index
        type: s4
        doc: "Array index within the terrain data set"
      - id: sz_data_name
        type: str
        size: 72
        encoding: ASCII
        terminator: 0
        pad-right: 0
        doc: "Terrain asset name (e.g., 'grass_01', 'sand_01', 'water')"
      - id: dw_last_use_tick
        type: u4
        doc: "Last-access tick count (runtime only, always 0 in file)"
      - id: b_enable_raw
        type: u4
        doc: "Whether record is enabled (nonzero = yes)"
      - id: p_data
        type: u4
        doc: "Runtime data pointer (always 0 in serialized file)"
      - id: dw_pack_offset
        type: u4
        doc: "Offset into pack file (unused)"
      - id: dw_data_size
        type: u4
        doc: "Original data file size (unused)"
      - id: n_id
        type: s4
        doc: "Terrain ID (primary key, 1-based)"
      - id: dw_load_cnt
        type: u4
        doc: "Resource load count (runtime only)"
      - id: bt_type
        type: u1
        enum: terrain_type
        doc: "Terrain surface type"
      - id: pad_after_type
        size: 3
        doc: "MSVC struct alignment padding"
      - id: n_texture_id
        type: s4
        doc: "Texture resource ID -- index into global texture manager"
      - id: bt_attr
        type: u1
        doc: "Terrain attribute flags (walkability, collision properties)"
      - id: pad_after_attr
        size: 3
        doc: "MSVC struct alignment padding"
    instances:
      b_exist:
        value: b_exist_raw != 0
        doc: "Boolean: record is active"
      b_enable:
        value: b_enable_raw != 0
        doc: "Boolean: record is enabled"
      is_underwater_type:
        value: bt_type == terrain_type::underwater
        doc: "Boolean: terrain is underwater type"
