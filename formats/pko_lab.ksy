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
  - id: header
    type: bone_info_header
  - id: base_seq
    type: bone_base_info
    repeat: expr
    repeat-expr: header.bone_num
  - id: invmat_seq
    type: matrix44
    repeat: expr
    repeat-expr: header.bone_num
  - id: dummy_seq
    type: bone_dummy_info
    repeat: expr
    repeat-expr: header.dummy_num
  - id: key_seq
    type: bone_key_info(header.key_type, header.frame_num, version, base_seq[_index].parent_id)
    repeat: expr
    repeat-expr: header.bone_num

types:
  vector3:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4

  quaternion:
    seq:
      - id: x
        type: f4
      - id: y
        type: f4
      - id: z
        type: f4
      - id: w
        type: f4

  matrix43:
    seq:
      - id: m11
        type: f4
      - id: m12
        type: f4
      - id: m13
        type: f4
      - id: m21
        type: f4
      - id: m22
        type: f4
      - id: m23
        type: f4
      - id: m31
        type: f4
      - id: m32
        type: f4
      - id: m33
        type: f4
      - id: m41
        type: f4
      - id: m42
        type: f4
      - id: m43
        type: f4

  matrix44:
    seq:
      - id: m11
        type: f4
      - id: m12
        type: f4
      - id: m13
        type: f4
      - id: m14
        type: f4
      - id: m21
        type: f4
      - id: m22
        type: f4
      - id: m23
        type: f4
      - id: m24
        type: f4
      - id: m31
        type: f4
      - id: m32
        type: f4
      - id: m33
        type: f4
      - id: m34
        type: f4
      - id: m41
        type: f4
      - id: m42
        type: f4
      - id: m43
        type: f4
      - id: m44
        type: f4

  bone_info_header:
    seq:
      - id: bone_num
        type: u4
      - id: frame_num
        type: u4
      - id: dummy_num
        type: u4
      - id: key_type
        type: u4
        valid:
          any-of: [1, 2, 3]

  bone_base_info:
    seq:
      - id: name
        size: 64
      - id: id
        type: u4
      - id: parent_id
        type: u4

  bone_dummy_info:
    seq:
      - id: id
        type: u4
      - id: parent_bone_id
        type: u4
      - id: mat
        type: matrix44

  bone_key_info:
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
      - id: mat44_seq
        type: matrix44
        repeat: expr
        repeat-expr: frame_num
        if: key_type == 2
      - id: pos_seq
        type: vector3
        repeat: expr
        repeat-expr: pos_num
        if: key_type == 3
      - id: quat_seq
        type: quaternion
        repeat: expr
        repeat-expr: frame_num
        if: key_type == 3
    instances:
      pos_num:
        value: 'version >= 4099 ? frame_num : (parent_id == 4294967295 ? frame_num : 1)'
