// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

#![allow(unused_imports)]
#![allow(non_snake_case)]
#![allow(non_camel_case_types)]
#![allow(irrefutable_let_patterns)]
#![allow(unused_comparisons)]

extern crate kaitai;
use kaitai::*;
use std::convert::{TryFrom, TryInto};
use std::cell::{Ref, Cell, RefCell};
use std::rc::{Rc, Weak};

/**
 * Source of truth: lwAnimDataBone::Load(const char* file) and
 * lwAnimDataBone::Load(FILE* fp, DWORD version) in lwExpObj.cpp.
 * 
 * Binary layout:
 *   - u32 version (loader accepts only >= 0x1000 for .lab files)
 *   - lwBoneInfoHeader
 *   - lwBoneBaseInfo[bone_num]
 *   - lwMatrix44[bone_num] (inverse bind matrices)
 *   - lwBoneDummyInfo[dummy_num]
 *   - key payload per bone (shape selected by key_type)
 */

#[derive(Default, Debug, Clone)]
pub struct PkoLab {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    header: RefCell<OptRc<PkoLab_BoneInfoHeader>>,
    base_seq: RefCell<Vec<OptRc<PkoLab_BoneBaseInfo>>>,
    invmat_seq: RefCell<Vec<OptRc<PkoLab_Matrix44>>>,
    dummy_seq: RefCell<Vec<OptRc<PkoLab_BoneDummyInfo>>>,
    key_seq: RefCell<Vec<OptRc<PkoLab_BoneKeyInfo>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab {
    type Root = PkoLab;
    type Parent = PkoLab;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.version.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLab_BoneInfoHeader>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.header.borrow_mut() = t;
        *self_rc.base_seq.borrow_mut() = Vec::new();
        let l_base_seq = *self_rc.header().bone_num();
        for _i in 0..l_base_seq {
            let t = Self::read_into::<_, PkoLab_BoneBaseInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.base_seq.borrow_mut().push(t);
        }
        *self_rc.invmat_seq.borrow_mut() = Vec::new();
        let l_invmat_seq = *self_rc.header().bone_num();
        for _i in 0..l_invmat_seq {
            let t = Self::read_into::<_, PkoLab_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.invmat_seq.borrow_mut().push(t);
        }
        *self_rc.dummy_seq.borrow_mut() = Vec::new();
        let l_dummy_seq = *self_rc.header().dummy_num();
        for _i in 0..l_dummy_seq {
            let t = Self::read_into::<_, PkoLab_BoneDummyInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.dummy_seq.borrow_mut().push(t);
        }
        *self_rc.key_seq.borrow_mut() = Vec::new();
        let l_key_seq = *self_rc.header().bone_num();
        for _i in 0..l_key_seq {
            let f = |t : &mut PkoLab_BoneKeyInfo| Ok(t.set_params((*self_rc.header().key_type()).try_into().map_err(|_| KError::CastError)?, (*self_rc.header().frame_num()).try_into().map_err(|_| KError::CastError)?, (*self_rc.version()).try_into().map_err(|_| KError::CastError)?, (*self_rc.base_seq()[_i as usize].parent_id()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLab_BoneKeyInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.key_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLab {
}
impl PkoLab {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLab {
    pub fn header(&self) -> Ref<'_, OptRc<PkoLab_BoneInfoHeader>> {
        self.header.borrow()
    }
}
impl PkoLab {
    pub fn base_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_BoneBaseInfo>>> {
        self.base_seq.borrow()
    }
}
impl PkoLab {
    pub fn invmat_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_Matrix44>>> {
        self.invmat_seq.borrow()
    }
}
impl PkoLab {
    pub fn dummy_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_BoneDummyInfo>>> {
        self.dummy_seq.borrow()
    }
}
impl PkoLab {
    pub fn key_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_BoneKeyInfo>>> {
        self.key_seq.borrow()
    }
}
impl PkoLab {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_BoneBaseInfo {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab>,
    pub _self: SharedType<Self>,
    name: RefCell<Vec<u8>>,
    id: RefCell<u32>,
    parent_id: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab_BoneBaseInfo {
    type Root = PkoLab;
    type Parent = PkoLab;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.name.borrow_mut() = _io.read_bytes(64 as usize)?.into();
        *self_rc.id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.parent_id.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLab_BoneBaseInfo {
}
impl PkoLab_BoneBaseInfo {
    pub fn name(&self) -> Ref<'_, Vec<u8>> {
        self.name.borrow()
    }
}
impl PkoLab_BoneBaseInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLab_BoneBaseInfo {
    pub fn parent_id(&self) -> Ref<'_, u32> {
        self.parent_id.borrow()
    }
}
impl PkoLab_BoneBaseInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_BoneDummyInfo {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    parent_bone_id: RefCell<u32>,
    mat: RefCell<OptRc<PkoLab_Matrix44>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab_BoneDummyInfo {
    type Root = PkoLab;
    type Parent = PkoLab;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.parent_bone_id.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLab_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLab_BoneDummyInfo {
}
impl PkoLab_BoneDummyInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLab_BoneDummyInfo {
    pub fn parent_bone_id(&self) -> Ref<'_, u32> {
        self.parent_bone_id.borrow()
    }
}
impl PkoLab_BoneDummyInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLab_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLab_BoneDummyInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_BoneInfoHeader {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab>,
    pub _self: SharedType<Self>,
    bone_num: RefCell<u32>,
    frame_num: RefCell<u32>,
    dummy_num: RefCell<u32>,
    key_type: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab_BoneInfoHeader {
    type Root = PkoLab;
    type Parent = PkoLab;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.bone_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.frame_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.dummy_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.key_type.borrow_mut() = _io.read_u4le()?.into();
        if !( ((((*self_rc.key_type() as u32) == (1 as u32))) || (((*self_rc.key_type() as u32) == (2 as u32))) || (((*self_rc.key_type() as u32) == (3 as u32)))) ) {
            return Err(KError::ValidationFailed(ValidationFailedError { kind: ValidationKind::NotAnyOf, src_path: "/types/bone_info_header/seq/3".to_string() }));
        }
        Ok(())
    }
}
impl PkoLab_BoneInfoHeader {
}
impl PkoLab_BoneInfoHeader {
    pub fn bone_num(&self) -> Ref<'_, u32> {
        self.bone_num.borrow()
    }
}
impl PkoLab_BoneInfoHeader {
    pub fn frame_num(&self) -> Ref<'_, u32> {
        self.frame_num.borrow()
    }
}
impl PkoLab_BoneInfoHeader {
    pub fn dummy_num(&self) -> Ref<'_, u32> {
        self.dummy_num.borrow()
    }
}
impl PkoLab_BoneInfoHeader {
    pub fn key_type(&self) -> Ref<'_, u32> {
        self.key_type.borrow()
    }
}
impl PkoLab_BoneInfoHeader {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_BoneKeyInfo {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab>,
    pub _self: SharedType<Self>,
    key_type: RefCell<u32>,
    frame_num: RefCell<u32>,
    version: RefCell<u32>,
    parent_id: RefCell<u32>,
    mat43_seq: RefCell<Vec<OptRc<PkoLab_Matrix43>>>,
    mat44_seq: RefCell<Vec<OptRc<PkoLab_Matrix44>>>,
    pos_seq: RefCell<Vec<OptRc<PkoLab_Vector3>>>,
    quat_seq: RefCell<Vec<OptRc<PkoLab_Quaternion>>>,
    _io: RefCell<BytesReader>,
    f_pos_num: Cell<bool>,
    pos_num: RefCell<u32>,
}
impl KStruct for PkoLab_BoneKeyInfo {
    type Root = PkoLab;
    type Parent = PkoLab;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if ((*self_rc.key_type() as u32) == (1 as u32)) {
            *self_rc.mat43_seq.borrow_mut() = Vec::new();
            let l_mat43_seq = *self_rc.frame_num();
            for _i in 0..l_mat43_seq {
                let t = Self::read_into::<_, PkoLab_Matrix43>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.mat43_seq.borrow_mut().push(t);
            }
        }
        if ((*self_rc.key_type() as u32) == (2 as u32)) {
            *self_rc.mat44_seq.borrow_mut() = Vec::new();
            let l_mat44_seq = *self_rc.frame_num();
            for _i in 0..l_mat44_seq {
                let t = Self::read_into::<_, PkoLab_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.mat44_seq.borrow_mut().push(t);
            }
        }
        if ((*self_rc.key_type() as u32) == (3 as u32)) {
            *self_rc.pos_seq.borrow_mut() = Vec::new();
            let l_pos_seq = *self_rc.pos_num()?;
            for _i in 0..l_pos_seq {
                let t = Self::read_into::<_, PkoLab_Vector3>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.pos_seq.borrow_mut().push(t);
            }
        }
        if ((*self_rc.key_type() as u32) == (3 as u32)) {
            *self_rc.quat_seq.borrow_mut() = Vec::new();
            let l_quat_seq = *self_rc.frame_num();
            for _i in 0..l_quat_seq {
                let t = Self::read_into::<_, PkoLab_Quaternion>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.quat_seq.borrow_mut().push(t);
            }
        }
        Ok(())
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn key_type(&self) -> Ref<'_, u32> {
        self.key_type.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn frame_num(&self) -> Ref<'_, u32> {
        self.frame_num.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn parent_id(&self) -> Ref<'_, u32> {
        self.parent_id.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn set_params(&mut self, key_type: u32, frame_num: u32, version: u32, parent_id: u32) {
        *self.key_type.borrow_mut() = key_type;
        *self.frame_num.borrow_mut() = frame_num;
        *self.version.borrow_mut() = version;
        *self.parent_id.borrow_mut() = parent_id;
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn pos_num(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_pos_num.get() {
            return Ok(self.pos_num.borrow());
        }
        self.f_pos_num.set(true);
        *self.pos_num.borrow_mut() = (if ((*self.version() as i32) >= (4099 as i32)) { *self.frame_num() } else { if (*self.parent_id() == 4294967295u32) { *self.frame_num() } else { 1 } }) as u32;
        Ok(self.pos_num.borrow())
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn mat43_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_Matrix43>>> {
        self.mat43_seq.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn mat44_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_Matrix44>>> {
        self.mat44_seq.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn pos_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_Vector3>>> {
        self.pos_seq.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn quat_seq(&self) -> Ref<'_, Vec<OptRc<PkoLab_Quaternion>>> {
        self.quat_seq.borrow()
    }
}
impl PkoLab_BoneKeyInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_Matrix43 {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab_BoneKeyInfo>,
    pub _self: SharedType<Self>,
    m11: RefCell<f32>,
    m12: RefCell<f32>,
    m13: RefCell<f32>,
    m21: RefCell<f32>,
    m22: RefCell<f32>,
    m23: RefCell<f32>,
    m31: RefCell<f32>,
    m32: RefCell<f32>,
    m33: RefCell<f32>,
    m41: RefCell<f32>,
    m42: RefCell<f32>,
    m43: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab_Matrix43 {
    type Root = PkoLab;
    type Parent = PkoLab_BoneKeyInfo;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.m11.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m12.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m13.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m21.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m22.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m23.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m31.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m32.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m33.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m41.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m42.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m43.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLab_Matrix43 {
}
impl PkoLab_Matrix43 {
    pub fn m11(&self) -> Ref<'_, f32> {
        self.m11.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m12(&self) -> Ref<'_, f32> {
        self.m12.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m13(&self) -> Ref<'_, f32> {
        self.m13.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m21(&self) -> Ref<'_, f32> {
        self.m21.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m22(&self) -> Ref<'_, f32> {
        self.m22.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m23(&self) -> Ref<'_, f32> {
        self.m23.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m31(&self) -> Ref<'_, f32> {
        self.m31.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m32(&self) -> Ref<'_, f32> {
        self.m32.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m33(&self) -> Ref<'_, f32> {
        self.m33.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m41(&self) -> Ref<'_, f32> {
        self.m41.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m42(&self) -> Ref<'_, f32> {
        self.m42.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn m43(&self) -> Ref<'_, f32> {
        self.m43.borrow()
    }
}
impl PkoLab_Matrix43 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_Matrix44 {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    m11: RefCell<f32>,
    m12: RefCell<f32>,
    m13: RefCell<f32>,
    m14: RefCell<f32>,
    m21: RefCell<f32>,
    m22: RefCell<f32>,
    m23: RefCell<f32>,
    m24: RefCell<f32>,
    m31: RefCell<f32>,
    m32: RefCell<f32>,
    m33: RefCell<f32>,
    m34: RefCell<f32>,
    m41: RefCell<f32>,
    m42: RefCell<f32>,
    m43: RefCell<f32>,
    m44: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab_Matrix44 {
    type Root = PkoLab;
    type Parent = KStructUnit;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.m11.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m12.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m13.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m14.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m21.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m22.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m23.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m24.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m31.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m32.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m33.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m34.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m41.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m42.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m43.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.m44.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLab_Matrix44 {
}
impl PkoLab_Matrix44 {
    pub fn m11(&self) -> Ref<'_, f32> {
        self.m11.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m12(&self) -> Ref<'_, f32> {
        self.m12.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m13(&self) -> Ref<'_, f32> {
        self.m13.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m14(&self) -> Ref<'_, f32> {
        self.m14.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m21(&self) -> Ref<'_, f32> {
        self.m21.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m22(&self) -> Ref<'_, f32> {
        self.m22.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m23(&self) -> Ref<'_, f32> {
        self.m23.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m24(&self) -> Ref<'_, f32> {
        self.m24.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m31(&self) -> Ref<'_, f32> {
        self.m31.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m32(&self) -> Ref<'_, f32> {
        self.m32.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m33(&self) -> Ref<'_, f32> {
        self.m33.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m34(&self) -> Ref<'_, f32> {
        self.m34.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m41(&self) -> Ref<'_, f32> {
        self.m41.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m42(&self) -> Ref<'_, f32> {
        self.m42.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m43(&self) -> Ref<'_, f32> {
        self.m43.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn m44(&self) -> Ref<'_, f32> {
        self.m44.borrow()
    }
}
impl PkoLab_Matrix44 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_Quaternion {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab_BoneKeyInfo>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    z: RefCell<f32>,
    w: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab_Quaternion {
    type Root = PkoLab;
    type Parent = PkoLab_BoneKeyInfo;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.x.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.y.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.z.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.w.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLab_Quaternion {
}
impl PkoLab_Quaternion {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoLab_Quaternion {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoLab_Quaternion {
    pub fn z(&self) -> Ref<'_, f32> {
        self.z.borrow()
    }
}
impl PkoLab_Quaternion {
    pub fn w(&self) -> Ref<'_, f32> {
        self.w.borrow()
    }
}
impl PkoLab_Quaternion {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLab_Vector3 {
    pub _root: SharedType<PkoLab>,
    pub _parent: SharedType<PkoLab_BoneKeyInfo>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    z: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLab_Vector3 {
    type Root = PkoLab;
    type Parent = PkoLab_BoneKeyInfo;

    fn read<S: KStream>(
        self_rc: &OptRc<Self>,
        _io: &S,
        _root: SharedType<Self::Root>,
        _parent: SharedType<Self::Parent>,
    ) -> KResult<()> {
        *self_rc._io.borrow_mut() = _io.clone();
        self_rc._root.set(_root.get());
        self_rc._parent.set(_parent.get());
        self_rc._self.set(Ok(self_rc.clone()));
        let _rrc = self_rc._root.get_value().borrow().upgrade();
        let _prc = self_rc._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        *self_rc.x.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.y.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.z.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLab_Vector3 {
}
impl PkoLab_Vector3 {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoLab_Vector3 {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoLab_Vector3 {
    pub fn z(&self) -> Ref<'_, f32> {
        self.z.borrow()
    }
}
impl PkoLab_Vector3 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
