meta:
  id: pko_poseinfo
  title: PKO Character Pose Info (characterposeinfo.bin)
  endian: le
  file-extension: bin
doc: |
  Binary pose-info table loaded from scripts/table/characterposeinfo.bin.
  Contains 54 named action definitions with weapon-variant pose ID mappings.

  Layout: 4-byte header + 54 × 124-byte PoseEntry records = 6700 bytes total.

  Each entry maps a base pose (e.g. "Normal Wait") to 7 weapon-variant pose IDs
  via sRealPoseID[7], matching the 7 wield modes in CharacterModel.cpp.

seq:
  - id: header
    type: header
  - id: entries
    type: pose_entry
    repeat: expr
    repeat-expr: 54

types:
  header:
    seq:
      - id: max_id
        type: u4
        doc: Header value (124 in known files). Meaning unclear — possibly record byte size.

  pose_entry:
    seq:
      - id: unknown1
        type: u4
        doc: Unknown field (1 for all entries in known files).
      - id: pose_id
        type: u4
        doc: Base pose ID (1-54).
      - id: name
        size: 64
        type: strz
        encoding: ASCII
        doc: |
          English action name, null-terminated, 0xCD padded.
          Examples: "Normal Wait", "Cool Pose", "Death (All)".
      - id: metadata
        size: 36
        doc: Unknown metadata bytes (possibly animation flags, blend times).
      - id: weapon_variants
        type: s2
        repeat: expr
        repeat-expr: 7
        doc: |
          sRealPoseID[7] — weapon-variant pose IDs for each wield mode:
            [0] S_MELEE (unarmed), [1] S_MELEE2 (sword/staff),
            [2] D_MELEE (huge sword), [3] D_WEAPON (dual),
            [4] S_GUN (gun), [5] D_BOW (bow), [6] S_DAGGER (dagger).
      - id: padding
        size: 2
        doc: Trailing padding bytes (0xCD).
