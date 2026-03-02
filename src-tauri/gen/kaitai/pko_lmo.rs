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
 * Root parser for the lwModelObjInfo-style LMO container.
 * This phase decodes the object table and slices chunk payloads using
 * absolute offsets (addr/size), matching client loader behavior.
 */

#[derive(Default, Debug, Clone)]
pub struct PkoLmo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    obj_num: RefCell<u32>,
    model_info_descriptor: RefCell<Vec<u8>>,
    model_info_obj_num: RefCell<u32>,
    model_nodes: RefCell<Vec<OptRc<PkoLmo_ModelNodeInfo>>>,
    objects: RefCell<Vec<OptRc<PkoLmo_ObjectEntry>>>,
    _io: RefCell<BytesReader>,
    f_descriptor_magic: Cell<bool>,
    descriptor_magic: RefCell<String>,
    f_is_model_info_tree: Cell<bool>,
    is_model_info_tree: RefCell<bool>,
    f_tree_mask: Cell<bool>,
    tree_mask: RefCell<u32>,
    f_tree_obj_num: Cell<bool>,
    tree_obj_num: RefCell<u32>,
    f_tree_version: Cell<bool>,
    tree_version: RefCell<u32>,
}
impl KStruct for PkoLmo {
    type Root = PkoLmo;
    type Parent = PkoLmo;

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
        *self_rc.obj_num.borrow_mut() = _io.read_u4le()?.into();
        if *self_rc.is_model_info_tree()? {
            *self_rc.model_info_descriptor.borrow_mut() = _io.read_bytes(64 as usize)?.into();
        }
        if *self_rc.is_model_info_tree()? {
            *self_rc.model_info_obj_num.borrow_mut() = _io.read_u4le()?.into();
        }
        if *self_rc.is_model_info_tree()? {
            *self_rc.model_nodes.borrow_mut() = Vec::new();
            let l_model_nodes = *self_rc.tree_obj_num()?;
            for _i in 0..l_model_nodes {
                let f = |t : &mut PkoLmo_ModelNodeInfo| Ok(t.set_params((*self_rc.tree_version()?).try_into().map_err(|_| KError::CastError)?));
                let t = Self::read_into_with_init::<_, PkoLmo_ModelNodeInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
                self_rc.model_nodes.borrow_mut().push(t);
            }
        }
        if !(*self_rc.is_model_info_tree()?) {
            *self_rc.objects.borrow_mut() = Vec::new();
            let l_objects = *self_rc.obj_num();
            for _i in 0..l_objects {
                let t = Self::read_into::<_, PkoLmo_ObjectEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.objects.borrow_mut().push(t);
            }
        }
        Ok(())
    }
}
impl PkoLmo {
    pub fn descriptor_magic(
        &self
    ) -> KResult<Ref<'_, String>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_descriptor_magic.get() {
            return Ok(self.descriptor_magic.borrow());
        }
        self.f_descriptor_magic.set(true);
        if ((*_io.size() as i32) >= (19 as i32)) {
            let _pos = _io.pos();
            _io.seek(8 as usize)?;
            *self.descriptor_magic.borrow_mut() = bytes_to_str(&_io.read_bytes(11 as usize)?.into(), "ASCII")?;
            _io.seek(_pos)?;
        }
        Ok(self.descriptor_magic.borrow())
    }
    pub fn is_model_info_tree(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_is_model_info_tree.get() {
            return Ok(self.is_model_info_tree.borrow());
        }
        self.f_is_model_info_tree.set(true);
        *self.is_model_info_tree.borrow_mut() = (*self.descriptor_magic()? == "lwModelInfo".to_string()) as bool;
        Ok(self.is_model_info_tree.borrow())
    }
    pub fn tree_mask(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tree_mask.get() {
            return Ok(self.tree_mask.borrow());
        }
        self.f_tree_mask.set(true);
        if *self.is_model_info_tree()? {
            *self.tree_mask.borrow_mut() = (*self.version()) as u32;
        }
        Ok(self.tree_mask.borrow())
    }
    pub fn tree_obj_num(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tree_obj_num.get() {
            return Ok(self.tree_obj_num.borrow());
        }
        self.f_tree_obj_num.set(true);
        if *self.is_model_info_tree()? {
            *self.tree_obj_num.borrow_mut() = (*self.model_info_obj_num()) as u32;
        }
        Ok(self.tree_obj_num.borrow())
    }
    pub fn tree_version(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tree_version.get() {
            return Ok(self.tree_version.borrow());
        }
        self.f_tree_version.set(true);
        if *self.is_model_info_tree()? {
            *self.tree_version.borrow_mut() = (*self.obj_num()) as u32;
        }
        Ok(self.tree_version.borrow())
    }
}
impl PkoLmo {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLmo {
    pub fn obj_num(&self) -> Ref<'_, u32> {
        self.obj_num.borrow()
    }
}
impl PkoLmo {
    pub fn model_info_descriptor(&self) -> Ref<'_, Vec<u8>> {
        self.model_info_descriptor.borrow()
    }
}
impl PkoLmo {
    pub fn model_info_obj_num(&self) -> Ref<'_, u32> {
        self.model_info_obj_num.borrow()
    }
}
impl PkoLmo {
    pub fn model_nodes(&self) -> Ref<'_, Vec<OptRc<PkoLmo_ModelNodeInfo>>> {
        self.model_nodes.borrow()
    }
}
impl PkoLmo {
    pub fn objects(&self) -> Ref<'_, Vec<OptRc<PkoLmo_ObjectEntry>>> {
        self.objects.borrow()
    }
}
impl PkoLmo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataBone {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    legacy_prefix: RefCell<u32>,
    header: RefCell<OptRc<PkoLmo_BoneInfoHeader>>,
    base_seq: RefCell<Vec<OptRc<PkoLmo_BoneBaseInfo>>>,
    invmat_seq: RefCell<Vec<OptRc<PkoLmo_Matrix44>>>,
    dummy_seq: RefCell<Vec<OptRc<PkoLmo_BoneDummyInfo>>>,
    key_seq: RefCell<Vec<OptRc<PkoLmo_BoneKeyInfo>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_AnimDataBone {
    type Root = PkoLmo;
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
        if ((*self_rc.version() as u32) == (0 as u32)) {
            *self_rc.legacy_prefix.borrow_mut() = _io.read_u4le()?.into();
        }
        let t = Self::read_into::<_, PkoLmo_BoneInfoHeader>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.header.borrow_mut() = t;
        *self_rc.base_seq.borrow_mut() = Vec::new();
        let l_base_seq = *self_rc.header().bone_num();
        for _i in 0..l_base_seq {
            let t = Self::read_into::<_, PkoLmo_BoneBaseInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.base_seq.borrow_mut().push(t);
        }
        *self_rc.invmat_seq.borrow_mut() = Vec::new();
        let l_invmat_seq = *self_rc.header().bone_num();
        for _i in 0..l_invmat_seq {
            let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.invmat_seq.borrow_mut().push(t);
        }
        *self_rc.dummy_seq.borrow_mut() = Vec::new();
        let l_dummy_seq = *self_rc.header().dummy_num();
        for _i in 0..l_dummy_seq {
            let t = Self::read_into::<_, PkoLmo_BoneDummyInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.dummy_seq.borrow_mut().push(t);
        }
        *self_rc.key_seq.borrow_mut() = Vec::new();
        let l_key_seq = *self_rc.header().bone_num();
        for _i in 0..l_key_seq {
            let f = |t : &mut PkoLmo_BoneKeyInfo| Ok(t.set_params((*self_rc.header().key_type()).try_into().map_err(|_| KError::CastError)?, (*self_rc.header().frame_num()).try_into().map_err(|_| KError::CastError)?, (*self_rc.version()).try_into().map_err(|_| KError::CastError)?, (*self_rc.base_seq()[_i as usize].parent_id()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_BoneKeyInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.key_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataBone {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLmo_AnimDataBone {
    pub fn set_params(&mut self, version: u32) {
        *self.version.borrow_mut() = version;
    }
}
impl PkoLmo_AnimDataBone {
}
impl PkoLmo_AnimDataBone {
    pub fn legacy_prefix(&self) -> Ref<'_, u32> {
        self.legacy_prefix.borrow()
    }
}
impl PkoLmo_AnimDataBone {
    pub fn header(&self) -> Ref<'_, OptRc<PkoLmo_BoneInfoHeader>> {
        self.header.borrow()
    }
}
impl PkoLmo_AnimDataBone {
    pub fn base_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_BoneBaseInfo>>> {
        self.base_seq.borrow()
    }
}
impl PkoLmo_AnimDataBone {
    pub fn invmat_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Matrix44>>> {
        self.invmat_seq.borrow()
    }
}
impl PkoLmo_AnimDataBone {
    pub fn dummy_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_BoneDummyInfo>>> {
        self.dummy_seq.borrow()
    }
}
impl PkoLmo_AnimDataBone {
    pub fn key_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_BoneKeyInfo>>> {
        self.key_seq.borrow()
    }
}
impl PkoLmo_AnimDataBone {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataMatrix {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    frame_num: RefCell<u32>,
    mat_seq: RefCell<Vec<OptRc<PkoLmo_Matrix43>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_AnimDataMatrix {
    type Root = PkoLmo;
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
        *self_rc.frame_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.mat_seq.borrow_mut() = Vec::new();
        let l_mat_seq = *self_rc.frame_num();
        for _i in 0..l_mat_seq {
            let t = Self::read_into::<_, PkoLmo_Matrix43>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.mat_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataMatrix {
}
impl PkoLmo_AnimDataMatrix {
    pub fn frame_num(&self) -> Ref<'_, u32> {
        self.frame_num.borrow()
    }
}
impl PkoLmo_AnimDataMatrix {
    pub fn mat_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Matrix43>>> {
        self.mat_seq.borrow()
    }
}
impl PkoLmo_AnimDataMatrix {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataMtlOpacity {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataMtlopacSlot>,
    pub _self: SharedType<Self>,
    key_num: RefCell<u32>,
    key_seq: RefCell<Vec<OptRc<PkoLmo_KeyFloat>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_AnimDataMtlOpacity {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataMtlopacSlot;

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
        *self_rc.key_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.key_seq.borrow_mut() = Vec::new();
        let l_key_seq = *self_rc.key_num();
        for _i in 0..l_key_seq {
            let t = Self::read_into::<_, PkoLmo_KeyFloat>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.key_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataMtlOpacity {
}
impl PkoLmo_AnimDataMtlOpacity {
    pub fn key_num(&self) -> Ref<'_, u32> {
        self.key_num.borrow()
    }
}
impl PkoLmo_AnimDataMtlOpacity {
    pub fn key_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_KeyFloat>>> {
        self.key_seq.borrow()
    }
}
impl PkoLmo_AnimDataMtlOpacity {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataMtlopacSlot {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimSection>,
    pub _self: SharedType<Self>,
    blob_size: RefCell<u32>,
    data: RefCell<OptRc<PkoLmo_AnimDataMtlOpacity>>,
    _io: RefCell<BytesReader>,
    data_raw: RefCell<Vec<u8>>,
}
impl KStruct for PkoLmo_AnimDataMtlopacSlot {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimSection;

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
        if ((*self_rc.blob_size() as u32) > (0 as u32)) {
            *self_rc.data_raw.borrow_mut() = _io.read_bytes(*self_rc.blob_size() as usize)?.into();
            let data_raw = self_rc.data_raw.borrow();
            let _t_data_raw_io = BytesReader::from(data_raw.clone());
            let t = Self::read_into::<BytesReader, PkoLmo_AnimDataMtlOpacity>(&_t_data_raw_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.data.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataMtlopacSlot {
    pub fn blob_size(&self) -> Ref<'_, u32> {
        self.blob_size.borrow()
    }
}
impl PkoLmo_AnimDataMtlopacSlot {
    pub fn set_params(&mut self, blob_size: u32) {
        *self.blob_size.borrow_mut() = blob_size;
    }
}
impl PkoLmo_AnimDataMtlopacSlot {
}
impl PkoLmo_AnimDataMtlopacSlot {
    pub fn data(&self) -> Ref<'_, OptRc<PkoLmo_AnimDataMtlOpacity>> {
        self.data.borrow()
    }
}
impl PkoLmo_AnimDataMtlopacSlot {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoLmo_AnimDataMtlopacSlot {
    pub fn data_raw(&self) -> Ref<'_, Vec<u8>> {
        self.data_raw.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataTeximg {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataTeximgSlot>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    legacy_payload: RefCell<Vec<u8>>,
    data_num: RefCell<u32>,
    data_seq: RefCell<Vec<OptRc<PkoLmo_TexInfoCurrent>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_AnimDataTeximg {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataTeximgSlot;

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
        if ((*self_rc.version() as u32) == (0 as u32)) {
            *self_rc.legacy_payload.borrow_mut() = _io.read_bytes_full()?.into();
        }
        if ((*self_rc.version() as u32) != (0 as u32)) {
            *self_rc.data_num.borrow_mut() = _io.read_u4le()?.into();
        }
        if ((*self_rc.version() as u32) != (0 as u32)) {
            *self_rc.data_seq.borrow_mut() = Vec::new();
            let l_data_seq = *self_rc.data_num();
            for _i in 0..l_data_seq {
                let t = Self::read_into::<_, PkoLmo_TexInfoCurrent>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.data_seq.borrow_mut().push(t);
            }
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataTeximg {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLmo_AnimDataTeximg {
    pub fn set_params(&mut self, version: u32) {
        *self.version.borrow_mut() = version;
    }
}
impl PkoLmo_AnimDataTeximg {
}
impl PkoLmo_AnimDataTeximg {
    pub fn legacy_payload(&self) -> Ref<'_, Vec<u8>> {
        self.legacy_payload.borrow()
    }
}
impl PkoLmo_AnimDataTeximg {
    pub fn data_num(&self) -> Ref<'_, u32> {
        self.data_num.borrow()
    }
}
impl PkoLmo_AnimDataTeximg {
    pub fn data_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_TexInfoCurrent>>> {
        self.data_seq.borrow()
    }
}
impl PkoLmo_AnimDataTeximg {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataTeximgSlot {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimSection>,
    pub _self: SharedType<Self>,
    blob_size: RefCell<u32>,
    version: RefCell<u32>,
    data: RefCell<OptRc<PkoLmo_AnimDataTeximg>>,
    _io: RefCell<BytesReader>,
    data_raw: RefCell<Vec<u8>>,
}
impl KStruct for PkoLmo_AnimDataTeximgSlot {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimSection;

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
        if ((*self_rc.blob_size() as u32) > (0 as u32)) {
            *self_rc.data_raw.borrow_mut() = _io.read_bytes(*self_rc.blob_size() as usize)?.into();
            let data_raw = self_rc.data_raw.borrow();
            let _t_data_raw_io = BytesReader::from(data_raw.clone());
            let f = |t : &mut PkoLmo_AnimDataTeximg| Ok(t.set_params((*self_rc.version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_AnimDataTeximg>(&_t_data_raw_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            *self_rc.data.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataTeximgSlot {
    pub fn blob_size(&self) -> Ref<'_, u32> {
        self.blob_size.borrow()
    }
}
impl PkoLmo_AnimDataTeximgSlot {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLmo_AnimDataTeximgSlot {
    pub fn set_params(&mut self, blob_size: u32, version: u32) {
        *self.blob_size.borrow_mut() = blob_size;
        *self.version.borrow_mut() = version;
    }
}
impl PkoLmo_AnimDataTeximgSlot {
}
impl PkoLmo_AnimDataTeximgSlot {
    pub fn data(&self) -> Ref<'_, OptRc<PkoLmo_AnimDataTeximg>> {
        self.data.borrow()
    }
}
impl PkoLmo_AnimDataTeximgSlot {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoLmo_AnimDataTeximgSlot {
    pub fn data_raw(&self) -> Ref<'_, Vec<u8>> {
        self.data_raw.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataTexuv {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataTexuvSlot>,
    pub _self: SharedType<Self>,
    frame_num: RefCell<u32>,
    mat_seq: RefCell<Vec<OptRc<PkoLmo_Matrix44>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_AnimDataTexuv {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataTexuvSlot;

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
        *self_rc.frame_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.mat_seq.borrow_mut() = Vec::new();
        let l_mat_seq = *self_rc.frame_num();
        for _i in 0..l_mat_seq {
            let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.mat_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataTexuv {
}
impl PkoLmo_AnimDataTexuv {
    pub fn frame_num(&self) -> Ref<'_, u32> {
        self.frame_num.borrow()
    }
}
impl PkoLmo_AnimDataTexuv {
    pub fn mat_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Matrix44>>> {
        self.mat_seq.borrow()
    }
}
impl PkoLmo_AnimDataTexuv {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimDataTexuvSlot {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimSection>,
    pub _self: SharedType<Self>,
    blob_size: RefCell<u32>,
    data: RefCell<OptRc<PkoLmo_AnimDataTexuv>>,
    _io: RefCell<BytesReader>,
    data_raw: RefCell<Vec<u8>>,
}
impl KStruct for PkoLmo_AnimDataTexuvSlot {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimSection;

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
        if ((*self_rc.blob_size() as u32) > (0 as u32)) {
            *self_rc.data_raw.borrow_mut() = _io.read_bytes(*self_rc.blob_size() as usize)?.into();
            let data_raw = self_rc.data_raw.borrow();
            let _t_data_raw_io = BytesReader::from(data_raw.clone());
            let t = Self::read_into::<BytesReader, PkoLmo_AnimDataTexuv>(&_t_data_raw_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.data.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_AnimDataTexuvSlot {
    pub fn blob_size(&self) -> Ref<'_, u32> {
        self.blob_size.borrow()
    }
}
impl PkoLmo_AnimDataTexuvSlot {
    pub fn set_params(&mut self, blob_size: u32) {
        *self.blob_size.borrow_mut() = blob_size;
    }
}
impl PkoLmo_AnimDataTexuvSlot {
}
impl PkoLmo_AnimDataTexuvSlot {
    pub fn data(&self) -> Ref<'_, OptRc<PkoLmo_AnimDataTexuv>> {
        self.data.borrow()
    }
}
impl PkoLmo_AnimDataTexuvSlot {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoLmo_AnimDataTexuvSlot {
    pub fn data_raw(&self) -> Ref<'_, Vec<u8>> {
        self.data_raw.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_AnimSection {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeometryChunk>,
    pub _self: SharedType<Self>,
    file_version: RefCell<u32>,
    legacy_prefix: RefCell<u32>,
    data_bone_size: RefCell<u32>,
    data_mat_size: RefCell<u32>,
    data_mtlopac_size: RefCell<Vec<u32>>,
    data_texuv_size: RefCell<Vec<u32>>,
    data_teximg_size: RefCell<Vec<u32>>,
    anim_bone: RefCell<OptRc<PkoLmo_AnimDataBone>>,
    anim_mat: RefCell<OptRc<PkoLmo_AnimDataMatrix>>,
    anim_mtlopac: RefCell<Vec<OptRc<PkoLmo_AnimDataMtlopacSlot>>>,
    anim_texuv: RefCell<Vec<OptRc<PkoLmo_AnimDataTexuvSlot>>>,
    anim_teximg: RefCell<Vec<OptRc<PkoLmo_AnimDataTeximgSlot>>>,
    _io: RefCell<BytesReader>,
    anim_bone_raw: RefCell<Vec<u8>>,
    anim_mat_raw: RefCell<Vec<u8>>,
}
impl KStruct for PkoLmo_AnimSection {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeometryChunk;

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
        if ((*self_rc.file_version() as u32) == (0 as u32)) {
            *self_rc.legacy_prefix.borrow_mut() = _io.read_u4le()?.into();
        }
        *self_rc.data_bone_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.data_mat_size.borrow_mut() = _io.read_u4le()?.into();
        if ((*self_rc.file_version() as i32) >= (4101 as i32)) {
            *self_rc.data_mtlopac_size.borrow_mut() = Vec::new();
            let l_data_mtlopac_size = 16;
            for _i in 0..l_data_mtlopac_size {
                self_rc.data_mtlopac_size.borrow_mut().push(_io.read_u4le()?.into());
            }
        }
        *self_rc.data_texuv_size.borrow_mut() = Vec::new();
        let l_data_texuv_size = 64;
        for _i in 0..l_data_texuv_size {
            self_rc.data_texuv_size.borrow_mut().push(_io.read_u4le()?.into());
        }
        *self_rc.data_teximg_size.borrow_mut() = Vec::new();
        let l_data_teximg_size = 64;
        for _i in 0..l_data_teximg_size {
            self_rc.data_teximg_size.borrow_mut().push(_io.read_u4le()?.into());
        }
        if ((*self_rc.data_bone_size() as u32) > (0 as u32)) {
            *self_rc.anim_bone_raw.borrow_mut() = _io.read_bytes(*self_rc.data_bone_size() as usize)?.into();
            let anim_bone_raw = self_rc.anim_bone_raw.borrow();
            let _t_anim_bone_raw_io = BytesReader::from(anim_bone_raw.clone());
            let f = |t : &mut PkoLmo_AnimDataBone| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_AnimDataBone>(&_t_anim_bone_raw_io, Some(self_rc._root.clone()), None, &f)?.into();
            *self_rc.anim_bone.borrow_mut() = t;
        }
        if ((*self_rc.data_mat_size() as u32) > (0 as u32)) {
            *self_rc.anim_mat_raw.borrow_mut() = _io.read_bytes(*self_rc.data_mat_size() as usize)?.into();
            let anim_mat_raw = self_rc.anim_mat_raw.borrow();
            let _t_anim_mat_raw_io = BytesReader::from(anim_mat_raw.clone());
            let t = Self::read_into::<BytesReader, PkoLmo_AnimDataMatrix>(&_t_anim_mat_raw_io, Some(self_rc._root.clone()), None)?.into();
            *self_rc.anim_mat.borrow_mut() = t;
        }
        if ((*self_rc.file_version() as i32) >= (4101 as i32)) {
            *self_rc.anim_mtlopac.borrow_mut() = Vec::new();
            let l_anim_mtlopac = 16;
            for _i in 0..l_anim_mtlopac {
                let f = |t : &mut PkoLmo_AnimDataMtlopacSlot| Ok(t.set_params((self_rc.data_mtlopac_size()[_i as usize]).try_into().map_err(|_| KError::CastError)?));
                let t = Self::read_into_with_init::<_, PkoLmo_AnimDataMtlopacSlot>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
                self_rc.anim_mtlopac.borrow_mut().push(t);
            }
        }
        *self_rc.anim_texuv.borrow_mut() = Vec::new();
        let l_anim_texuv = 64;
        for _i in 0..l_anim_texuv {
            let f = |t : &mut PkoLmo_AnimDataTexuvSlot| Ok(t.set_params((self_rc.data_texuv_size()[_i as usize]).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_AnimDataTexuvSlot>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.anim_texuv.borrow_mut().push(t);
        }
        *self_rc.anim_teximg.borrow_mut() = Vec::new();
        let l_anim_teximg = 64;
        for _i in 0..l_anim_teximg {
            let f = |t : &mut PkoLmo_AnimDataTeximgSlot| Ok(t.set_params((self_rc.data_teximg_size()[_i as usize]).try_into().map_err(|_| KError::CastError)?, (*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_AnimDataTeximgSlot>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.anim_teximg.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_AnimSection {
    pub fn file_version(&self) -> Ref<'_, u32> {
        self.file_version.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn set_params(&mut self, file_version: u32) {
        *self.file_version.borrow_mut() = file_version;
    }
}
impl PkoLmo_AnimSection {
}
impl PkoLmo_AnimSection {
    pub fn legacy_prefix(&self) -> Ref<'_, u32> {
        self.legacy_prefix.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn data_bone_size(&self) -> Ref<'_, u32> {
        self.data_bone_size.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn data_mat_size(&self) -> Ref<'_, u32> {
        self.data_mat_size.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn data_mtlopac_size(&self) -> Ref<'_, Vec<u32>> {
        self.data_mtlopac_size.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn data_texuv_size(&self) -> Ref<'_, Vec<u32>> {
        self.data_texuv_size.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn data_teximg_size(&self) -> Ref<'_, Vec<u32>> {
        self.data_teximg_size.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn anim_bone(&self) -> Ref<'_, OptRc<PkoLmo_AnimDataBone>> {
        self.anim_bone.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn anim_mat(&self) -> Ref<'_, OptRc<PkoLmo_AnimDataMatrix>> {
        self.anim_mat.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn anim_mtlopac(&self) -> Ref<'_, Vec<OptRc<PkoLmo_AnimDataMtlopacSlot>>> {
        self.anim_mtlopac.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn anim_texuv(&self) -> Ref<'_, Vec<OptRc<PkoLmo_AnimDataTexuvSlot>>> {
        self.anim_texuv.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn anim_teximg(&self) -> Ref<'_, Vec<OptRc<PkoLmo_AnimDataTeximgSlot>>> {
        self.anim_teximg.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn anim_bone_raw(&self) -> Ref<'_, Vec<u8>> {
        self.anim_bone_raw.borrow()
    }
}
impl PkoLmo_AnimSection {
    pub fn anim_mat_raw(&self) -> Ref<'_, Vec<u8>> {
        self.anim_mat_raw.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_BlendInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MeshSection>,
    pub _self: SharedType<Self>,
    index_dword: RefCell<u32>,
    weight: RefCell<Vec<f32>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_BlendInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_MeshSection;

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
        *self_rc.index_dword.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.weight.borrow_mut() = Vec::new();
        let l_weight = 4;
        for _i in 0..l_weight {
            self_rc.weight.borrow_mut().push(_io.read_f4le()?.into());
        }
        Ok(())
    }
}
impl PkoLmo_BlendInfo {
}
impl PkoLmo_BlendInfo {
    pub fn index_dword(&self) -> Ref<'_, u32> {
        self.index_dword.borrow()
    }
}
impl PkoLmo_BlendInfo {
    pub fn weight(&self) -> Ref<'_, Vec<f32>> {
        self.weight.borrow()
    }
}
impl PkoLmo_BlendInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_BoneBaseInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataBone>,
    pub _self: SharedType<Self>,
    name: RefCell<Vec<u8>>,
    id: RefCell<u32>,
    parent_id: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_BoneBaseInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataBone;

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
impl PkoLmo_BoneBaseInfo {
}
impl PkoLmo_BoneBaseInfo {
    pub fn name(&self) -> Ref<'_, Vec<u8>> {
        self.name.borrow()
    }
}
impl PkoLmo_BoneBaseInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_BoneBaseInfo {
    pub fn parent_id(&self) -> Ref<'_, u32> {
        self.parent_id.borrow()
    }
}
impl PkoLmo_BoneBaseInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_BoneDummyInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataBone>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    parent_bone_id: RefCell<u32>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_BoneDummyInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataBone;

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
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_BoneDummyInfo {
}
impl PkoLmo_BoneDummyInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_BoneDummyInfo {
    pub fn parent_bone_id(&self) -> Ref<'_, u32> {
        self.parent_bone_id.borrow()
    }
}
impl PkoLmo_BoneDummyInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_BoneDummyInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_BoneInfoHeader {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataBone>,
    pub _self: SharedType<Self>,
    bone_num: RefCell<u32>,
    frame_num: RefCell<u32>,
    dummy_num: RefCell<u32>,
    key_type: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_BoneInfoHeader {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataBone;

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
        Ok(())
    }
}
impl PkoLmo_BoneInfoHeader {
}
impl PkoLmo_BoneInfoHeader {
    pub fn bone_num(&self) -> Ref<'_, u32> {
        self.bone_num.borrow()
    }
}
impl PkoLmo_BoneInfoHeader {
    pub fn frame_num(&self) -> Ref<'_, u32> {
        self.frame_num.borrow()
    }
}
impl PkoLmo_BoneInfoHeader {
    pub fn dummy_num(&self) -> Ref<'_, u32> {
        self.dummy_num.borrow()
    }
}
impl PkoLmo_BoneInfoHeader {
    pub fn key_type(&self) -> Ref<'_, u32> {
        self.key_type.borrow()
    }
}
impl PkoLmo_BoneInfoHeader {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_BoneKeyInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataBone>,
    pub _self: SharedType<Self>,
    key_type: RefCell<u32>,
    frame_num: RefCell<u32>,
    version: RefCell<u32>,
    parent_id: RefCell<u32>,
    mat43_seq: RefCell<Vec<OptRc<PkoLmo_Matrix43>>>,
    mat44_seq: RefCell<Vec<OptRc<PkoLmo_Matrix44>>>,
    pos_seq: RefCell<Vec<OptRc<PkoLmo_Vector3>>>,
    quat_seq: RefCell<Vec<OptRc<PkoLmo_Quaternion>>>,
    _io: RefCell<BytesReader>,
    f_pos_num: Cell<bool>,
    pos_num: RefCell<u32>,
}
impl KStruct for PkoLmo_BoneKeyInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataBone;

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
                let t = Self::read_into::<_, PkoLmo_Matrix43>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.mat43_seq.borrow_mut().push(t);
            }
        }
        if ((*self_rc.key_type() as u32) == (2 as u32)) {
            *self_rc.mat44_seq.borrow_mut() = Vec::new();
            let l_mat44_seq = *self_rc.frame_num();
            for _i in 0..l_mat44_seq {
                let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.mat44_seq.borrow_mut().push(t);
            }
        }
        if ((*self_rc.key_type() as u32) == (3 as u32)) {
            *self_rc.pos_seq.borrow_mut() = Vec::new();
            let l_pos_seq = *self_rc.pos_num()?;
            for _i in 0..l_pos_seq {
                let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.pos_seq.borrow_mut().push(t);
            }
        }
        if ((*self_rc.key_type() as u32) == (3 as u32)) {
            *self_rc.quat_seq.borrow_mut() = Vec::new();
            let l_quat_seq = *self_rc.frame_num();
            for _i in 0..l_quat_seq {
                let t = Self::read_into::<_, PkoLmo_Quaternion>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.quat_seq.borrow_mut().push(t);
            }
        }
        Ok(())
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn key_type(&self) -> Ref<'_, u32> {
        self.key_type.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn frame_num(&self) -> Ref<'_, u32> {
        self.frame_num.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn parent_id(&self) -> Ref<'_, u32> {
        self.parent_id.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn set_params(&mut self, key_type: u32, frame_num: u32, version: u32, parent_id: u32) {
        *self.key_type.borrow_mut() = key_type;
        *self.frame_num.borrow_mut() = frame_num;
        *self.version.borrow_mut() = version;
        *self.parent_id.borrow_mut() = parent_id;
    }
}
impl PkoLmo_BoneKeyInfo {
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
        *self.pos_num.borrow_mut() = (if ((*self.version() as i32) >= (4099 as i32)) { *self.frame_num() } else { if ((*self.parent_id() as i32) == (4294967295 as i32)) { *self.frame_num() } else { 1 } }) as u32;
        Ok(self.pos_num.borrow())
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn mat43_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Matrix43>>> {
        self.mat43_seq.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn mat44_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Matrix44>>> {
        self.mat44_seq.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn pos_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Vector3>>> {
        self.pos_seq.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn quat_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Quaternion>>> {
        self.quat_seq.borrow()
    }
}
impl PkoLmo_BoneKeyInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_BoundingBoxInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperSection>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    box: RefCell<OptRc<PkoLmo_Box>>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_BoundingBoxInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperSection;

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
        let t = Self::read_into::<_, PkoLmo_Box>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.box.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_BoundingBoxInfo {
}
impl PkoLmo_BoundingBoxInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_BoundingBoxInfo {
    pub fn box(&self) -> Ref<'_, OptRc<PkoLmo_Box>> {
        self.box.borrow()
    }
}
impl PkoLmo_BoundingBoxInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_BoundingBoxInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_BoundingSphereInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperSection>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    sphere: RefCell<OptRc<PkoLmo_Sphere>>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_BoundingSphereInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperSection;

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
        let t = Self::read_into::<_, PkoLmo_Sphere>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.sphere.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_BoundingSphereInfo {
}
impl PkoLmo_BoundingSphereInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_BoundingSphereInfo {
    pub fn sphere(&self) -> Ref<'_, OptRc<PkoLmo_Sphere>> {
        self.sphere.borrow()
    }
}
impl PkoLmo_BoundingSphereInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_BoundingSphereInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Box {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    center: RefCell<OptRc<PkoLmo_Vector3>>,
    radius: RefCell<OptRc<PkoLmo_Vector3>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_Box {
    type Root = PkoLmo;
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
        let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.center.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.radius.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_Box {
}
impl PkoLmo_Box {
    pub fn center(&self) -> Ref<'_, OptRc<PkoLmo_Vector3>> {
        self.center.borrow()
    }
}
impl PkoLmo_Box {
    pub fn radius(&self) -> Ref<'_, OptRc<PkoLmo_Vector3>> {
        self.radius.borrow()
    }
}
impl PkoLmo_Box {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_ColorValue4b {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    b: RefCell<u8>,
    g: RefCell<u8>,
    r: RefCell<u8>,
    a: RefCell<u8>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_ColorValue4b {
    type Root = PkoLmo;
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
        *self_rc.b.borrow_mut() = _io.read_u1()?.into();
        *self_rc.g.borrow_mut() = _io.read_u1()?.into();
        *self_rc.r.borrow_mut() = _io.read_u1()?.into();
        *self_rc.a.borrow_mut() = _io.read_u1()?.into();
        Ok(())
    }
}
impl PkoLmo_ColorValue4b {
}
impl PkoLmo_ColorValue4b {
    pub fn b(&self) -> Ref<'_, u8> {
        self.b.borrow()
    }
}
impl PkoLmo_ColorValue4b {
    pub fn g(&self) -> Ref<'_, u8> {
        self.g.borrow()
    }
}
impl PkoLmo_ColorValue4b {
    pub fn r(&self) -> Ref<'_, u8> {
        self.r.borrow()
    }
}
impl PkoLmo_ColorValue4b {
    pub fn a(&self) -> Ref<'_, u8> {
        self.a.borrow()
    }
}
impl PkoLmo_ColorValue4b {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_ColorValue4f {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_Material>,
    pub _self: SharedType<Self>,
    r: RefCell<f32>,
    g: RefCell<f32>,
    b: RefCell<f32>,
    a: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_ColorValue4f {
    type Root = PkoLmo;
    type Parent = PkoLmo_Material;

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
        *self_rc.r.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.g.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.b.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.a.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLmo_ColorValue4f {
}
impl PkoLmo_ColorValue4f {
    pub fn r(&self) -> Ref<'_, f32> {
        self.r.borrow()
    }
}
impl PkoLmo_ColorValue4f {
    pub fn g(&self) -> Ref<'_, f32> {
        self.g.borrow()
    }
}
impl PkoLmo_ColorValue4f {
    pub fn b(&self) -> Ref<'_, f32> {
        self.b.borrow()
    }
}
impl PkoLmo_ColorValue4f {
    pub fn a(&self) -> Ref<'_, f32> {
        self.a.borrow()
    }
}
impl PkoLmo_ColorValue4f {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_GeomObjInfoHeader {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeometryChunk>,
    pub _self: SharedType<Self>,
    file_version: RefCell<u32>,
    chunk_payload_size: RefCell<u32>,
    header_offset: RefCell<u32>,
    legacy: RefCell<OptRc<PkoLmo_GeomObjInfoHeaderLegacy>>,
    modern: RefCell<OptRc<PkoLmo_GeomObjInfoHeaderModern>>,
    _io: RefCell<BytesReader>,
    f_anim_size: Cell<bool>,
    anim_size: RefCell<u32>,
    f_geom_type: Cell<bool>,
    geom_type: RefCell<u32>,
    f_header_kind: Cell<bool>,
    header_kind: RefCell<i8>,
    f_helper_size: Cell<bool>,
    helper_size: RefCell<u32>,
    f_id: Cell<bool>,
    id: RefCell<u32>,
    f_legacy_anim_size_probe: Cell<bool>,
    legacy_anim_size_probe: RefCell<u32>,
    f_legacy_helper_size_probe: Cell<bool>,
    legacy_helper_size_probe: RefCell<u32>,
    f_legacy_mesh_size_probe: Cell<bool>,
    legacy_mesh_size_probe: RefCell<u32>,
    f_legacy_mtl_size_probe: Cell<bool>,
    legacy_mtl_size_probe: RefCell<u32>,
    f_legacy_plausible: Cell<bool>,
    legacy_plausible: RefCell<bool>,
    f_mat_local: Cell<bool>,
    mat_local: RefCell<OptRc<PkoLmo_Matrix44>>,
    f_mesh_size: Cell<bool>,
    mesh_size: RefCell<u32>,
    f_modern_anim_size_probe: Cell<bool>,
    modern_anim_size_probe: RefCell<u32>,
    f_modern_helper_size_probe: Cell<bool>,
    modern_helper_size_probe: RefCell<u32>,
    f_modern_mesh_size_probe: Cell<bool>,
    modern_mesh_size_probe: RefCell<u32>,
    f_modern_mtl_size_probe: Cell<bool>,
    modern_mtl_size_probe: RefCell<u32>,
    f_modern_plausible: Cell<bool>,
    modern_plausible: RefCell<bool>,
    f_mtl_size: Cell<bool>,
    mtl_size: RefCell<u32>,
    f_parent_id: Cell<bool>,
    parent_id: RefCell<u32>,
}
impl KStruct for PkoLmo_GeomObjInfoHeader {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeometryChunk;

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
        if *self_rc.header_kind()? == 0 {
            let t = Self::read_into::<_, PkoLmo_GeomObjInfoHeaderLegacy>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.legacy.borrow_mut() = t;
        }
        if *self_rc.header_kind()? == 1 {
            let t = Self::read_into::<_, PkoLmo_GeomObjInfoHeaderModern>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.modern.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn file_version(&self) -> Ref<'_, u32> {
        self.file_version.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn chunk_payload_size(&self) -> Ref<'_, u32> {
        self.chunk_payload_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn header_offset(&self) -> Ref<'_, u32> {
        self.header_offset.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn set_params(&mut self, file_version: u32, chunk_payload_size: u32, header_offset: u32) {
        *self.file_version.borrow_mut() = file_version;
        *self.chunk_payload_size.borrow_mut() = chunk_payload_size;
        *self.header_offset.borrow_mut() = header_offset;
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn anim_size(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_anim_size.get() {
            return Ok(self.anim_size.borrow());
        }
        self.f_anim_size.set(true);
        *self.anim_size.borrow_mut() = (if *self.header_kind()? == 0 { *self.legacy().anim_size() } else { *self.modern().anim_size() }) as u32;
        Ok(self.anim_size.borrow())
    }
    pub fn geom_type(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_geom_type.get() {
            return Ok(self.geom_type.borrow());
        }
        self.f_geom_type.set(true);
        *self.geom_type.borrow_mut() = (if *self.header_kind()? == 0 { *self.legacy().geom_type() } else { *self.modern().geom_type() }) as u32;
        Ok(self.geom_type.borrow())
    }
    pub fn header_kind(
        &self
    ) -> KResult<Ref<'_, i8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_header_kind.get() {
            return Ok(self.header_kind.borrow());
        }
        self.f_header_kind.set(true);
        *self.header_kind.borrow_mut() = (if ((*self.file_version() as u32) == (0 as u32)) { if *self.modern_plausible()? { 1 } else { 0 } } else { 1 }) as i8;
        Ok(self.header_kind.borrow())
    }
    pub fn helper_size(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_helper_size.get() {
            return Ok(self.helper_size.borrow());
        }
        self.f_helper_size.set(true);
        *self.helper_size.borrow_mut() = (if *self.header_kind()? == 0 { *self.legacy().helper_size() } else { *self.modern().helper_size() }) as u32;
        Ok(self.helper_size.borrow())
    }
    pub fn id(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_id.get() {
            return Ok(self.id.borrow());
        }
        self.f_id.set(true);
        *self.id.borrow_mut() = (if *self.header_kind()? == 0 { *self.legacy().id() } else { *self.modern().id() }) as u32;
        Ok(self.id.borrow())
    }
    pub fn legacy_anim_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_legacy_anim_size_probe.get() {
            return Ok(self.legacy_anim_size_probe.borrow());
        }
        self.f_legacy_anim_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (88 as u32)) as usize)?;
        *self.legacy_anim_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.legacy_anim_size_probe.borrow())
    }
    pub fn legacy_helper_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_legacy_helper_size_probe.get() {
            return Ok(self.legacy_helper_size_probe.borrow());
        }
        self.f_legacy_helper_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (84 as u32)) as usize)?;
        *self.legacy_helper_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.legacy_helper_size_probe.borrow())
    }
    pub fn legacy_mesh_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_legacy_mesh_size_probe.get() {
            return Ok(self.legacy_mesh_size_probe.borrow());
        }
        self.f_legacy_mesh_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (80 as u32)) as usize)?;
        *self.legacy_mesh_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.legacy_mesh_size_probe.borrow())
    }
    pub fn legacy_mtl_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_legacy_mtl_size_probe.get() {
            return Ok(self.legacy_mtl_size_probe.borrow());
        }
        self.f_legacy_mtl_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (76 as u32)) as usize)?;
        *self.legacy_mtl_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.legacy_mtl_size_probe.borrow())
    }
    pub fn legacy_plausible(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_legacy_plausible.get() {
            return Ok(self.legacy_plausible.borrow());
        }
        self.f_legacy_plausible.set(true);
        *self.legacy_plausible.borrow_mut() = (((((((((*self.legacy_mtl_size_probe()? as u32) + (*self.legacy_mesh_size_probe()? as u32)) as i32) + (*self.legacy_helper_size_probe()? as i32)) as i32) + (*self.legacy_anim_size_probe()? as i32)) as i32) <= (*self.chunk_payload_size() as i32))) as bool;
        Ok(self.legacy_plausible.borrow())
    }
    pub fn mat_local(
        &self
    ) -> KResult<Ref<'_, OptRc<PkoLmo_Matrix44>>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_mat_local.get() {
            return Ok(self.mat_local.borrow());
        }
        *self.mat_local.borrow_mut() = if *self.header_kind()? == 0 { self.legacy().mat_local().clone() } else { self.modern().mat_local().clone() }.clone();
        Ok(self.mat_local.borrow())
    }
    pub fn mesh_size(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_mesh_size.get() {
            return Ok(self.mesh_size.borrow());
        }
        self.f_mesh_size.set(true);
        *self.mesh_size.borrow_mut() = (if *self.header_kind()? == 0 { *self.legacy().mesh_size() } else { *self.modern().mesh_size() }) as u32;
        Ok(self.mesh_size.borrow())
    }
    pub fn modern_anim_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_modern_anim_size_probe.get() {
            return Ok(self.modern_anim_size_probe.borrow());
        }
        self.f_modern_anim_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (112 as u32)) as usize)?;
        *self.modern_anim_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.modern_anim_size_probe.borrow())
    }
    pub fn modern_helper_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_modern_helper_size_probe.get() {
            return Ok(self.modern_helper_size_probe.borrow());
        }
        self.f_modern_helper_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (108 as u32)) as usize)?;
        *self.modern_helper_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.modern_helper_size_probe.borrow())
    }
    pub fn modern_mesh_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_modern_mesh_size_probe.get() {
            return Ok(self.modern_mesh_size_probe.borrow());
        }
        self.f_modern_mesh_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (104 as u32)) as usize)?;
        *self.modern_mesh_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.modern_mesh_size_probe.borrow())
    }
    pub fn modern_mtl_size_probe(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_modern_mtl_size_probe.get() {
            return Ok(self.modern_mtl_size_probe.borrow());
        }
        self.f_modern_mtl_size_probe.set(true);
        let _pos = _io.pos();
        _io.seek(((*self.header_offset() as u32) + (100 as u32)) as usize)?;
        *self.modern_mtl_size_probe.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.modern_mtl_size_probe.borrow())
    }
    pub fn modern_plausible(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_modern_plausible.get() {
            return Ok(self.modern_plausible.borrow());
        }
        self.f_modern_plausible.set(true);
        *self.modern_plausible.borrow_mut() = (((((((((*self.modern_mtl_size_probe()? as u32) + (*self.modern_mesh_size_probe()? as u32)) as i32) + (*self.modern_helper_size_probe()? as i32)) as i32) + (*self.modern_anim_size_probe()? as i32)) as i32) <= (*self.chunk_payload_size() as i32))) as bool;
        Ok(self.modern_plausible.borrow())
    }
    pub fn mtl_size(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_mtl_size.get() {
            return Ok(self.mtl_size.borrow());
        }
        self.f_mtl_size.set(true);
        *self.mtl_size.borrow_mut() = (if *self.header_kind()? == 0 { *self.legacy().mtl_size() } else { *self.modern().mtl_size() }) as u32;
        Ok(self.mtl_size.borrow())
    }
    pub fn parent_id(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_parent_id.get() {
            return Ok(self.parent_id.borrow());
        }
        self.f_parent_id.set(true);
        *self.parent_id.borrow_mut() = (if *self.header_kind()? == 0 { *self.legacy().parent_id() } else { *self.modern().parent_id() }) as u32;
        Ok(self.parent_id.borrow())
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn legacy(&self) -> Ref<'_, OptRc<PkoLmo_GeomObjInfoHeaderLegacy>> {
        self.legacy.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn modern(&self) -> Ref<'_, OptRc<PkoLmo_GeomObjInfoHeaderModern>> {
        self.modern.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeader {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_GeomObjInfoHeaderLegacy {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeomObjInfoHeader>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    parent_id: RefCell<u32>,
    geom_type: RefCell<u32>,
    mat_local: RefCell<OptRc<PkoLmo_Matrix44>>,
    mtl_size: RefCell<u32>,
    mesh_size: RefCell<u32>,
    helper_size: RefCell<u32>,
    anim_size: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_GeomObjInfoHeaderLegacy {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeomObjInfoHeader;

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
        *self_rc.parent_id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.geom_type.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat_local.borrow_mut() = t;
        *self_rc.mtl_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.mesh_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.helper_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.anim_size.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn parent_id(&self) -> Ref<'_, u32> {
        self.parent_id.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn geom_type(&self) -> Ref<'_, u32> {
        self.geom_type.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn mat_local(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat_local.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn mtl_size(&self) -> Ref<'_, u32> {
        self.mtl_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn mesh_size(&self) -> Ref<'_, u32> {
        self.mesh_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn helper_size(&self) -> Ref<'_, u32> {
        self.helper_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn anim_size(&self) -> Ref<'_, u32> {
        self.anim_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderLegacy {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_GeomObjInfoHeaderModern {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeomObjInfoHeader>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    parent_id: RefCell<u32>,
    geom_type: RefCell<u32>,
    mat_local: RefCell<OptRc<PkoLmo_Matrix44>>,
    rcci: RefCell<OptRc<PkoLmo_RenderCtrlCreateInfo>>,
    state_ctrl: RefCell<OptRc<PkoLmo_StateCtrl>>,
    mtl_size: RefCell<u32>,
    mesh_size: RefCell<u32>,
    helper_size: RefCell<u32>,
    anim_size: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_GeomObjInfoHeaderModern {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeomObjInfoHeader;

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
        *self_rc.parent_id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.geom_type.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat_local.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_RenderCtrlCreateInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.rcci.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_StateCtrl>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.state_ctrl.borrow_mut() = t;
        *self_rc.mtl_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.mesh_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.helper_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.anim_size.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn parent_id(&self) -> Ref<'_, u32> {
        self.parent_id.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn geom_type(&self) -> Ref<'_, u32> {
        self.geom_type.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn mat_local(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat_local.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn rcci(&self) -> Ref<'_, OptRc<PkoLmo_RenderCtrlCreateInfo>> {
        self.rcci.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn state_ctrl(&self) -> Ref<'_, OptRc<PkoLmo_StateCtrl>> {
        self.state_ctrl.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn mtl_size(&self) -> Ref<'_, u32> {
        self.mtl_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn mesh_size(&self) -> Ref<'_, u32> {
        self.mesh_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn helper_size(&self) -> Ref<'_, u32> {
        self.helper_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn anim_size(&self) -> Ref<'_, u32> {
        self.anim_size.borrow()
    }
}
impl PkoLmo_GeomObjInfoHeaderModern {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_GeometryChunk {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    file_version: RefCell<u32>,
    has_outer_legacy_prefix: RefCell<u8>,
    legacy_prefix: RefCell<u32>,
    header: RefCell<OptRc<PkoLmo_GeomObjInfoHeader>>,
    material: RefCell<OptRc<PkoLmo_MaterialSection>>,
    mesh: RefCell<OptRc<PkoLmo_MeshSection>>,
    helper: RefCell<OptRc<PkoLmo_HelperSection>>,
    anim: RefCell<OptRc<PkoLmo_AnimSection>>,
    _io: RefCell<BytesReader>,
    material_raw: RefCell<Vec<u8>>,
    mesh_raw: RefCell<Vec<u8>>,
    helper_raw: RefCell<Vec<u8>>,
    anim_raw: RefCell<Vec<u8>>,
    f_chunk_payload_size: Cell<bool>,
    chunk_payload_size: RefCell<i32>,
    f_header_offset: Cell<bool>,
    header_offset: RefCell<i8>,
}
impl KStruct for PkoLmo_GeometryChunk {
    type Root = PkoLmo;
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
        if  ((((*self_rc.file_version() as u32) == (0 as u32))) && (((*self_rc.has_outer_legacy_prefix() as u8) != (0 as u8))))  {
            *self_rc.legacy_prefix.borrow_mut() = _io.read_u4le()?.into();
        }
        let f = |t : &mut PkoLmo_GeomObjInfoHeader| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?, (*self_rc.chunk_payload_size()?).try_into().map_err(|_| KError::CastError)?, (*self_rc.header_offset()?).try_into().map_err(|_| KError::CastError)?));
        let t = Self::read_into_with_init::<_, PkoLmo_GeomObjInfoHeader>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
        *self_rc.header.borrow_mut() = t;
        if ((*self_rc.header().mtl_size()? as u32) > (0 as u32)) {
            *self_rc.material_raw.borrow_mut() = _io.read_bytes(*self_rc.header().mtl_size()? as usize)?.into();
            let material_raw = self_rc.material_raw.borrow();
            let _t_material_raw_io = BytesReader::from(material_raw.clone());
            let f = |t : &mut PkoLmo_MaterialSection| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_MaterialSection>(&_t_material_raw_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            *self_rc.material.borrow_mut() = t;
        }
        if ((*self_rc.header().mesh_size()? as u32) > (0 as u32)) {
            *self_rc.mesh_raw.borrow_mut() = _io.read_bytes(*self_rc.header().mesh_size()? as usize)?.into();
            let mesh_raw = self_rc.mesh_raw.borrow();
            let _t_mesh_raw_io = BytesReader::from(mesh_raw.clone());
            let f = |t : &mut PkoLmo_MeshSection| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_MeshSection>(&_t_mesh_raw_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            *self_rc.mesh.borrow_mut() = t;
        }
        if ((*self_rc.header().helper_size()? as u32) > (0 as u32)) {
            *self_rc.helper_raw.borrow_mut() = _io.read_bytes(*self_rc.header().helper_size()? as usize)?.into();
            let helper_raw = self_rc.helper_raw.borrow();
            let _t_helper_raw_io = BytesReader::from(helper_raw.clone());
            let f = |t : &mut PkoLmo_HelperSection| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_HelperSection>(&_t_helper_raw_io, Some(self_rc._root.clone()), None, &f)?.into();
            *self_rc.helper.borrow_mut() = t;
        }
        if ((*self_rc.header().anim_size()? as u32) > (0 as u32)) {
            *self_rc.anim_raw.borrow_mut() = _io.read_bytes(*self_rc.header().anim_size()? as usize)?.into();
            let anim_raw = self_rc.anim_raw.borrow();
            let _t_anim_raw_io = BytesReader::from(anim_raw.clone());
            let f = |t : &mut PkoLmo_AnimSection| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_AnimSection>(&_t_anim_raw_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            *self_rc.anim.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_GeometryChunk {
    pub fn file_version(&self) -> Ref<'_, u32> {
        self.file_version.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn has_outer_legacy_prefix(&self) -> Ref<'_, u8> {
        self.has_outer_legacy_prefix.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn set_params(&mut self, file_version: u32, has_outer_legacy_prefix: u8) {
        *self.file_version.borrow_mut() = file_version;
        *self.has_outer_legacy_prefix.borrow_mut() = has_outer_legacy_prefix;
    }
}
impl PkoLmo_GeometryChunk {
    pub fn chunk_payload_size(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_chunk_payload_size.get() {
            return Ok(self.chunk_payload_size.borrow());
        }
        self.f_chunk_payload_size.set(true);
        *self.chunk_payload_size.borrow_mut() = (if  ((((*self.file_version() as u32) == (0 as u32))) && (((*self.has_outer_legacy_prefix() as u8) != (0 as u8))))  { ((*_io.size() as i32) - (4 as i32)) } else { *_io.size() }) as i32;
        Ok(self.chunk_payload_size.borrow())
    }
    pub fn header_offset(
        &self
    ) -> KResult<Ref<'_, i8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_header_offset.get() {
            return Ok(self.header_offset.borrow());
        }
        self.f_header_offset.set(true);
        *self.header_offset.borrow_mut() = (if  ((((*self.file_version() as u32) == (0 as u32))) && (((*self.has_outer_legacy_prefix() as u8) != (0 as u8))))  { 4 } else { 0 }) as i8;
        Ok(self.header_offset.borrow())
    }
}
impl PkoLmo_GeometryChunk {
    pub fn legacy_prefix(&self) -> Ref<'_, u32> {
        self.legacy_prefix.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn header(&self) -> Ref<'_, OptRc<PkoLmo_GeomObjInfoHeader>> {
        self.header.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn material(&self) -> Ref<'_, OptRc<PkoLmo_MaterialSection>> {
        self.material.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn mesh(&self) -> Ref<'_, OptRc<PkoLmo_MeshSection>> {
        self.mesh.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn helper(&self) -> Ref<'_, OptRc<PkoLmo_HelperSection>> {
        self.helper.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn anim(&self) -> Ref<'_, OptRc<PkoLmo_AnimSection>> {
        self.anim.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn material_raw(&self) -> Ref<'_, Vec<u8>> {
        self.material_raw.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn mesh_raw(&self) -> Ref<'_, Vec<u8>> {
        self.mesh_raw.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn helper_raw(&self) -> Ref<'_, Vec<u8>> {
        self.helper_raw.borrow()
    }
}
impl PkoLmo_GeometryChunk {
    pub fn anim_raw(&self) -> Ref<'_, Vec<u8>> {
        self.anim_raw.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperBoxInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperSection>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    type: RefCell<u32>,
    state: RefCell<u32>,
    box: RefCell<OptRc<PkoLmo_Box>>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    name: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_HelperBoxInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperSection;

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
        *self_rc.type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.state.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_Box>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.box.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        *self_rc.name.borrow_mut() = _io.read_bytes(32 as usize)?.into();
        Ok(())
    }
}
impl PkoLmo_HelperBoxInfo {
}
impl PkoLmo_HelperBoxInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_HelperBoxInfo {
    pub fn type(&self) -> Ref<'_, u32> {
        self.type.borrow()
    }
}
impl PkoLmo_HelperBoxInfo {
    pub fn state(&self) -> Ref<'_, u32> {
        self.state.borrow()
    }
}
impl PkoLmo_HelperBoxInfo {
    pub fn box(&self) -> Ref<'_, OptRc<PkoLmo_Box>> {
        self.box.borrow()
    }
}
impl PkoLmo_HelperBoxInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_HelperBoxInfo {
    pub fn name(&self) -> Ref<'_, Vec<u8>> {
        self.name.borrow()
    }
}
impl PkoLmo_HelperBoxInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperDummyEntry {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperSection>,
    pub _self: SharedType<Self>,
    effective_version: RefCell<u32>,
    as_1000: RefCell<OptRc<PkoLmo_HelperDummyInfo1000>>,
    as_current: RefCell<OptRc<PkoLmo_HelperDummyInfo>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_HelperDummyEntry {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperSection;

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
        if ((*self_rc.effective_version() as i32) <= (4096 as i32)) {
            let t = Self::read_into::<_, PkoLmo_HelperDummyInfo1000>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.as_1000.borrow_mut() = t;
        }
        if ((*self_rc.effective_version() as i32) >= (4097 as i32)) {
            let t = Self::read_into::<_, PkoLmo_HelperDummyInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.as_current.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_HelperDummyEntry {
    pub fn effective_version(&self) -> Ref<'_, u32> {
        self.effective_version.borrow()
    }
}
impl PkoLmo_HelperDummyEntry {
    pub fn set_params(&mut self, effective_version: u32) {
        *self.effective_version.borrow_mut() = effective_version;
    }
}
impl PkoLmo_HelperDummyEntry {
}
impl PkoLmo_HelperDummyEntry {
    pub fn as_1000(&self) -> Ref<'_, OptRc<PkoLmo_HelperDummyInfo1000>> {
        self.as_1000.borrow()
    }
}
impl PkoLmo_HelperDummyEntry {
    pub fn as_current(&self) -> Ref<'_, OptRc<PkoLmo_HelperDummyInfo>> {
        self.as_current.borrow()
    }
}
impl PkoLmo_HelperDummyEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperDummyInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperDummyEntry>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    mat_local: RefCell<OptRc<PkoLmo_Matrix44>>,
    parent_type: RefCell<u32>,
    parent_id: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_HelperDummyInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperDummyEntry;

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
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat_local.borrow_mut() = t;
        *self_rc.parent_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.parent_id.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_HelperDummyInfo {
}
impl PkoLmo_HelperDummyInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_HelperDummyInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_HelperDummyInfo {
    pub fn mat_local(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat_local.borrow()
    }
}
impl PkoLmo_HelperDummyInfo {
    pub fn parent_type(&self) -> Ref<'_, u32> {
        self.parent_type.borrow()
    }
}
impl PkoLmo_HelperDummyInfo {
    pub fn parent_id(&self) -> Ref<'_, u32> {
        self.parent_id.borrow()
    }
}
impl PkoLmo_HelperDummyInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperDummyInfo1000 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperDummyEntry>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_HelperDummyInfo1000 {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperDummyEntry;

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
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_HelperDummyInfo1000 {
}
impl PkoLmo_HelperDummyInfo1000 {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_HelperDummyInfo1000 {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_HelperDummyInfo1000 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperDummyObjInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_ModelNodeInfo>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    anim_data_flag: RefCell<u32>,
    anim_data: RefCell<OptRc<PkoLmo_AnimDataMatrix>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_HelperDummyObjInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_ModelNodeInfo;

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
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        *self_rc.anim_data_flag.borrow_mut() = _io.read_u4le()?.into();
        if ((*self_rc.anim_data_flag() as u32) == (1 as u32)) {
            let t = Self::read_into::<_, PkoLmo_AnimDataMatrix>(&*_io, Some(self_rc._root.clone()), None)?.into();
            *self_rc.anim_data.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_HelperDummyObjInfo {
}
impl PkoLmo_HelperDummyObjInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_HelperDummyObjInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_HelperDummyObjInfo {
    pub fn anim_data_flag(&self) -> Ref<'_, u32> {
        self.anim_data_flag.borrow()
    }
}
impl PkoLmo_HelperDummyObjInfo {
    pub fn anim_data(&self) -> Ref<'_, OptRc<PkoLmo_AnimDataMatrix>> {
        self.anim_data.borrow()
    }
}
impl PkoLmo_HelperDummyObjInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperMeshFaceInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperMeshInfo>,
    pub _self: SharedType<Self>,
    vertex: RefCell<Vec<u32>>,
    adj_face: RefCell<Vec<u32>>,
    plane: RefCell<OptRc<PkoLmo_Plane>>,
    center: RefCell<OptRc<PkoLmo_Vector3>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_HelperMeshFaceInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperMeshInfo;

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
        *self_rc.vertex.borrow_mut() = Vec::new();
        let l_vertex = 3;
        for _i in 0..l_vertex {
            self_rc.vertex.borrow_mut().push(_io.read_u4le()?.into());
        }
        *self_rc.adj_face.borrow_mut() = Vec::new();
        let l_adj_face = 3;
        for _i in 0..l_adj_face {
            self_rc.adj_face.borrow_mut().push(_io.read_u4le()?.into());
        }
        let t = Self::read_into::<_, PkoLmo_Plane>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.plane.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.center.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_HelperMeshFaceInfo {
}
impl PkoLmo_HelperMeshFaceInfo {
    pub fn vertex(&self) -> Ref<'_, Vec<u32>> {
        self.vertex.borrow()
    }
}
impl PkoLmo_HelperMeshFaceInfo {
    pub fn adj_face(&self) -> Ref<'_, Vec<u32>> {
        self.adj_face.borrow()
    }
}
impl PkoLmo_HelperMeshFaceInfo {
    pub fn plane(&self) -> Ref<'_, OptRc<PkoLmo_Plane>> {
        self.plane.borrow()
    }
}
impl PkoLmo_HelperMeshFaceInfo {
    pub fn center(&self) -> Ref<'_, OptRc<PkoLmo_Vector3>> {
        self.center.borrow()
    }
}
impl PkoLmo_HelperMeshFaceInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperMeshInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperSection>,
    pub _self: SharedType<Self>,
    id: RefCell<u32>,
    type: RefCell<u32>,
    sub_type: RefCell<u32>,
    name: RefCell<Vec<u8>>,
    state: RefCell<u32>,
    mat: RefCell<OptRc<PkoLmo_Matrix44>>,
    box: RefCell<OptRc<PkoLmo_Box>>,
    vertex_num: RefCell<u32>,
    face_num: RefCell<u32>,
    vertex_seq: RefCell<Vec<OptRc<PkoLmo_Vector3>>>,
    face_seq: RefCell<Vec<OptRc<PkoLmo_HelperMeshFaceInfo>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_HelperMeshInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperSection;

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
        *self_rc.type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.sub_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.name.borrow_mut() = _io.read_bytes(32 as usize)?.into();
        *self_rc.state.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_Matrix44>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mat.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_Box>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.box.borrow_mut() = t;
        *self_rc.vertex_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.face_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.vertex_seq.borrow_mut() = Vec::new();
        let l_vertex_seq = *self_rc.vertex_num();
        for _i in 0..l_vertex_seq {
            let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.vertex_seq.borrow_mut().push(t);
        }
        *self_rc.face_seq.borrow_mut() = Vec::new();
        let l_face_seq = *self_rc.face_num();
        for _i in 0..l_face_seq {
            let t = Self::read_into::<_, PkoLmo_HelperMeshFaceInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.face_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_HelperMeshInfo {
}
impl PkoLmo_HelperMeshInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn type(&self) -> Ref<'_, u32> {
        self.type.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn sub_type(&self) -> Ref<'_, u32> {
        self.sub_type.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn name(&self) -> Ref<'_, Vec<u8>> {
        self.name.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn state(&self) -> Ref<'_, u32> {
        self.state.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn mat(&self) -> Ref<'_, OptRc<PkoLmo_Matrix44>> {
        self.mat.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn box(&self) -> Ref<'_, OptRc<PkoLmo_Box>> {
        self.box.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn vertex_num(&self) -> Ref<'_, u32> {
        self.vertex_num.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn face_num(&self) -> Ref<'_, u32> {
        self.face_num.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn vertex_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Vector3>>> {
        self.vertex_seq.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn face_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_HelperMeshFaceInfo>>> {
        self.face_seq.borrow()
    }
}
impl PkoLmo_HelperMeshInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_HelperSection {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    file_version: RefCell<u32>,
    legacy_prefix: RefCell<u32>,
    helper_type: RefCell<u32>,
    dummy_num: RefCell<u32>,
    dummy_seq: RefCell<Vec<OptRc<PkoLmo_HelperDummyEntry>>>,
    box_num: RefCell<u32>,
    box_seq: RefCell<Vec<OptRc<PkoLmo_HelperBoxInfo>>>,
    mesh_num: RefCell<u32>,
    mesh_seq: RefCell<Vec<OptRc<PkoLmo_HelperMeshInfo>>>,
    bbox_num: RefCell<u32>,
    bbox_seq: RefCell<Vec<OptRc<PkoLmo_BoundingBoxInfo>>>,
    bsphere_num: RefCell<u32>,
    bsphere_seq: RefCell<Vec<OptRc<PkoLmo_BoundingSphereInfo>>>,
    _io: RefCell<BytesReader>,
    f_effective_version: Cell<bool>,
    effective_version: RefCell<i32>,
}
impl KStruct for PkoLmo_HelperSection {
    type Root = PkoLmo;
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
        if ((*self_rc.file_version() as u32) == (0 as u32)) {
            *self_rc.legacy_prefix.borrow_mut() = _io.read_u4le()?.into();
        }
        *self_rc.helper_type.borrow_mut() = _io.read_u4le()?.into();
        if ((((*self_rc.helper_type() as u32) & (1 as u32)) as i32) != (0 as i32)) {
            *self_rc.dummy_num.borrow_mut() = _io.read_u4le()?.into();
        }
        if ((((*self_rc.helper_type() as u32) & (1 as u32)) as i32) != (0 as i32)) {
            *self_rc.dummy_seq.borrow_mut() = Vec::new();
            let l_dummy_seq = *self_rc.dummy_num();
            for _i in 0..l_dummy_seq {
                let f = |t : &mut PkoLmo_HelperDummyEntry| Ok(t.set_params((*self_rc.effective_version()?).try_into().map_err(|_| KError::CastError)?));
                let t = Self::read_into_with_init::<_, PkoLmo_HelperDummyEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
                self_rc.dummy_seq.borrow_mut().push(t);
            }
        }
        if ((((*self_rc.helper_type() as u32) & (2 as u32)) as i32) != (0 as i32)) {
            *self_rc.box_num.borrow_mut() = _io.read_u4le()?.into();
        }
        if ((((*self_rc.helper_type() as u32) & (2 as u32)) as i32) != (0 as i32)) {
            *self_rc.box_seq.borrow_mut() = Vec::new();
            let l_box_seq = *self_rc.box_num();
            for _i in 0..l_box_seq {
                let t = Self::read_into::<_, PkoLmo_HelperBoxInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.box_seq.borrow_mut().push(t);
            }
        }
        if ((((*self_rc.helper_type() as u32) & (4 as u32)) as i32) != (0 as i32)) {
            *self_rc.mesh_num.borrow_mut() = _io.read_u4le()?.into();
        }
        if ((((*self_rc.helper_type() as u32) & (4 as u32)) as i32) != (0 as i32)) {
            *self_rc.mesh_seq.borrow_mut() = Vec::new();
            let l_mesh_seq = *self_rc.mesh_num();
            for _i in 0..l_mesh_seq {
                let t = Self::read_into::<_, PkoLmo_HelperMeshInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.mesh_seq.borrow_mut().push(t);
            }
        }
        if ((((*self_rc.helper_type() as u32) & (16 as u32)) as i32) != (0 as i32)) {
            *self_rc.bbox_num.borrow_mut() = _io.read_u4le()?.into();
        }
        if ((((*self_rc.helper_type() as u32) & (16 as u32)) as i32) != (0 as i32)) {
            *self_rc.bbox_seq.borrow_mut() = Vec::new();
            let l_bbox_seq = *self_rc.bbox_num();
            for _i in 0..l_bbox_seq {
                let t = Self::read_into::<_, PkoLmo_BoundingBoxInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.bbox_seq.borrow_mut().push(t);
            }
        }
        if ((((*self_rc.helper_type() as u32) & (32 as u32)) as i32) != (0 as i32)) {
            *self_rc.bsphere_num.borrow_mut() = _io.read_u4le()?.into();
        }
        if ((((*self_rc.helper_type() as u32) & (32 as u32)) as i32) != (0 as i32)) {
            *self_rc.bsphere_seq.borrow_mut() = Vec::new();
            let l_bsphere_seq = *self_rc.bsphere_num();
            for _i in 0..l_bsphere_seq {
                let t = Self::read_into::<_, PkoLmo_BoundingSphereInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.bsphere_seq.borrow_mut().push(t);
            }
        }
        Ok(())
    }
}
impl PkoLmo_HelperSection {
    pub fn file_version(&self) -> Ref<'_, u32> {
        self.file_version.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn set_params(&mut self, file_version: u32) {
        *self.file_version.borrow_mut() = file_version;
    }
}
impl PkoLmo_HelperSection {
    pub fn effective_version(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_effective_version.get() {
            return Ok(self.effective_version.borrow());
        }
        self.f_effective_version.set(true);
        *self.effective_version.borrow_mut() = (if ((*self.file_version() as u32) == (0 as u32)) { *self.legacy_prefix() } else { *self.file_version() }) as i32;
        Ok(self.effective_version.borrow())
    }
}
impl PkoLmo_HelperSection {
    pub fn legacy_prefix(&self) -> Ref<'_, u32> {
        self.legacy_prefix.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn helper_type(&self) -> Ref<'_, u32> {
        self.helper_type.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn dummy_num(&self) -> Ref<'_, u32> {
        self.dummy_num.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn dummy_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_HelperDummyEntry>>> {
        self.dummy_seq.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn box_num(&self) -> Ref<'_, u32> {
        self.box_num.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn box_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_HelperBoxInfo>>> {
        self.box_seq.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn mesh_num(&self) -> Ref<'_, u32> {
        self.mesh_num.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn mesh_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_HelperMeshInfo>>> {
        self.mesh_seq.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn bbox_num(&self) -> Ref<'_, u32> {
        self.bbox_num.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn bbox_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_BoundingBoxInfo>>> {
        self.bbox_seq.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn bsphere_num(&self) -> Ref<'_, u32> {
        self.bsphere_num.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn bsphere_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_BoundingSphereInfo>>> {
        self.bsphere_seq.borrow()
    }
}
impl PkoLmo_HelperSection {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_KeyFloat {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_AnimDataMtlOpacity>,
    pub _self: SharedType<Self>,
    key: RefCell<u32>,
    slerp_type: RefCell<u32>,
    data: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_KeyFloat {
    type Root = PkoLmo;
    type Parent = PkoLmo_AnimDataMtlOpacity;

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
        *self_rc.key.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.slerp_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.data.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLmo_KeyFloat {
}
impl PkoLmo_KeyFloat {
    pub fn key(&self) -> Ref<'_, u32> {
        self.key.borrow()
    }
}
impl PkoLmo_KeyFloat {
    pub fn slerp_type(&self) -> Ref<'_, u32> {
        self.slerp_type.borrow()
    }
}
impl PkoLmo_KeyFloat {
    pub fn data(&self) -> Ref<'_, f32> {
        self.data.borrow()
    }
}
impl PkoLmo_KeyFloat {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Material {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    dif: RefCell<OptRc<PkoLmo_ColorValue4f>>,
    amb: RefCell<OptRc<PkoLmo_ColorValue4f>>,
    spe: RefCell<OptRc<PkoLmo_ColorValue4f>>,
    emi: RefCell<OptRc<PkoLmo_ColorValue4f>>,
    power: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_Material {
    type Root = PkoLmo;
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
        let t = Self::read_into::<_, PkoLmo_ColorValue4f>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.dif.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_ColorValue4f>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.amb.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_ColorValue4f>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.spe.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_ColorValue4f>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.emi.borrow_mut() = t;
        *self_rc.power.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLmo_Material {
}
impl PkoLmo_Material {
    pub fn dif(&self) -> Ref<'_, OptRc<PkoLmo_ColorValue4f>> {
        self.dif.borrow()
    }
}
impl PkoLmo_Material {
    pub fn amb(&self) -> Ref<'_, OptRc<PkoLmo_ColorValue4f>> {
        self.amb.borrow()
    }
}
impl PkoLmo_Material {
    pub fn spe(&self) -> Ref<'_, OptRc<PkoLmo_ColorValue4f>> {
        self.spe.borrow()
    }
}
impl PkoLmo_Material {
    pub fn emi(&self) -> Ref<'_, OptRc<PkoLmo_ColorValue4f>> {
        self.emi.borrow()
    }
}
impl PkoLmo_Material {
    pub fn power(&self) -> Ref<'_, f32> {
        self.power.borrow()
    }
}
impl PkoLmo_Material {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MaterialSection {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeometryChunk>,
    pub _self: SharedType<Self>,
    file_version: RefCell<u32>,
    legacy_prefix: RefCell<u32>,
    mtl_num: RefCell<u32>,
    mtl_entries: RefCell<Vec<OptRc<PkoLmo_MtlEntry>>>,
    legacy_extra_mtl_seq: RefCell<Vec<OptRc<PkoLmo_Material>>>,
    payload: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
    f_effective_version: Cell<bool>,
    effective_version: RefCell<i32>,
    f_first_u4: Cell<bool>,
    first_u4: RefCell<u32>,
    f_format_hint: Cell<bool>,
    format_hint: RefCell<i32>,
    f_has_legacy_prefix: Cell<bool>,
    has_legacy_prefix: RefCell<bool>,
    f_known_version_marker: Cell<bool>,
    known_version_marker: RefCell<bool>,
    f_legacy_extra_mtl_possible: Cell<bool>,
    legacy_extra_mtl_possible: RefCell<bool>,
    f_second_u4: Cell<bool>,
    second_u4: RefCell<u32>,
}
impl KStruct for PkoLmo_MaterialSection {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeometryChunk;

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
        if *self_rc.has_legacy_prefix()? {
            *self_rc.legacy_prefix.borrow_mut() = _io.read_u4le()?.into();
        }
        *self_rc.mtl_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.mtl_entries.borrow_mut() = Vec::new();
        let l_mtl_entries = *self_rc.mtl_num();
        for _i in 0..l_mtl_entries {
            let f = |t : &mut PkoLmo_MtlEntry| Ok(t.set_params((*self_rc.format_hint()?).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_MtlEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.mtl_entries.borrow_mut().push(t);
        }
        if *self_rc.legacy_extra_mtl_possible()? {
            *self_rc.legacy_extra_mtl_seq.borrow_mut() = Vec::new();
            let l_legacy_extra_mtl_seq = *self_rc.mtl_num();
            for _i in 0..l_legacy_extra_mtl_seq {
                let t = Self::read_into::<_, PkoLmo_Material>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.legacy_extra_mtl_seq.borrow_mut().push(t);
            }
        }
        *self_rc.payload.borrow_mut() = _io.read_bytes_full()?.into();
        Ok(())
    }
}
impl PkoLmo_MaterialSection {
    pub fn file_version(&self) -> Ref<'_, u32> {
        self.file_version.borrow()
    }
}
impl PkoLmo_MaterialSection {
    pub fn set_params(&mut self, file_version: u32) {
        *self.file_version.borrow_mut() = file_version;
    }
}
impl PkoLmo_MaterialSection {
    pub fn effective_version(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_effective_version.get() {
            return Ok(self.effective_version.borrow());
        }
        self.f_effective_version.set(true);
        *self.effective_version.borrow_mut() = (if ((*self.file_version() as u32) == (0 as u32)) { if *self.has_legacy_prefix()? { *self.legacy_prefix() } else { 4096 } } else { *self.file_version() }) as i32;
        Ok(self.effective_version.borrow())
    }
    pub fn first_u4(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_first_u4.get() {
            return Ok(self.first_u4.borrow());
        }
        self.f_first_u4.set(true);
        let _pos = _io.pos();
        _io.seek(0 as usize)?;
        *self.first_u4.borrow_mut() = _io.read_u4le()?.into();
        _io.seek(_pos)?;
        Ok(self.first_u4.borrow())
    }
    pub fn format_hint(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_format_hint.get() {
            return Ok(self.format_hint.borrow());
        }
        self.f_format_hint.set(true);
        *self.format_hint.borrow_mut() = (if ((*self.effective_version()? as i32) == (0 as i32)) { 0 } else { if ((*self.effective_version()? as i32) == (1 as i32)) { 1 } else { if ((*self.effective_version()? as i32) == (2 as i32)) { 2 } else { 1000 } } }) as i32;
        Ok(self.format_hint.borrow())
    }
    pub fn has_legacy_prefix(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_has_legacy_prefix.get() {
            return Ok(self.has_legacy_prefix.borrow());
        }
        self.f_has_legacy_prefix.set(true);
        *self.has_legacy_prefix.borrow_mut() = ( ((((*self.file_version() as u32) == (0 as u32))) && (((*_io.size() as i32) >= (8 as i32))) && (*self.known_version_marker()?) && (((*self.second_u4()? as i32) <= (65535 as i32)))) ) as bool;
        Ok(self.has_legacy_prefix.borrow())
    }
    pub fn known_version_marker(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_known_version_marker.get() {
            return Ok(self.known_version_marker.borrow());
        }
        self.f_known_version_marker.set(true);
        *self.known_version_marker.borrow_mut() = ( ((((*self.first_u4()? as u32) == (0 as u32))) || (((*self.first_u4()? as u32) == (1 as u32))) || (((*self.first_u4()? as u32) == (2 as u32))) || (((*self.first_u4()? as i32) == (4096 as i32))) || (((*self.first_u4()? as i32) == (4097 as i32))) || (((*self.first_u4()? as i32) == (4098 as i32))) || (((*self.first_u4()? as i32) == (4099 as i32))) || (((*self.first_u4()? as i32) == (4100 as i32))) || (((*self.first_u4()? as i32) == (4101 as i32)))) ) as bool;
        Ok(self.known_version_marker.borrow())
    }
    pub fn legacy_extra_mtl_possible(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_legacy_extra_mtl_possible.get() {
            return Ok(self.legacy_extra_mtl_possible.borrow());
        }
        self.f_legacy_extra_mtl_possible.set(true);
        *self.legacy_extra_mtl_possible.borrow_mut() = ( ((((*self.file_version() as u32) == (0 as u32))) && (!(*self.has_legacy_prefix()?)) && (*self.format_hint()? == 1000) && (((*_io.size() as i32) - (_io.pos() as i32)) == ((*self.mtl_num() as u32) * (68 as u32)))) ) as bool;
        Ok(self.legacy_extra_mtl_possible.borrow())
    }
    pub fn second_u4(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_second_u4.get() {
            return Ok(self.second_u4.borrow());
        }
        self.f_second_u4.set(true);
        if ((*_io.size() as i32) >= (8 as i32)) {
            let _pos = _io.pos();
            _io.seek(4 as usize)?;
            *self.second_u4.borrow_mut() = _io.read_u4le()?.into();
            _io.seek(_pos)?;
        }
        Ok(self.second_u4.borrow())
    }
}
impl PkoLmo_MaterialSection {
    pub fn legacy_prefix(&self) -> Ref<'_, u32> {
        self.legacy_prefix.borrow()
    }
}
impl PkoLmo_MaterialSection {
    pub fn mtl_num(&self) -> Ref<'_, u32> {
        self.mtl_num.borrow()
    }
}
impl PkoLmo_MaterialSection {
    pub fn mtl_entries(&self) -> Ref<'_, Vec<OptRc<PkoLmo_MtlEntry>>> {
        self.mtl_entries.borrow()
    }
}
impl PkoLmo_MaterialSection {
    pub fn legacy_extra_mtl_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Material>>> {
        self.legacy_extra_mtl_seq.borrow()
    }
}
impl PkoLmo_MaterialSection {
    pub fn payload(&self) -> Ref<'_, Vec<u8>> {
        self.payload.borrow()
    }
}
impl PkoLmo_MaterialSection {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Matrix43 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
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
impl KStruct for PkoLmo_Matrix43 {
    type Root = PkoLmo;
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
impl PkoLmo_Matrix43 {
}
impl PkoLmo_Matrix43 {
    pub fn m11(&self) -> Ref<'_, f32> {
        self.m11.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m12(&self) -> Ref<'_, f32> {
        self.m12.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m13(&self) -> Ref<'_, f32> {
        self.m13.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m21(&self) -> Ref<'_, f32> {
        self.m21.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m22(&self) -> Ref<'_, f32> {
        self.m22.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m23(&self) -> Ref<'_, f32> {
        self.m23.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m31(&self) -> Ref<'_, f32> {
        self.m31.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m32(&self) -> Ref<'_, f32> {
        self.m32.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m33(&self) -> Ref<'_, f32> {
        self.m33.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m41(&self) -> Ref<'_, f32> {
        self.m41.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m42(&self) -> Ref<'_, f32> {
        self.m42.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn m43(&self) -> Ref<'_, f32> {
        self.m43.borrow()
    }
}
impl PkoLmo_Matrix43 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Matrix44 {
    pub _root: SharedType<PkoLmo>,
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
impl KStruct for PkoLmo_Matrix44 {
    type Root = PkoLmo;
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
impl PkoLmo_Matrix44 {
}
impl PkoLmo_Matrix44 {
    pub fn m11(&self) -> Ref<'_, f32> {
        self.m11.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m12(&self) -> Ref<'_, f32> {
        self.m12.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m13(&self) -> Ref<'_, f32> {
        self.m13.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m14(&self) -> Ref<'_, f32> {
        self.m14.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m21(&self) -> Ref<'_, f32> {
        self.m21.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m22(&self) -> Ref<'_, f32> {
        self.m22.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m23(&self) -> Ref<'_, f32> {
        self.m23.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m24(&self) -> Ref<'_, f32> {
        self.m24.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m31(&self) -> Ref<'_, f32> {
        self.m31.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m32(&self) -> Ref<'_, f32> {
        self.m32.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m33(&self) -> Ref<'_, f32> {
        self.m33.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m34(&self) -> Ref<'_, f32> {
        self.m34.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m41(&self) -> Ref<'_, f32> {
        self.m41.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m42(&self) -> Ref<'_, f32> {
        self.m42.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m43(&self) -> Ref<'_, f32> {
        self.m43.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn m44(&self) -> Ref<'_, f32> {
        self.m44.borrow()
    }
}
impl PkoLmo_Matrix44 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MeshHeaderV0000 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MeshSection>,
    pub _self: SharedType<Self>,
    fvf: RefCell<u32>,
    pt_type: RefCell<u32>,
    vertex_num: RefCell<u32>,
    index_num: RefCell<u32>,
    subset_num: RefCell<u32>,
    bone_index_num: RefCell<u32>,
    rs_set: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_MeshHeaderV0000 {
    type Root = PkoLmo;
    type Parent = PkoLmo_MeshSection;

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
        *self_rc.fvf.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.pt_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.vertex_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.index_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.subset_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.bone_index_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.rs_set.borrow_mut() = _io.read_bytes(128 as usize)?.into();
        Ok(())
    }
}
impl PkoLmo_MeshHeaderV0000 {
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn fvf(&self) -> Ref<'_, u32> {
        self.fvf.borrow()
    }
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn pt_type(&self) -> Ref<'_, u32> {
        self.pt_type.borrow()
    }
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn vertex_num(&self) -> Ref<'_, u32> {
        self.vertex_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn index_num(&self) -> Ref<'_, u32> {
        self.index_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn subset_num(&self) -> Ref<'_, u32> {
        self.subset_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn bone_index_num(&self) -> Ref<'_, u32> {
        self.bone_index_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn rs_set(&self) -> Ref<'_, Vec<u8>> {
        self.rs_set.borrow()
    }
}
impl PkoLmo_MeshHeaderV0000 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MeshHeaderV0003 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MeshSection>,
    pub _self: SharedType<Self>,
    fvf: RefCell<u32>,
    pt_type: RefCell<u32>,
    vertex_num: RefCell<u32>,
    index_num: RefCell<u32>,
    subset_num: RefCell<u32>,
    bone_index_num: RefCell<u32>,
    rs_set: RefCell<Vec<OptRc<PkoLmo_RenderStateAtom>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_MeshHeaderV0003 {
    type Root = PkoLmo;
    type Parent = PkoLmo_MeshSection;

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
        *self_rc.fvf.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.pt_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.vertex_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.index_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.subset_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.bone_index_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.rs_set.borrow_mut() = Vec::new();
        let l_rs_set = 8;
        for _i in 0..l_rs_set {
            let t = Self::read_into::<_, PkoLmo_RenderStateAtom>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.rs_set.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_MeshHeaderV0003 {
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn fvf(&self) -> Ref<'_, u32> {
        self.fvf.borrow()
    }
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn pt_type(&self) -> Ref<'_, u32> {
        self.pt_type.borrow()
    }
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn vertex_num(&self) -> Ref<'_, u32> {
        self.vertex_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn index_num(&self) -> Ref<'_, u32> {
        self.index_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn subset_num(&self) -> Ref<'_, u32> {
        self.subset_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn bone_index_num(&self) -> Ref<'_, u32> {
        self.bone_index_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn rs_set(&self) -> Ref<'_, Vec<OptRc<PkoLmo_RenderStateAtom>>> {
        self.rs_set.borrow()
    }
}
impl PkoLmo_MeshHeaderV0003 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MeshHeaderV1004 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MeshSection>,
    pub _self: SharedType<Self>,
    fvf: RefCell<u32>,
    pt_type: RefCell<u32>,
    vertex_num: RefCell<u32>,
    index_num: RefCell<u32>,
    subset_num: RefCell<u32>,
    bone_index_num: RefCell<u32>,
    bone_infl_factor: RefCell<u32>,
    vertex_element_num: RefCell<u32>,
    rs_set: RefCell<Vec<OptRc<PkoLmo_RenderStateAtom>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_MeshHeaderV1004 {
    type Root = PkoLmo;
    type Parent = PkoLmo_MeshSection;

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
        *self_rc.fvf.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.pt_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.vertex_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.index_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.subset_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.bone_index_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.bone_infl_factor.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.vertex_element_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.rs_set.borrow_mut() = Vec::new();
        let l_rs_set = 8;
        for _i in 0..l_rs_set {
            let t = Self::read_into::<_, PkoLmo_RenderStateAtom>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.rs_set.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_MeshHeaderV1004 {
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn fvf(&self) -> Ref<'_, u32> {
        self.fvf.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn pt_type(&self) -> Ref<'_, u32> {
        self.pt_type.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn vertex_num(&self) -> Ref<'_, u32> {
        self.vertex_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn index_num(&self) -> Ref<'_, u32> {
        self.index_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn subset_num(&self) -> Ref<'_, u32> {
        self.subset_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn bone_index_num(&self) -> Ref<'_, u32> {
        self.bone_index_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn bone_infl_factor(&self) -> Ref<'_, u32> {
        self.bone_infl_factor.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn vertex_element_num(&self) -> Ref<'_, u32> {
        self.vertex_element_num.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn rs_set(&self) -> Ref<'_, Vec<OptRc<PkoLmo_RenderStateAtom>>> {
        self.rs_set.borrow()
    }
}
impl PkoLmo_MeshHeaderV1004 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MeshSection {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeometryChunk>,
    pub _self: SharedType<Self>,
    file_version: RefCell<u32>,
    legacy_prefix: RefCell<u32>,
    header_v0000: RefCell<OptRc<PkoLmo_MeshHeaderV0000>>,
    header_v0003: RefCell<OptRc<PkoLmo_MeshHeaderV0003>>,
    header_v1004: RefCell<OptRc<PkoLmo_MeshHeaderV1004>>,
    subset_seq_old: RefCell<Vec<OptRc<PkoLmo_SubsetInfo>>>,
    vertex_element_seq: RefCell<Vec<OptRc<PkoLmo_VertexElement>>>,
    vertex_seq: RefCell<Vec<OptRc<PkoLmo_Vector3>>>,
    normal_seq: RefCell<Vec<OptRc<PkoLmo_Vector3>>>,
    texcoord_seq: RefCell<Vec<OptRc<PkoLmo_TexcoordChannel>>>,
    vercol_seq: RefCell<Vec<u32>>,
    blend_seq: RefCell<Vec<OptRc<PkoLmo_BlendInfo>>>,
    bone_index_seq_u4: RefCell<Vec<u32>>,
    bone_index_seq_u1: RefCell<Vec<u8>>,
    legacy_pre_index_u4: RefCell<Vec<u32>>,
    index_seq: RefCell<Vec<u32>>,
    subset_seq_new: RefCell<Vec<OptRc<PkoLmo_SubsetInfo>>>,
    _io: RefCell<BytesReader>,
    f_bone_index_num: Cell<bool>,
    bone_index_num: RefCell<u32>,
    f_effective_version: Cell<bool>,
    effective_version: RefCell<i32>,
    f_fvf: Cell<bool>,
    fvf: RefCell<u32>,
    f_has_blend_data: Cell<bool>,
    has_blend_data: RefCell<bool>,
    f_has_diffuse: Cell<bool>,
    has_diffuse: RefCell<bool>,
    f_has_lastbeta_ubyte4: Cell<bool>,
    has_lastbeta_ubyte4: RefCell<bool>,
    f_has_legacy_pre_index_pair: Cell<bool>,
    has_legacy_pre_index_pair: RefCell<bool>,
    f_has_normals: Cell<bool>,
    has_normals: RefCell<bool>,
    f_header_kind: Cell<bool>,
    header_kind: RefCell<u8>,
    f_index_num: Cell<bool>,
    index_num: RefCell<u32>,
    f_subset_num: Cell<bool>,
    subset_num: RefCell<u32>,
    f_texcoord_set_count: Cell<bool>,
    texcoord_set_count: RefCell<i32>,
    f_texcoord_set_count_raw: Cell<bool>,
    texcoord_set_count_raw: RefCell<i32>,
    f_vertex_element_num: Cell<bool>,
    vertex_element_num: RefCell<u32>,
    f_vertex_num: Cell<bool>,
    vertex_num: RefCell<u32>,
}
impl KStruct for PkoLmo_MeshSection {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeometryChunk;

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
        if ((*self_rc.file_version() as u32) == (0 as u32)) {
            *self_rc.legacy_prefix.borrow_mut() = _io.read_u4le()?.into();
        }
        if ((*self_rc.header_kind()? as u8) == (0 as u8)) {
            let t = Self::read_into::<_, PkoLmo_MeshHeaderV0000>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.header_v0000.borrow_mut() = t;
        }
        if ((*self_rc.header_kind()? as u8) == (1 as u8)) {
            let t = Self::read_into::<_, PkoLmo_MeshHeaderV0003>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.header_v0003.borrow_mut() = t;
        }
        if ((*self_rc.header_kind()? as u8) == (2 as u8)) {
            let t = Self::read_into::<_, PkoLmo_MeshHeaderV1004>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.header_v1004.borrow_mut() = t;
        }
        if ((*self_rc.header_kind()? as u8) != (2 as u8)) {
            *self_rc.subset_seq_old.borrow_mut() = Vec::new();
            let l_subset_seq_old = *self_rc.subset_num()?;
            for _i in 0..l_subset_seq_old {
                let t = Self::read_into::<_, PkoLmo_SubsetInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.subset_seq_old.borrow_mut().push(t);
            }
        }
        if  ((((*self_rc.header_kind()? as u8) == (2 as u8))) && (((*self_rc.vertex_element_num()? as u32) > (0 as u32))))  {
            *self_rc.vertex_element_seq.borrow_mut() = Vec::new();
            let l_vertex_element_seq = *self_rc.vertex_element_num()?;
            for _i in 0..l_vertex_element_seq {
                let t = Self::read_into::<_, PkoLmo_VertexElement>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.vertex_element_seq.borrow_mut().push(t);
            }
        }
        if ((*self_rc.vertex_num()? as u32) > (0 as u32)) {
            *self_rc.vertex_seq.borrow_mut() = Vec::new();
            let l_vertex_seq = *self_rc.vertex_num()?;
            for _i in 0..l_vertex_seq {
                let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.vertex_seq.borrow_mut().push(t);
            }
        }
        if *self_rc.has_normals()? {
            *self_rc.normal_seq.borrow_mut() = Vec::new();
            let l_normal_seq = *self_rc.vertex_num()?;
            for _i in 0..l_normal_seq {
                let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
                self_rc.normal_seq.borrow_mut().push(t);
            }
        }
        *self_rc.texcoord_seq.borrow_mut() = Vec::new();
        let l_texcoord_seq = *self_rc.texcoord_set_count()?;
        for _i in 0..l_texcoord_seq {
            let f = |t : &mut PkoLmo_TexcoordChannel| Ok(t.set_params((*self_rc.vertex_num()?).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_TexcoordChannel>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.texcoord_seq.borrow_mut().push(t);
        }
        if *self_rc.has_diffuse()? {
            *self_rc.vercol_seq.borrow_mut() = Vec::new();
            let l_vercol_seq = *self_rc.vertex_num()?;
            for _i in 0..l_vercol_seq {
                self_rc.vercol_seq.borrow_mut().push(_io.read_u4le()?.into());
            }
        }
        if *self_rc.has_blend_data()? {
            *self_rc.blend_seq.borrow_mut() = Vec::new();
            let l_blend_seq = *self_rc.vertex_num()?;
            for _i in 0..l_blend_seq {
                let t = Self::read_into::<_, PkoLmo_BlendInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.blend_seq.borrow_mut().push(t);
            }
        }
        if  ((((*self_rc.header_kind()? as u8) == (2 as u8))) && (((*self_rc.bone_index_num()? as u32) > (0 as u32))))  {
            *self_rc.bone_index_seq_u4.borrow_mut() = Vec::new();
            let l_bone_index_seq_u4 = *self_rc.bone_index_num()?;
            for _i in 0..l_bone_index_seq_u4 {
                self_rc.bone_index_seq_u4.borrow_mut().push(_io.read_u4le()?.into());
            }
        }
        if  ((((*self_rc.header_kind()? as u8) != (2 as u8))) && (*self_rc.has_lastbeta_ubyte4()?) && (((*self_rc.bone_index_num()? as u32) > (0 as u32))))  {
            *self_rc.bone_index_seq_u1.borrow_mut() = Vec::new();
            let l_bone_index_seq_u1 = *self_rc.bone_index_num()?;
            for _i in 0..l_bone_index_seq_u1 {
                self_rc.bone_index_seq_u1.borrow_mut().push(_io.read_u1()?.into());
            }
        }
        if *self_rc.has_legacy_pre_index_pair()? {
            *self_rc.legacy_pre_index_u4.borrow_mut() = Vec::new();
            let l_legacy_pre_index_u4 = 2;
            for _i in 0..l_legacy_pre_index_u4 {
                self_rc.legacy_pre_index_u4.borrow_mut().push(_io.read_u4le()?.into());
            }
        }
        if ((*self_rc.index_num()? as u32) > (0 as u32)) {
            *self_rc.index_seq.borrow_mut() = Vec::new();
            let l_index_seq = *self_rc.index_num()?;
            for _i in 0..l_index_seq {
                self_rc.index_seq.borrow_mut().push(_io.read_u4le()?.into());
            }
        }
        if ((*self_rc.header_kind()? as u8) == (2 as u8)) {
            *self_rc.subset_seq_new.borrow_mut() = Vec::new();
            let l_subset_seq_new = *self_rc.subset_num()?;
            for _i in 0..l_subset_seq_new {
                let t = Self::read_into::<_, PkoLmo_SubsetInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.subset_seq_new.borrow_mut().push(t);
            }
        }
        Ok(())
    }
}
impl PkoLmo_MeshSection {
    pub fn file_version(&self) -> Ref<'_, u32> {
        self.file_version.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn set_params(&mut self, file_version: u32) {
        *self.file_version.borrow_mut() = file_version;
    }
}
impl PkoLmo_MeshSection {
    pub fn bone_index_num(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_bone_index_num.get() {
            return Ok(self.bone_index_num.borrow());
        }
        self.f_bone_index_num.set(true);
        *self.bone_index_num.borrow_mut() = (if ((*self.header_kind()? as u8) == (0 as u8)) { *self.header_v0000().bone_index_num() } else { if ((*self.header_kind()? as u8) == (1 as u8)) { *self.header_v0003().bone_index_num() } else { *self.header_v1004().bone_index_num() } }) as u32;
        Ok(self.bone_index_num.borrow())
    }
    pub fn effective_version(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_effective_version.get() {
            return Ok(self.effective_version.borrow());
        }
        self.f_effective_version.set(true);
        *self.effective_version.borrow_mut() = (if ((*self.file_version() as u32) == (0 as u32)) { *self.legacy_prefix() } else { *self.file_version() }) as i32;
        Ok(self.effective_version.borrow())
    }
    pub fn fvf(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_fvf.get() {
            return Ok(self.fvf.borrow());
        }
        self.f_fvf.set(true);
        *self.fvf.borrow_mut() = (if ((*self.header_kind()? as u8) == (0 as u8)) { *self.header_v0000().fvf() } else { if ((*self.header_kind()? as u8) == (1 as u8)) { *self.header_v0003().fvf() } else { *self.header_v1004().fvf() } }) as u32;
        Ok(self.fvf.borrow())
    }
    pub fn has_blend_data(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_has_blend_data.get() {
            return Ok(self.has_blend_data.borrow());
        }
        self.f_has_blend_data.set(true);
        *self.has_blend_data.borrow_mut() = (if ((*self.header_kind()? as u8) == (2 as u8)) { ((*self.bone_index_num()? as u32) > (0 as u32)) } else { *self.has_lastbeta_ubyte4()? }) as bool;
        Ok(self.has_blend_data.borrow())
    }
    pub fn has_diffuse(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_has_diffuse.get() {
            return Ok(self.has_diffuse.borrow());
        }
        self.f_has_diffuse.set(true);
        *self.has_diffuse.borrow_mut() = (((((*self.fvf()? as u32) & (64 as u32)) as i32) != (0 as i32))) as bool;
        Ok(self.has_diffuse.borrow())
    }
    pub fn has_lastbeta_ubyte4(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_has_lastbeta_ubyte4.get() {
            return Ok(self.has_lastbeta_ubyte4.borrow());
        }
        self.f_has_lastbeta_ubyte4.set(true);
        *self.has_lastbeta_ubyte4.borrow_mut() = (((((*self.fvf()? as i32) & (4096 as i32)) as i32) != (0 as i32))) as bool;
        Ok(self.has_lastbeta_ubyte4.borrow())
    }
    pub fn has_legacy_pre_index_pair(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_has_legacy_pre_index_pair.get() {
            return Ok(self.has_legacy_pre_index_pair.borrow());
        }
        self.f_has_legacy_pre_index_pair.set(true);
        *self.has_legacy_pre_index_pair.borrow_mut() = ( ((((*self.header_kind()? as u8) == (0 as u8))) && (((*_io.size() as i32) - (_io.pos() as i32)) == ((((*self.index_num()? as u32) * (4 as u32)) as i32) + (8 as i32)))) ) as bool;
        Ok(self.has_legacy_pre_index_pair.borrow())
    }
    pub fn has_normals(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_has_normals.get() {
            return Ok(self.has_normals.borrow());
        }
        self.f_has_normals.set(true);
        *self.has_normals.borrow_mut() = (((((*self.fvf()? as u32) & (16 as u32)) as i32) != (0 as i32))) as bool;
        Ok(self.has_normals.borrow())
    }
    pub fn header_kind(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_header_kind.get() {
            return Ok(self.header_kind.borrow());
        }
        self.f_header_kind.set(true);
        *self.header_kind.borrow_mut() = (if ((*self.effective_version()? as i32) == (0 as i32)) { 0 } else { if ((*self.effective_version()? as i32) == (1 as i32)) { 1 } else { if *self.effective_version()? >= 4096 { if *self.effective_version()? >= 4100 { 2 } else { 1 } } else { 255 } } }) as u8;
        Ok(self.header_kind.borrow())
    }
    pub fn index_num(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_index_num.get() {
            return Ok(self.index_num.borrow());
        }
        self.f_index_num.set(true);
        *self.index_num.borrow_mut() = (if ((*self.header_kind()? as u8) == (0 as u8)) { *self.header_v0000().index_num() } else { if ((*self.header_kind()? as u8) == (1 as u8)) { *self.header_v0003().index_num() } else { *self.header_v1004().index_num() } }) as u32;
        Ok(self.index_num.borrow())
    }
    pub fn subset_num(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_subset_num.get() {
            return Ok(self.subset_num.borrow());
        }
        self.f_subset_num.set(true);
        *self.subset_num.borrow_mut() = (if ((*self.header_kind()? as u8) == (0 as u8)) { *self.header_v0000().subset_num() } else { if ((*self.header_kind()? as u8) == (1 as u8)) { *self.header_v0003().subset_num() } else { *self.header_v1004().subset_num() } }) as u32;
        Ok(self.subset_num.borrow())
    }
    pub fn texcoord_set_count(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_texcoord_set_count.get() {
            return Ok(self.texcoord_set_count.borrow());
        }
        self.f_texcoord_set_count.set(true);
        *self.texcoord_set_count.borrow_mut() = (if ((*self.texcoord_set_count_raw()? as i32) > (4 as i32)) { 4 } else { *self.texcoord_set_count_raw()? }) as i32;
        Ok(self.texcoord_set_count.borrow())
    }
    pub fn texcoord_set_count_raw(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_texcoord_set_count_raw.get() {
            return Ok(self.texcoord_set_count_raw.borrow());
        }
        self.f_texcoord_set_count_raw.set(true);
        *self.texcoord_set_count_raw.borrow_mut() = ((((((*self.fvf()? as i32) & (3840 as i32)) as u64) >> 8) as i32)) as i32;
        Ok(self.texcoord_set_count_raw.borrow())
    }
    pub fn vertex_element_num(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_vertex_element_num.get() {
            return Ok(self.vertex_element_num.borrow());
        }
        self.f_vertex_element_num.set(true);
        *self.vertex_element_num.borrow_mut() = (if ((*self.header_kind()? as u8) == (2 as u8)) { *self.header_v1004().vertex_element_num() } else { 0 }) as u32;
        Ok(self.vertex_element_num.borrow())
    }
    pub fn vertex_num(
        &self
    ) -> KResult<Ref<'_, u32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_vertex_num.get() {
            return Ok(self.vertex_num.borrow());
        }
        self.f_vertex_num.set(true);
        *self.vertex_num.borrow_mut() = (if ((*self.header_kind()? as u8) == (0 as u8)) { *self.header_v0000().vertex_num() } else { if ((*self.header_kind()? as u8) == (1 as u8)) { *self.header_v0003().vertex_num() } else { *self.header_v1004().vertex_num() } }) as u32;
        Ok(self.vertex_num.borrow())
    }
}
impl PkoLmo_MeshSection {
    pub fn legacy_prefix(&self) -> Ref<'_, u32> {
        self.legacy_prefix.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn header_v0000(&self) -> Ref<'_, OptRc<PkoLmo_MeshHeaderV0000>> {
        self.header_v0000.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn header_v0003(&self) -> Ref<'_, OptRc<PkoLmo_MeshHeaderV0003>> {
        self.header_v0003.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn header_v1004(&self) -> Ref<'_, OptRc<PkoLmo_MeshHeaderV1004>> {
        self.header_v1004.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn subset_seq_old(&self) -> Ref<'_, Vec<OptRc<PkoLmo_SubsetInfo>>> {
        self.subset_seq_old.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn vertex_element_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_VertexElement>>> {
        self.vertex_element_seq.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn vertex_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Vector3>>> {
        self.vertex_seq.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn normal_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Vector3>>> {
        self.normal_seq.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn texcoord_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_TexcoordChannel>>> {
        self.texcoord_seq.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn vercol_seq(&self) -> Ref<'_, Vec<u32>> {
        self.vercol_seq.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn blend_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_BlendInfo>>> {
        self.blend_seq.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn bone_index_seq_u4(&self) -> Ref<'_, Vec<u32>> {
        self.bone_index_seq_u4.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn bone_index_seq_u1(&self) -> Ref<'_, Vec<u8>> {
        self.bone_index_seq_u1.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn legacy_pre_index_u4(&self) -> Ref<'_, Vec<u32>> {
        self.legacy_pre_index_u4.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn index_seq(&self) -> Ref<'_, Vec<u32>> {
        self.index_seq.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn subset_seq_new(&self) -> Ref<'_, Vec<OptRc<PkoLmo_SubsetInfo>>> {
        self.subset_seq_new.borrow()
    }
}
impl PkoLmo_MeshSection {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_ModelNodeHeadInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_ModelNodeInfo>,
    pub _self: SharedType<Self>,
    handle: RefCell<u32>,
    type: RefCell<u32>,
    id: RefCell<u32>,
    descriptor: RefCell<Vec<u8>>,
    parent_handle: RefCell<u32>,
    link_parent_id: RefCell<u32>,
    link_id: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_ModelNodeHeadInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_ModelNodeInfo;

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
        *self_rc.handle.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.type.borrow_mut() = _io.read_u4le()?.into();
        if !( ((((*self_rc.type() as u32) == (1 as u32))) || (((*self_rc.type() as u32) == (2 as u32))) || (((*self_rc.type() as u32) == (3 as u32))) || (((*self_rc.type() as u32) == (4 as u32)))) ) {
            return Err(KError::ValidationFailed(ValidationFailedError { kind: ValidationKind::NotAnyOf, src_path: "/types/model_node_head_info/seq/1".to_string() }));
        }
        *self_rc.id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.descriptor.borrow_mut() = _io.read_bytes(64 as usize)?.into();
        *self_rc.parent_handle.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.link_parent_id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.link_id.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_ModelNodeHeadInfo {
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn handle(&self) -> Ref<'_, u32> {
        self.handle.borrow()
    }
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn type(&self) -> Ref<'_, u32> {
        self.type.borrow()
    }
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn id(&self) -> Ref<'_, u32> {
        self.id.borrow()
    }
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn descriptor(&self) -> Ref<'_, Vec<u8>> {
        self.descriptor.borrow()
    }
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn parent_handle(&self) -> Ref<'_, u32> {
        self.parent_handle.borrow()
    }
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn link_parent_id(&self) -> Ref<'_, u32> {
        self.link_parent_id.borrow()
    }
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn link_id(&self) -> Ref<'_, u32> {
        self.link_id.borrow()
    }
}
impl PkoLmo_ModelNodeHeadInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_ModelNodeInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo>,
    pub _self: SharedType<Self>,
    file_version: RefCell<u32>,
    head: RefCell<OptRc<PkoLmo_ModelNodeHeadInfo>>,
    node_primitive: RefCell<OptRc<PkoLmo_GeometryChunk>>,
    node_bonectrl: RefCell<OptRc<PkoLmo_AnimDataBone>>,
    node_dummy: RefCell<OptRc<PkoLmo_HelperDummyObjInfo>>,
    node_helper: RefCell<OptRc<PkoLmo_HelperSection>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_ModelNodeInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo;

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
        let t = Self::read_into::<_, PkoLmo_ModelNodeHeadInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.head.borrow_mut() = t;
        if ((*self_rc.head().type() as u32) == (1 as u32)) {
            let f = |t : &mut PkoLmo_GeometryChunk| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?, (0).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_GeometryChunk>(&*_io, Some(self_rc._root.clone()), None, &f)?.into();
            *self_rc.node_primitive.borrow_mut() = t;
        }
        if ((*self_rc.head().type() as u32) == (2 as u32)) {
            let f = |t : &mut PkoLmo_AnimDataBone| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_AnimDataBone>(&*_io, Some(self_rc._root.clone()), None, &f)?.into();
            *self_rc.node_bonectrl.borrow_mut() = t;
        }
        if ((*self_rc.head().type() as u32) == (3 as u32)) {
            let t = Self::read_into::<_, PkoLmo_HelperDummyObjInfo>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.node_dummy.borrow_mut() = t;
        }
        if ((*self_rc.head().type() as u32) == (4 as u32)) {
            let f = |t : &mut PkoLmo_HelperSection| Ok(t.set_params((*self_rc.file_version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoLmo_HelperSection>(&*_io, Some(self_rc._root.clone()), None, &f)?.into();
            *self_rc.node_helper.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_ModelNodeInfo {
    pub fn file_version(&self) -> Ref<'_, u32> {
        self.file_version.borrow()
    }
}
impl PkoLmo_ModelNodeInfo {
    pub fn set_params(&mut self, file_version: u32) {
        *self.file_version.borrow_mut() = file_version;
    }
}
impl PkoLmo_ModelNodeInfo {
}
impl PkoLmo_ModelNodeInfo {
    pub fn head(&self) -> Ref<'_, OptRc<PkoLmo_ModelNodeHeadInfo>> {
        self.head.borrow()
    }
}
impl PkoLmo_ModelNodeInfo {
    pub fn node_primitive(&self) -> Ref<'_, OptRc<PkoLmo_GeometryChunk>> {
        self.node_primitive.borrow()
    }
}
impl PkoLmo_ModelNodeInfo {
    pub fn node_bonectrl(&self) -> Ref<'_, OptRc<PkoLmo_AnimDataBone>> {
        self.node_bonectrl.borrow()
    }
}
impl PkoLmo_ModelNodeInfo {
    pub fn node_dummy(&self) -> Ref<'_, OptRc<PkoLmo_HelperDummyObjInfo>> {
        self.node_dummy.borrow()
    }
}
impl PkoLmo_ModelNodeInfo {
    pub fn node_helper(&self) -> Ref<'_, OptRc<PkoLmo_HelperSection>> {
        self.node_helper.borrow()
    }
}
impl PkoLmo_ModelNodeInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MtlEntry {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MaterialSection>,
    pub _self: SharedType<Self>,
    format_hint: RefCell<u32>,
    as_0000: RefCell<OptRc<PkoLmo_MtlTexInfo0000>>,
    as_0001: RefCell<OptRc<PkoLmo_MtlTexInfo0001>>,
    as_current: RefCell<OptRc<PkoLmo_MtlTexInfoCurrent>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_MtlEntry {
    type Root = PkoLmo;
    type Parent = PkoLmo_MaterialSection;

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
        if ((*self_rc.format_hint() as u32) == (0 as u32)) {
            let t = Self::read_into::<_, PkoLmo_MtlTexInfo0000>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.as_0000.borrow_mut() = t;
        }
        if ((*self_rc.format_hint() as u32) == (1 as u32)) {
            let t = Self::read_into::<_, PkoLmo_MtlTexInfo0001>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.as_0001.borrow_mut() = t;
        }
        if  ((((*self_rc.format_hint() as u32) != (0 as u32))) && (((*self_rc.format_hint() as u32) != (1 as u32))))  {
            let t = Self::read_into::<_, PkoLmo_MtlTexInfoCurrent>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.as_current.borrow_mut() = t;
        }
        Ok(())
    }
}
impl PkoLmo_MtlEntry {
    pub fn format_hint(&self) -> Ref<'_, u32> {
        self.format_hint.borrow()
    }
}
impl PkoLmo_MtlEntry {
    pub fn set_params(&mut self, format_hint: u32) {
        *self.format_hint.borrow_mut() = format_hint;
    }
}
impl PkoLmo_MtlEntry {
}
impl PkoLmo_MtlEntry {
    pub fn as_0000(&self) -> Ref<'_, OptRc<PkoLmo_MtlTexInfo0000>> {
        self.as_0000.borrow()
    }
}
impl PkoLmo_MtlEntry {
    pub fn as_0001(&self) -> Ref<'_, OptRc<PkoLmo_MtlTexInfo0001>> {
        self.as_0001.borrow()
    }
}
impl PkoLmo_MtlEntry {
    pub fn as_current(&self) -> Ref<'_, OptRc<PkoLmo_MtlTexInfoCurrent>> {
        self.as_current.borrow()
    }
}
impl PkoLmo_MtlEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MtlTexInfo0000 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MtlEntry>,
    pub _self: SharedType<Self>,
    mtl: RefCell<OptRc<PkoLmo_Material>>,
    rs_set: RefCell<OptRc<PkoLmo_RenderStateSet28>>,
    tex_seq: RefCell<Vec<OptRc<PkoLmo_TexInfo0000>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_MtlTexInfo0000 {
    type Root = PkoLmo;
    type Parent = PkoLmo_MtlEntry;

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
        let t = Self::read_into::<_, PkoLmo_Material>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mtl.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_RenderStateSet28>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.rs_set.borrow_mut() = t;
        *self_rc.tex_seq.borrow_mut() = Vec::new();
        let l_tex_seq = 4;
        for _i in 0..l_tex_seq {
            let t = Self::read_into::<_, PkoLmo_TexInfo0000>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.tex_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_MtlTexInfo0000 {
}
impl PkoLmo_MtlTexInfo0000 {
    pub fn mtl(&self) -> Ref<'_, OptRc<PkoLmo_Material>> {
        self.mtl.borrow()
    }
}
impl PkoLmo_MtlTexInfo0000 {
    pub fn rs_set(&self) -> Ref<'_, OptRc<PkoLmo_RenderStateSet28>> {
        self.rs_set.borrow()
    }
}
impl PkoLmo_MtlTexInfo0000 {
    pub fn tex_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_TexInfo0000>>> {
        self.tex_seq.borrow()
    }
}
impl PkoLmo_MtlTexInfo0000 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MtlTexInfo0001 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MtlEntry>,
    pub _self: SharedType<Self>,
    opacity: RefCell<f32>,
    transp_type: RefCell<u32>,
    mtl: RefCell<OptRc<PkoLmo_Material>>,
    rs_set: RefCell<OptRc<PkoLmo_RenderStateSet28>>,
    tex_seq: RefCell<Vec<OptRc<PkoLmo_TexInfo0001>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_MtlTexInfo0001 {
    type Root = PkoLmo;
    type Parent = PkoLmo_MtlEntry;

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
        *self_rc.opacity.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.transp_type.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_Material>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mtl.borrow_mut() = t;
        let t = Self::read_into::<_, PkoLmo_RenderStateSet28>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.rs_set.borrow_mut() = t;
        *self_rc.tex_seq.borrow_mut() = Vec::new();
        let l_tex_seq = 4;
        for _i in 0..l_tex_seq {
            let t = Self::read_into::<_, PkoLmo_TexInfo0001>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.tex_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_MtlTexInfo0001 {
}
impl PkoLmo_MtlTexInfo0001 {
    pub fn opacity(&self) -> Ref<'_, f32> {
        self.opacity.borrow()
    }
}
impl PkoLmo_MtlTexInfo0001 {
    pub fn transp_type(&self) -> Ref<'_, u32> {
        self.transp_type.borrow()
    }
}
impl PkoLmo_MtlTexInfo0001 {
    pub fn mtl(&self) -> Ref<'_, OptRc<PkoLmo_Material>> {
        self.mtl.borrow()
    }
}
impl PkoLmo_MtlTexInfo0001 {
    pub fn rs_set(&self) -> Ref<'_, OptRc<PkoLmo_RenderStateSet28>> {
        self.rs_set.borrow()
    }
}
impl PkoLmo_MtlTexInfo0001 {
    pub fn tex_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_TexInfo0001>>> {
        self.tex_seq.borrow()
    }
}
impl PkoLmo_MtlTexInfo0001 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_MtlTexInfoCurrent {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MtlEntry>,
    pub _self: SharedType<Self>,
    opacity: RefCell<f32>,
    transp_type: RefCell<u32>,
    mtl: RefCell<OptRc<PkoLmo_Material>>,
    rs_set: RefCell<Vec<OptRc<PkoLmo_RenderStateAtom>>>,
    tex_seq: RefCell<Vec<OptRc<PkoLmo_TexInfoCurrent>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_MtlTexInfoCurrent {
    type Root = PkoLmo;
    type Parent = PkoLmo_MtlEntry;

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
        *self_rc.opacity.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.transp_type.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_Material>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.mtl.borrow_mut() = t;
        *self_rc.rs_set.borrow_mut() = Vec::new();
        let l_rs_set = 8;
        for _i in 0..l_rs_set {
            let t = Self::read_into::<_, PkoLmo_RenderStateAtom>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.rs_set.borrow_mut().push(t);
        }
        *self_rc.tex_seq.borrow_mut() = Vec::new();
        let l_tex_seq = 4;
        for _i in 0..l_tex_seq {
            let t = Self::read_into::<_, PkoLmo_TexInfoCurrent>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.tex_seq.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_MtlTexInfoCurrent {
}
impl PkoLmo_MtlTexInfoCurrent {
    pub fn opacity(&self) -> Ref<'_, f32> {
        self.opacity.borrow()
    }
}
impl PkoLmo_MtlTexInfoCurrent {
    pub fn transp_type(&self) -> Ref<'_, u32> {
        self.transp_type.borrow()
    }
}
impl PkoLmo_MtlTexInfoCurrent {
    pub fn mtl(&self) -> Ref<'_, OptRc<PkoLmo_Material>> {
        self.mtl.borrow()
    }
}
impl PkoLmo_MtlTexInfoCurrent {
    pub fn rs_set(&self) -> Ref<'_, Vec<OptRc<PkoLmo_RenderStateAtom>>> {
        self.rs_set.borrow()
    }
}
impl PkoLmo_MtlTexInfoCurrent {
    pub fn tex_seq(&self) -> Ref<'_, Vec<OptRc<PkoLmo_TexInfoCurrent>>> {
        self.tex_seq.borrow()
    }
}
impl PkoLmo_MtlTexInfoCurrent {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_ObjectEntry {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo>,
    pub _self: SharedType<Self>,
    type: RefCell<u32>,
    addr: RefCell<u32>,
    size: RefCell<u32>,
    _io: RefCell<BytesReader>,
    body_geometry_raw: RefCell<Vec<u8>>,
    body_helper_raw: RefCell<Vec<u8>>,
    f_body_geometry: Cell<bool>,
    body_geometry: RefCell<OptRc<PkoLmo_GeometryChunk>>,
    f_body_helper: Cell<bool>,
    body_helper: RefCell<OptRc<PkoLmo_HelperSection>>,
}
impl KStruct for PkoLmo_ObjectEntry {
    type Root = PkoLmo;
    type Parent = PkoLmo;

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
        *self_rc.type.borrow_mut() = _io.read_u4le()?.into();
        if !( ((((*self_rc.type() as u32) == (1 as u32))) || (((*self_rc.type() as u32) == (2 as u32)))) ) {
            return Err(KError::ValidationFailed(ValidationFailedError { kind: ValidationKind::NotAnyOf, src_path: "/types/object_entry/seq/0".to_string() }));
        }
        *self_rc.addr.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.size.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_ObjectEntry {
    pub fn body_geometry(
        &self
    ) -> KResult<Ref<'_, OptRc<PkoLmo_GeometryChunk>>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_body_geometry.get() {
            return Ok(self.body_geometry.borrow());
        }
        if ((*self.type() as u32) == (1 as u32)) {
            let _pos = _io.pos();
            _io.seek(*self.addr() as usize)?;
            *self.body_geometry_raw.borrow_mut() = _io.read_bytes(*self.size() as usize)?.into();
            let body_geometry_raw = self.body_geometry_raw.borrow();
            let _t_body_geometry_raw_io = BytesReader::from(body_geometry_raw.clone());
            let f = |t : &mut PkoLmo_GeometryChunk| Ok(t.set_params((*_r.version()).try_into().map_err(|_| KError::CastError)?, (1).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_GeometryChunk>(&_t_body_geometry_raw_io, Some(self._root.clone()), None, &f)?.into();
            *self.body_geometry.borrow_mut() = t;
            _io.seek(_pos)?;
        }
        Ok(self.body_geometry.borrow())
    }
    pub fn body_helper(
        &self
    ) -> KResult<Ref<'_, OptRc<PkoLmo_HelperSection>>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_body_helper.get() {
            return Ok(self.body_helper.borrow());
        }
        if ((*self.type() as u32) == (2 as u32)) {
            let _pos = _io.pos();
            _io.seek(*self.addr() as usize)?;
            *self.body_helper_raw.borrow_mut() = _io.read_bytes(*self.size() as usize)?.into();
            let body_helper_raw = self.body_helper_raw.borrow();
            let _t_body_helper_raw_io = BytesReader::from(body_helper_raw.clone());
            let f = |t : &mut PkoLmo_HelperSection| Ok(t.set_params((*_r.version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<BytesReader, PkoLmo_HelperSection>(&_t_body_helper_raw_io, Some(self._root.clone()), None, &f)?.into();
            *self.body_helper.borrow_mut() = t;
            _io.seek(_pos)?;
        }
        Ok(self.body_helper.borrow())
    }
}
impl PkoLmo_ObjectEntry {
    pub fn type(&self) -> Ref<'_, u32> {
        self.type.borrow()
    }
}
impl PkoLmo_ObjectEntry {
    pub fn addr(&self) -> Ref<'_, u32> {
        self.addr.borrow()
    }
}
impl PkoLmo_ObjectEntry {
    pub fn size(&self) -> Ref<'_, u32> {
        self.size.borrow()
    }
}
impl PkoLmo_ObjectEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoLmo_ObjectEntry {
    pub fn body_geometry_raw(&self) -> Ref<'_, Vec<u8>> {
        self.body_geometry_raw.borrow()
    }
}
impl PkoLmo_ObjectEntry {
    pub fn body_helper_raw(&self) -> Ref<'_, Vec<u8>> {
        self.body_helper_raw.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Plane {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_HelperMeshFaceInfo>,
    pub _self: SharedType<Self>,
    a: RefCell<f32>,
    b: RefCell<f32>,
    c: RefCell<f32>,
    d: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_Plane {
    type Root = PkoLmo;
    type Parent = PkoLmo_HelperMeshFaceInfo;

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
        *self_rc.a.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.b.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.c.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.d.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLmo_Plane {
}
impl PkoLmo_Plane {
    pub fn a(&self) -> Ref<'_, f32> {
        self.a.borrow()
    }
}
impl PkoLmo_Plane {
    pub fn b(&self) -> Ref<'_, f32> {
        self.b.borrow()
    }
}
impl PkoLmo_Plane {
    pub fn c(&self) -> Ref<'_, f32> {
        self.c.borrow()
    }
}
impl PkoLmo_Plane {
    pub fn d(&self) -> Ref<'_, f32> {
        self.d.borrow()
    }
}
impl PkoLmo_Plane {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Quaternion {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_BoneKeyInfo>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    z: RefCell<f32>,
    w: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_Quaternion {
    type Root = PkoLmo;
    type Parent = PkoLmo_BoneKeyInfo;

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
impl PkoLmo_Quaternion {
}
impl PkoLmo_Quaternion {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoLmo_Quaternion {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoLmo_Quaternion {
    pub fn z(&self) -> Ref<'_, f32> {
        self.z.borrow()
    }
}
impl PkoLmo_Quaternion {
    pub fn w(&self) -> Ref<'_, f32> {
        self.w.borrow()
    }
}
impl PkoLmo_Quaternion {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_RenderCtrlCreateInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeomObjInfoHeaderModern>,
    pub _self: SharedType<Self>,
    ctrl_id: RefCell<u32>,
    decl_id: RefCell<u32>,
    vs_id: RefCell<u32>,
    ps_id: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_RenderCtrlCreateInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeomObjInfoHeaderModern;

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
        *self_rc.ctrl_id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.decl_id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.vs_id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.ps_id.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_RenderCtrlCreateInfo {
}
impl PkoLmo_RenderCtrlCreateInfo {
    pub fn ctrl_id(&self) -> Ref<'_, u32> {
        self.ctrl_id.borrow()
    }
}
impl PkoLmo_RenderCtrlCreateInfo {
    pub fn decl_id(&self) -> Ref<'_, u32> {
        self.decl_id.borrow()
    }
}
impl PkoLmo_RenderCtrlCreateInfo {
    pub fn vs_id(&self) -> Ref<'_, u32> {
        self.vs_id.borrow()
    }
}
impl PkoLmo_RenderCtrlCreateInfo {
    pub fn ps_id(&self) -> Ref<'_, u32> {
        self.ps_id.borrow()
    }
}
impl PkoLmo_RenderCtrlCreateInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_RenderStateAtom {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    state: RefCell<u32>,
    value0: RefCell<u32>,
    value1: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_RenderStateAtom {
    type Root = PkoLmo;
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
        *self_rc.state.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.value0.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.value1.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_RenderStateAtom {
}
impl PkoLmo_RenderStateAtom {
    pub fn state(&self) -> Ref<'_, u32> {
        self.state.borrow()
    }
}
impl PkoLmo_RenderStateAtom {
    pub fn value0(&self) -> Ref<'_, u32> {
        self.value0.borrow()
    }
}
impl PkoLmo_RenderStateAtom {
    pub fn value1(&self) -> Ref<'_, u32> {
        self.value1.borrow()
    }
}
impl PkoLmo_RenderStateAtom {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_RenderStateSet28 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    values: RefCell<Vec<OptRc<PkoLmo_RenderStateValue>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_RenderStateSet28 {
    type Root = PkoLmo;
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
        *self_rc.values.borrow_mut() = Vec::new();
        let l_values = 16;
        for _i in 0..l_values {
            let t = Self::read_into::<_, PkoLmo_RenderStateValue>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.values.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_RenderStateSet28 {
}
impl PkoLmo_RenderStateSet28 {
    pub fn values(&self) -> Ref<'_, Vec<OptRc<PkoLmo_RenderStateValue>>> {
        self.values.borrow()
    }
}
impl PkoLmo_RenderStateSet28 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_RenderStateValue {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_RenderStateSet28>,
    pub _self: SharedType<Self>,
    state: RefCell<u32>,
    value: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_RenderStateValue {
    type Root = PkoLmo;
    type Parent = PkoLmo_RenderStateSet28;

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
        *self_rc.state.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.value.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_RenderStateValue {
}
impl PkoLmo_RenderStateValue {
    pub fn state(&self) -> Ref<'_, u32> {
        self.state.borrow()
    }
}
impl PkoLmo_RenderStateValue {
    pub fn value(&self) -> Ref<'_, u32> {
        self.value.borrow()
    }
}
impl PkoLmo_RenderStateValue {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Sphere {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_BoundingSphereInfo>,
    pub _self: SharedType<Self>,
    center: RefCell<OptRc<PkoLmo_Vector3>>,
    radius: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_Sphere {
    type Root = PkoLmo;
    type Parent = PkoLmo_BoundingSphereInfo;

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
        let t = Self::read_into::<_, PkoLmo_Vector3>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.center.borrow_mut() = t;
        *self_rc.radius.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLmo_Sphere {
}
impl PkoLmo_Sphere {
    pub fn center(&self) -> Ref<'_, OptRc<PkoLmo_Vector3>> {
        self.center.borrow()
    }
}
impl PkoLmo_Sphere {
    pub fn radius(&self) -> Ref<'_, f32> {
        self.radius.borrow()
    }
}
impl PkoLmo_Sphere {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_StateCtrl {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_GeomObjInfoHeaderModern>,
    pub _self: SharedType<Self>,
    state_seq: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_StateCtrl {
    type Root = PkoLmo;
    type Parent = PkoLmo_GeomObjInfoHeaderModern;

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
        *self_rc.state_seq.borrow_mut() = _io.read_bytes(8 as usize)?.into();
        Ok(())
    }
}
impl PkoLmo_StateCtrl {
}
impl PkoLmo_StateCtrl {
    pub fn state_seq(&self) -> Ref<'_, Vec<u8>> {
        self.state_seq.borrow()
    }
}
impl PkoLmo_StateCtrl {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_SubsetInfo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MeshSection>,
    pub _self: SharedType<Self>,
    primitive_num: RefCell<u32>,
    start_index: RefCell<u32>,
    vertex_num: RefCell<u32>,
    min_index: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_SubsetInfo {
    type Root = PkoLmo;
    type Parent = PkoLmo_MeshSection;

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
        *self_rc.primitive_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.start_index.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.vertex_num.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.min_index.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoLmo_SubsetInfo {
}
impl PkoLmo_SubsetInfo {
    pub fn primitive_num(&self) -> Ref<'_, u32> {
        self.primitive_num.borrow()
    }
}
impl PkoLmo_SubsetInfo {
    pub fn start_index(&self) -> Ref<'_, u32> {
        self.start_index.borrow()
    }
}
impl PkoLmo_SubsetInfo {
    pub fn vertex_num(&self) -> Ref<'_, u32> {
        self.vertex_num.borrow()
    }
}
impl PkoLmo_SubsetInfo {
    pub fn min_index(&self) -> Ref<'_, u32> {
        self.min_index.borrow()
    }
}
impl PkoLmo_SubsetInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_TexInfo0000 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MtlTexInfo0000>,
    pub _self: SharedType<Self>,
    stage: RefCell<u32>,
    colorkey_type: RefCell<u32>,
    colorkey: RefCell<OptRc<PkoLmo_ColorValue4b>>,
    format: RefCell<u32>,
    file_name: RefCell<Vec<u8>>,
    tss_set: RefCell<OptRc<PkoLmo_RenderStateSet28>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_TexInfo0000 {
    type Root = PkoLmo;
    type Parent = PkoLmo_MtlTexInfo0000;

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
        *self_rc.stage.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.colorkey_type.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_ColorValue4b>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.colorkey.borrow_mut() = t;
        *self_rc.format.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.file_name.borrow_mut() = _io.read_bytes(64 as usize)?.into();
        let t = Self::read_into::<_, PkoLmo_RenderStateSet28>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.tss_set.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_TexInfo0000 {
}
impl PkoLmo_TexInfo0000 {
    pub fn stage(&self) -> Ref<'_, u32> {
        self.stage.borrow()
    }
}
impl PkoLmo_TexInfo0000 {
    pub fn colorkey_type(&self) -> Ref<'_, u32> {
        self.colorkey_type.borrow()
    }
}
impl PkoLmo_TexInfo0000 {
    pub fn colorkey(&self) -> Ref<'_, OptRc<PkoLmo_ColorValue4b>> {
        self.colorkey.borrow()
    }
}
impl PkoLmo_TexInfo0000 {
    pub fn format(&self) -> Ref<'_, u32> {
        self.format.borrow()
    }
}
impl PkoLmo_TexInfo0000 {
    pub fn file_name(&self) -> Ref<'_, Vec<u8>> {
        self.file_name.borrow()
    }
}
impl PkoLmo_TexInfo0000 {
    pub fn tss_set(&self) -> Ref<'_, OptRc<PkoLmo_RenderStateSet28>> {
        self.tss_set.borrow()
    }
}
impl PkoLmo_TexInfo0000 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_TexInfo0001 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MtlTexInfo0001>,
    pub _self: SharedType<Self>,
    stage: RefCell<u32>,
    level: RefCell<u32>,
    usage: RefCell<u32>,
    format: RefCell<u32>,
    pool: RefCell<u32>,
    byte_alignment_flag: RefCell<u32>,
    tex_type: RefCell<u32>,
    width: RefCell<u32>,
    height: RefCell<u32>,
    colorkey_type: RefCell<u32>,
    colorkey: RefCell<OptRc<PkoLmo_ColorValue4b>>,
    file_name: RefCell<Vec<u8>>,
    data_ptr: RefCell<u32>,
    tss_set: RefCell<OptRc<PkoLmo_RenderStateSet28>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_TexInfo0001 {
    type Root = PkoLmo;
    type Parent = PkoLmo_MtlTexInfo0001;

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
        *self_rc.stage.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.level.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.usage.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.format.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.pool.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.byte_alignment_flag.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.tex_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.width.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.height.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.colorkey_type.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_ColorValue4b>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.colorkey.borrow_mut() = t;
        *self_rc.file_name.borrow_mut() = _io.read_bytes(64 as usize)?.into();
        *self_rc.data_ptr.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_RenderStateSet28>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.tss_set.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLmo_TexInfo0001 {
}
impl PkoLmo_TexInfo0001 {
    pub fn stage(&self) -> Ref<'_, u32> {
        self.stage.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn level(&self) -> Ref<'_, u32> {
        self.level.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn usage(&self) -> Ref<'_, u32> {
        self.usage.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn format(&self) -> Ref<'_, u32> {
        self.format.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn pool(&self) -> Ref<'_, u32> {
        self.pool.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn byte_alignment_flag(&self) -> Ref<'_, u32> {
        self.byte_alignment_flag.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn tex_type(&self) -> Ref<'_, u32> {
        self.tex_type.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn width(&self) -> Ref<'_, u32> {
        self.width.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn height(&self) -> Ref<'_, u32> {
        self.height.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn colorkey_type(&self) -> Ref<'_, u32> {
        self.colorkey_type.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn colorkey(&self) -> Ref<'_, OptRc<PkoLmo_ColorValue4b>> {
        self.colorkey.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn file_name(&self) -> Ref<'_, Vec<u8>> {
        self.file_name.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn data_ptr(&self) -> Ref<'_, u32> {
        self.data_ptr.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn tss_set(&self) -> Ref<'_, OptRc<PkoLmo_RenderStateSet28>> {
        self.tss_set.borrow()
    }
}
impl PkoLmo_TexInfo0001 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_TexInfoCurrent {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    stage: RefCell<u32>,
    level: RefCell<u32>,
    usage: RefCell<u32>,
    format: RefCell<u32>,
    pool: RefCell<u32>,
    byte_alignment_flag: RefCell<u32>,
    tex_type: RefCell<u32>,
    width: RefCell<u32>,
    height: RefCell<u32>,
    colorkey_type: RefCell<u32>,
    colorkey: RefCell<OptRc<PkoLmo_ColorValue4b>>,
    file_name: RefCell<Vec<u8>>,
    data_ptr: RefCell<u32>,
    tss_set: RefCell<Vec<OptRc<PkoLmo_RenderStateAtom>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_TexInfoCurrent {
    type Root = PkoLmo;
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
        *self_rc.stage.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.level.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.usage.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.format.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.pool.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.byte_alignment_flag.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.tex_type.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.width.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.height.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.colorkey_type.borrow_mut() = _io.read_u4le()?.into();
        let t = Self::read_into::<_, PkoLmo_ColorValue4b>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.colorkey.borrow_mut() = t;
        *self_rc.file_name.borrow_mut() = _io.read_bytes(64 as usize)?.into();
        *self_rc.data_ptr.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.tss_set.borrow_mut() = Vec::new();
        let l_tss_set = 8;
        for _i in 0..l_tss_set {
            let t = Self::read_into::<_, PkoLmo_RenderStateAtom>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.tss_set.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_TexInfoCurrent {
}
impl PkoLmo_TexInfoCurrent {
    pub fn stage(&self) -> Ref<'_, u32> {
        self.stage.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn level(&self) -> Ref<'_, u32> {
        self.level.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn usage(&self) -> Ref<'_, u32> {
        self.usage.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn format(&self) -> Ref<'_, u32> {
        self.format.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn pool(&self) -> Ref<'_, u32> {
        self.pool.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn byte_alignment_flag(&self) -> Ref<'_, u32> {
        self.byte_alignment_flag.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn tex_type(&self) -> Ref<'_, u32> {
        self.tex_type.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn width(&self) -> Ref<'_, u32> {
        self.width.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn height(&self) -> Ref<'_, u32> {
        self.height.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn colorkey_type(&self) -> Ref<'_, u32> {
        self.colorkey_type.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn colorkey(&self) -> Ref<'_, OptRc<PkoLmo_ColorValue4b>> {
        self.colorkey.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn file_name(&self) -> Ref<'_, Vec<u8>> {
        self.file_name.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn data_ptr(&self) -> Ref<'_, u32> {
        self.data_ptr.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn tss_set(&self) -> Ref<'_, Vec<OptRc<PkoLmo_RenderStateAtom>>> {
        self.tss_set.borrow()
    }
}
impl PkoLmo_TexInfoCurrent {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_TexcoordChannel {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MeshSection>,
    pub _self: SharedType<Self>,
    vertex_num: RefCell<u32>,
    values: RefCell<Vec<OptRc<PkoLmo_Vector2>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_TexcoordChannel {
    type Root = PkoLmo;
    type Parent = PkoLmo_MeshSection;

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
        *self_rc.values.borrow_mut() = Vec::new();
        let l_values = *self_rc.vertex_num();
        for _i in 0..l_values {
            let t = Self::read_into::<_, PkoLmo_Vector2>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.values.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoLmo_TexcoordChannel {
    pub fn vertex_num(&self) -> Ref<'_, u32> {
        self.vertex_num.borrow()
    }
}
impl PkoLmo_TexcoordChannel {
    pub fn set_params(&mut self, vertex_num: u32) {
        *self.vertex_num.borrow_mut() = vertex_num;
    }
}
impl PkoLmo_TexcoordChannel {
}
impl PkoLmo_TexcoordChannel {
    pub fn values(&self) -> Ref<'_, Vec<OptRc<PkoLmo_Vector2>>> {
        self.values.borrow()
    }
}
impl PkoLmo_TexcoordChannel {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Vector2 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_TexcoordChannel>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_Vector2 {
    type Root = PkoLmo;
    type Parent = PkoLmo_TexcoordChannel;

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
        Ok(())
    }
}
impl PkoLmo_Vector2 {
}
impl PkoLmo_Vector2 {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoLmo_Vector2 {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoLmo_Vector2 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_Vector3 {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    z: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_Vector3 {
    type Root = PkoLmo;
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
        *self_rc.x.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.y.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.z.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoLmo_Vector3 {
}
impl PkoLmo_Vector3 {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoLmo_Vector3 {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoLmo_Vector3 {
    pub fn z(&self) -> Ref<'_, f32> {
        self.z.borrow()
    }
}
impl PkoLmo_Vector3 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoLmo_VertexElement {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo_MeshSection>,
    pub _self: SharedType<Self>,
    stream: RefCell<u16>,
    offset: RefCell<u16>,
    elem_type: RefCell<u8>,
    method: RefCell<u8>,
    usage: RefCell<u8>,
    usage_index: RefCell<u8>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoLmo_VertexElement {
    type Root = PkoLmo;
    type Parent = PkoLmo_MeshSection;

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
        *self_rc.stream.borrow_mut() = _io.read_u2le()?.into();
        *self_rc.offset.borrow_mut() = _io.read_u2le()?.into();
        *self_rc.elem_type.borrow_mut() = _io.read_u1()?.into();
        *self_rc.method.borrow_mut() = _io.read_u1()?.into();
        *self_rc.usage.borrow_mut() = _io.read_u1()?.into();
        *self_rc.usage_index.borrow_mut() = _io.read_u1()?.into();
        Ok(())
    }
}
impl PkoLmo_VertexElement {
}
impl PkoLmo_VertexElement {
    pub fn stream(&self) -> Ref<'_, u16> {
        self.stream.borrow()
    }
}
impl PkoLmo_VertexElement {
    pub fn offset(&self) -> Ref<'_, u16> {
        self.offset.borrow()
    }
}
impl PkoLmo_VertexElement {
    pub fn elem_type(&self) -> Ref<'_, u8> {
        self.elem_type.borrow()
    }
}
impl PkoLmo_VertexElement {
    pub fn method(&self) -> Ref<'_, u8> {
        self.method.borrow()
    }
}
impl PkoLmo_VertexElement {
    pub fn usage(&self) -> Ref<'_, u8> {
        self.usage.borrow()
    }
}
impl PkoLmo_VertexElement {
    pub fn usage_index(&self) -> Ref<'_, u8> {
        self.usage_index.borrow()
    }
}
impl PkoLmo_VertexElement {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
