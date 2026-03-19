meta:
  id: pko_lab
  title: PKO LAB Bone Animation
  endian: le
  file-extension: lab
doc: |
  Source of truth: lwAnimDataBone::Load(const char* file) and
  lwAnimDataBone::Load(FILE* fp, DWORD version) in lwExpObj.cpp.

  Binary layout:
    - u32 version (loader accepts only >= 0x1000 for .lab files)
    - lwBoneInfoHeader
    - lwBoneBaseInfo[bone_num]
    - lwMatrix44[bone_num] (inverse bind matrices)
    - lwBoneDummyInfo[dummy_num]
    - key payload per bone (shape selected by key_type)

seq:
  - id: version
    type: u4
    valid:
      min: 4096
    doc: "Format version (must be >= 0x1000 = 4096 for .lab files)"
  - id: header
    type: bone_info_header
    doc: "Skeleton/animation header with bone counts and keyframe format"
  - id: base_seq
    type: bone_base_info
    repeat: expr
    repeat-expr: header.bone_num
    doc: "Base info for each bone (name, id, parent)"
  - id: invmat_seq
    type: matrix44
    repeat: expr
    repeat-expr: header.bone_num
    doc: "Inverse bind matrices for each bone (world-to-bone-local transform)"
  - id: dummy_seq
    type: bone_dummy_info
    repeat: expr
    repeat-expr: header.dummy_num
    doc: "Attachment points (e.g., weapon slots, effect anchors)"
  - id: key_seq
    type: bone_key_info(header.key_type, header.frame_num, version, base_seq[_index].parent_id)
    repeat: expr
    repeat-expr: header.bone_num
    doc: "Animation keyframe data for each bone (format depends on key_type)"

enums:
  bone_key_type:
    1:
      id: mat43
      doc: "4x3 matrix per frame (position + rotation + scale)"
    2:
      id: mat44
      doc: "Full 4x4 matrix per frame"
    3:
      id: quat
      doc: "Quaternion rotation + position (compact, introduced in v0x1003)"

types:
  vector3:
    doc: "3D float vector"
    seq:
      - id: x
        type: f4
        doc: "X component"
      - id: y
        type: f4
        doc: "Y component"
      - id: z
        type: f4
        doc: "Z component"

  quaternion:
    doc: "Rotation quaternion (x, y, z, w)"
    seq:
      - id: x
        type: f4
        doc: "X component"
      - id: y
        type: f4
        doc: "Y component"
      - id: z
        type: f4
        doc: "Z component"
      - id: w
        type: f4
        doc: "W (scalar) component"

  matrix43:
    doc: "4x3 row-major transform matrix (3 rotation rows + 1 translation row, no projection)"
    seq:
      - id: m11
        type: f4
        doc: "Row 1, column 1"
      - id: m12
        type: f4
        doc: "Row 1, column 2"
      - id: m13
        type: f4
        doc: "Row 1, column 3"
      - id: m21
        type: f4
        doc: "Row 2, column 1"
      - id: m22
        type: f4
        doc: "Row 2, column 2"
      - id: m23
        type: f4
        doc: "Row 2, column 3"
      - id: m31
        type: f4
        doc: "Row 3, column 1"
      - id: m32
        type: f4
        doc: "Row 3, column 2"
      - id: m33
        type: f4
        doc: "Row 3, column 3"
      - id: m41
        type: f4
        doc: "Row 4, column 1 (translation X)"
      - id: m42
        type: f4
        doc: "Row 4, column 2 (translation Y)"
      - id: m43
        type: f4
        doc: "Row 4, column 3 (translation Z)"

  matrix44:
    doc: "4x4 row-major transform matrix"
    seq:
      - id: m11
        type: f4
        doc: "Row 1, column 1"
      - id: m12
        type: f4
        doc: "Row 1, column 2"
      - id: m13
        type: f4
        doc: "Row 1, column 3"
      - id: m14
        type: f4
        doc: "Row 1, column 4"
      - id: m21
        type: f4
        doc: "Row 2, column 1"
      - id: m22
        type: f4
        doc: "Row 2, column 2"
      - id: m23
        type: f4
        doc: "Row 2, column 3"
      - id: m24
        type: f4
        doc: "Row 2, column 4"
      - id: m31
        type: f4
        doc: "Row 3, column 1"
      - id: m32
        type: f4
        doc: "Row 3, column 2"
      - id: m33
        type: f4
        doc: "Row 3, column 3"
      - id: m34
        type: f4
        doc: "Row 3, column 4"
      - id: m41
        type: f4
        doc: "Row 4, column 1 (translation X)"
      - id: m42
        type: f4
        doc: "Row 4, column 2 (translation Y)"
      - id: m43
        type: f4
        doc: "Row 4, column 3 (translation Z)"
      - id: m44
        type: f4
        doc: "Row 4, column 4 (homogeneous w, typically 1.0)"

  bone_info_header:
    seq:
      - id: bone_num
        type: u4
        doc: "Number of bones in the skeleton"
      - id: frame_num
        type: u4
        doc: "Total number of animation frames"
      - id: dummy_num
        type: u4
        doc: "Number of dummy attachment points"
      - id: key_type
        type: u4
        valid:
          any-of: [1, 2, 3]
        doc: "Keyframe data format: 1=mat43, 2=mat44, 3=quaternion+position"

  bone_base_info:
    doc: "Per-bone identity and hierarchy info"
    seq:
      - id: name
        size: 64
        doc: "Bone name (null-padded to 64 bytes, e.g., 'Bone_Chest', 'Dummy0')"
      - id: id
        type: u4
        doc: "Unique bone ID (0-based index within skeleton)"
      - id: parent_id
        type: u4
        doc: "Parent bone ID (0xFFFFFFFF = root bone, no parent)"

  bone_dummy_info:
    doc: "Skeleton attachment point for weapons, effects, etc."
    seq:
      - id: id
        type: u4
        doc: "Dummy point ID (referenced by effect anchors and weapon slots)"
      - id: parent_bone_id
        type: u4
        doc: "ID of the bone this dummy is attached to"
      - id: mat
        type: matrix44
        doc: "4x4 local transform matrix relative to parent bone"

  bone_key_info:
    doc: "Per-bone animation keyframe data. Format selected by key_type parameter."
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
        doc: "One 4x3 transform matrix per frame (key_type=1)"
      - id: mat44_seq
        type: matrix44
        repeat: expr
        repeat-expr: frame_num
        if: key_type == 2
        doc: "One 4x4 transform matrix per frame (key_type=2)"
      - id: pos_seq
        type: vector3
        repeat: expr
        repeat-expr: pos_num
        if: key_type == 3
        doc: "Position vectors per frame (key_type=3). Count depends on version and parent_id"
      - id: quat_seq
        type: quaternion
        repeat: expr
        repeat-expr: frame_num
        if: key_type == 3
        doc: "Quaternion rotations per frame (key_type=3)"
    instances:
      pos_num:
        value: 'version >= 4099 ? frame_num : (parent_id == 4294967295 ? frame_num : 1)'
        doc: "Number of position keys. v>=4099: all frames. Earlier: all frames for root bone, 1 for others"
