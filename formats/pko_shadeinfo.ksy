meta:
  id: pko_shadeinfo
  title: PKO ShadeInfo Table
  endian: le
  file-extension: bin
doc: |
  Binary table used by CShadeInfoMgr::Load("scripts/table/shadeinfo", ...).
  The file layout is:
  1) u4 record_size (sizeof(CShadeInfo) = 172)
  2) repeated CShadeInfo records to EOF

  For the original 32-bit client, record_size is 172 bytes.
  Important: shade IDs are stored in each entry as `n_id` and are 1-based in this file.
  The Kaitai `entries` array is 0-based, so `entries[0]` has `n_id = 1`.
  Struct source:
  - CRawDataInfo in Common/common/include/TableData.h
  - CShadeInfo in Client/src/EffectSet.h:246-287

seq:
  - id: record_size
    type: u4
    doc: "Size in bytes of each record (sizeof(CShadeInfo) = 172)"
  - id: entries
    type: shade_info_entry
    repeat: eos
    doc: "Array of shade info records until end-of-stream"

instances:
  has_expected_record_size:
    value: record_size == 172
  entry_count:
    value: entries.size

types:
  shade_info_entry:
    doc: "CShadeInfo record (172 bytes). CRawDataInfo base (108 bytes) + CShadeInfo fields (64 bytes)."
    seq:
      - id: b_exist_raw
        type: u4
        doc: "Whether this record is active (nonzero = yes)"
      - id: n_index
        type: s4
        doc: "Array index within the shade data set"
      - id: sz_data_name
        type: str
        size: 72
        encoding: ASCII
        terminator: 0
        pad-right: 0
        doc: "Texture resource name (e.g., 'shade_circle', 'shade_aoe')"
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
        doc: "Shade ID (primary key, 1-based)"
      - id: dw_load_cnt
        type: u4
        doc: "Resource load count (runtime only)"
      - id: sz_name
        type: str
        size: 16
        encoding: ASCII
        terminator: 0
        pad-right: 0
        doc: "Display name for this shade entry"
      - id: n_photo_tex_id
        type: s4
        doc: "Photo texture ID reference"
      - id: f_size
        type: f4
        doc: "Radius of the shade in world units"
      - id: n_ani
        type: s4
        doc: "Animated flag (0=static, nonzero=animated)"
      - id: n_row
        type: s4
        doc: "Number of rows in sprite sheet grid"
      - id: n_col
        type: s4
        doc: "Number of columns in sprite sheet grid"
      - id: n_use_alpha_test
        type: s4
        doc: "Whether to use alpha test (0=no, nonzero=yes)"
      - id: n_alpha_type
        type: s4
        doc: "Alpha blend mode (0=standard, 1=additive, 2=screen)"
      - id: n_color_r
        type: s4
        doc: "Red color component (0-255)"
      - id: n_color_g
        type: s4
        doc: "Green color component (0-255)"
      - id: n_color_b
        type: s4
        doc: "Blue color component (0-255)"
      - id: n_color_a
        type: s4
        doc: "Alpha color component (0-255)"
      - id: n_type
        type: s4
        doc: "Shade type (0=character shadow, 1=effect)"
    instances:
      b_exist:
        value: b_exist_raw != 0
        doc: "Boolean: record is active"
      b_enable:
        value: b_enable_raw != 0
        doc: "Boolean: record is enabled"
