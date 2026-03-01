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
  - id: entries
    type: terrain_info_entry
    repeat: eos

instances:
  has_expected_record_size:
    value: record_size == 120
  entry_count:
    value: entries.size

types:
  terrain_info_entry:
    seq:
      - id: b_exist_raw
        type: u4
      - id: n_index
        type: s4
      - id: sz_data_name
        type: str
        size: 72
        encoding: ASCII
        terminator: 0
        pad-right: 0
      - id: dw_last_use_tick
        type: u4
      - id: b_enable_raw
        type: u4
      - id: p_data
        type: u4
      - id: dw_pack_offset
        type: u4
      - id: dw_data_size
        type: u4
      - id: n_id
        type: s4
      - id: dw_load_cnt
        type: u4
      - id: bt_type
        type: u1
      - id: pad_after_type
        size: 3
      - id: n_texture_id
        type: s4
      - id: bt_attr
        type: u1
      - id: pad_after_attr
        size: 3
    instances:
      b_exist:
        value: b_exist_raw != 0
      b_enable:
        value: b_enable_raw != 0
      is_underwater_type:
        value: bt_type == 1
