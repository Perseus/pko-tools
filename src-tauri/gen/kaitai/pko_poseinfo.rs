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
 * Binary pose-info table loaded from scripts/table/characterposeinfo.bin.
 * Contains 54 named action definitions with weapon-variant pose ID mappings.
 */

#[derive(Default, Debug, Clone)]
pub struct PkoPoseinfo {
    pub _root: SharedType<PkoPoseinfo>,
    pub _parent: SharedType<PkoPoseinfo>,
    pub _self: SharedType<Self>,
    header: RefCell<OptRc<PkoPoseinfo_Header>>,
    entries: RefCell<Vec<OptRc<PkoPoseinfo_PoseEntry>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoPoseinfo {
    type Root = PkoPoseinfo;
    type Parent = PkoPoseinfo;

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
        let t = Self::read_into::<_, PkoPoseinfo_Header>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.header.borrow_mut() = t;
        *self_rc.entries.borrow_mut() = Vec::new();
        for _i in 0..54 {
            let t = Self::read_into::<_, PkoPoseinfo_PoseEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.entries.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoPoseinfo {
}
impl PkoPoseinfo {
    pub fn header(&self) -> Ref<'_, OptRc<PkoPoseinfo_Header>> {
        self.header.borrow()
    }
}
impl PkoPoseinfo {
    pub fn entries(&self) -> Ref<'_, Vec<OptRc<PkoPoseinfo_PoseEntry>>> {
        self.entries.borrow()
    }
}
impl PkoPoseinfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoPoseinfo_Header {
    pub _root: SharedType<PkoPoseinfo>,
    pub _parent: SharedType<PkoPoseinfo>,
    pub _self: SharedType<Self>,
    max_id: RefCell<u32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoPoseinfo_Header {
    type Root = PkoPoseinfo;
    type Parent = PkoPoseinfo;

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
        *self_rc.max_id.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoPoseinfo_Header {
}
impl PkoPoseinfo_Header {
    pub fn max_id(&self) -> Ref<'_, u32> {
        self.max_id.borrow()
    }
}
impl PkoPoseinfo_Header {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoPoseinfo_PoseEntry {
    pub _root: SharedType<PkoPoseinfo>,
    pub _parent: SharedType<PkoPoseinfo>,
    pub _self: SharedType<Self>,
    unknown1: RefCell<u32>,
    pose_id: RefCell<u32>,
    name: RefCell<Vec<u8>>,
    metadata: RefCell<Vec<u8>>,
    weapon_variants: RefCell<Vec<i16>>,
    padding: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoPoseinfo_PoseEntry {
    type Root = PkoPoseinfo;
    type Parent = PkoPoseinfo;

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
        *self_rc.unknown1.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.pose_id.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.name.borrow_mut() = _io.read_bytes(64 as usize)?.into();
        *self_rc.metadata.borrow_mut() = _io.read_bytes(36 as usize)?.into();
        *self_rc.weapon_variants.borrow_mut() = Vec::new();
        for _i in 0..7 {
            self_rc.weapon_variants.borrow_mut().push(_io.read_s2le()?.into());
        }
        *self_rc.padding.borrow_mut() = _io.read_bytes(2 as usize)?.into();
        Ok(())
    }
}
impl PkoPoseinfo_PoseEntry {
}
impl PkoPoseinfo_PoseEntry {
    pub fn unknown1(&self) -> Ref<'_, u32> {
        self.unknown1.borrow()
    }
}
impl PkoPoseinfo_PoseEntry {
    pub fn pose_id(&self) -> Ref<'_, u32> {
        self.pose_id.borrow()
    }
}
impl PkoPoseinfo_PoseEntry {
    pub fn name(&self) -> Ref<'_, Vec<u8>> {
        self.name.borrow()
    }
}
impl PkoPoseinfo_PoseEntry {
    pub fn metadata(&self) -> Ref<'_, Vec<u8>> {
        self.metadata.borrow()
    }
}
impl PkoPoseinfo_PoseEntry {
    pub fn weapon_variants(&self) -> Ref<'_, Vec<i16>> {
        self.weapon_variants.borrow()
    }
}
impl PkoPoseinfo_PoseEntry {
    pub fn padding(&self) -> Ref<'_, Vec<u8>> {
        self.padding.borrow()
    }
}
impl PkoPoseinfo_PoseEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
