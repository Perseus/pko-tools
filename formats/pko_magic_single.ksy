meta:
  id: pko_magic_single
  title: PKO MagicSingleinfo.bin (EFF_Param table)
  endian: le
  file-extension: bin
doc: |
  Binary table of magic/skill effect parameters, serialized by
  CRawDataSet::_WriteRawDataInfo_Bin().  Each record is a flat
  EFF_Param struct (inheriting CRawDataInfo) of exactly `record_size`
  bytes.

  File layout:
    4 bytes  — record_size (u4le, always 600 for EFF_Param)
    N × record_size bytes — one EFF_Param per active record

seq:
  - id: record_size
    type: u4
    doc: Size in bytes of each record (sizeof(EFF_Param) = 600).
  - id: records
    type: eff_param
    size: record_size
    repeat: eos
    doc: Array of EFF_Param records until end-of-stream.

types:
  eff_param:
    doc: |
      CRawDataInfo base (108 bytes) + EFF_Param derived fields (492 bytes).
      Total: 600 bytes.
    seq:
      # --- CRawDataInfo base class (108 bytes) ---
      - id: b_exist
        type: u4
        doc: Whether this record is active (1 = yes, 0 = no).
      - id: n_index
        type: s4
        doc: Array index within the raw data set.
      - id: sz_data_name
        type: str
        size: 72
        encoding: ASCII
        doc: Data source name (null-terminated, zero-padded).
      - id: dw_last_use_tick
        type: u4
        doc: Last-access tick count (runtime only, 0 in file).
      - id: b_enable
        type: u4
        doc: Whether record is enabled (1 = yes).
      - id: p_data
        type: u4
        doc: Runtime data pointer (always 0 in serialized file).
      - id: dw_pack_offset
        type: u4
        doc: Offset into pack file (unused here).
      - id: dw_data_size
        type: u4
        doc: Original data file size (unused here).
      - id: n_id
        type: s4
        doc: Magic effect ID — the primary key.
      - id: dw_load_cnt
        type: u4
        doc: Resource load count (runtime only).

      # --- EFF_Param derived fields (492 bytes) ---
      - id: sz_name
        type: str
        size: 32
        encoding: ASCII
        doc: Display name of the effect (null-terminated).
      - id: n_model_num
        type: s4
        doc: Number of model/effect file names (0–8).
      - id: str_model
        type: str
        size: 24
        encoding: ASCII
        repeat: expr
        repeat-expr: 8
        doc: |
          Model/effect file names (8 slots × 24 bytes each).
          Only the first n_model_num slots are meaningful.
      - id: n_vel
        type: s4
        doc: Effect velocity.
      - id: n_par_num
        type: s4
        doc: Number of particle part names (0–8).
      - id: str_part
        type: str
        size: 24
        encoding: ASCII
        repeat: expr
        repeat-expr: 8
        doc: |
          Particle part names (8 slots × 24 bytes each).
          Only the first n_par_num slots are meaningful.
      - id: n_dummy
        type: s4
        repeat: expr
        repeat-expr: 8
        doc: Dummy point indices (8 slots, -1 if unused).
      - id: n_render_idx
        type: s4
        doc: Render mode index.
      - id: n_light_id
        type: s4
        doc: Light ID reference.
      - id: str_result
        type: str
        size: 24
        encoding: ASCII
        doc: Result/hit effect name (null-terminated).
