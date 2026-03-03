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
 * Binary scene-object placement format loaded by CSceneObjFile::Load()
 * in the PKO client engine.
 * 
 * Layout:
 *   - 44-byte header (title[16], version, file_size, section dims, section_obj_num)
 *   - Section index: section_cnt_x * section_cnt_y × (offset:s4, count:s4)
 *   - Per section at offset: count × 20-byte MSVC-aligned SSceneObjInfo records
 * 
 * The 20-byte record size comes from MSVC default struct alignment (no #pragma pack):
 *   sTypeID(s2) + 2 pad + nX(s4) + nY(s4) + sHeightOff(s2) + sYawAngle(s2) + sScale(s2) + 2 pad
 */

#[derive(Default, Debug, Clone)]
pub struct PkoObj {
    pub _root: SharedType<PkoObj>,
    pub _parent: SharedType<PkoObj>,
    pub _self: SharedType<Self>,
    title: RefCell<Vec<u8>>,
    version: RefCell<i32>,
    file_size: RefCell<i32>,
    section_cnt_x: RefCell<i32>,
    section_cnt_y: RefCell<i32>,
    section_width: RefCell<i32>,
    section_height: RefCell<i32>,
    section_obj_num: RefCell<i32>,
    section_index: RefCell<Vec<OptRc<PkoObj_SectionIndexEntry>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoObj {
    type Root = PkoObj;
    type Parent = PkoObj;

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
        *self_rc.title.borrow_mut() = _io.read_bytes(16 as usize)?.into();
        *self_rc.version.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.file_size.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.section_cnt_x.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.section_cnt_y.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.section_width.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.section_height.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.section_obj_num.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.section_index.borrow_mut() = Vec::new();
        let l_section_index = ((*self_rc.section_cnt_x() as i32) * (*self_rc.section_cnt_y() as i32));
        for _i in 0..l_section_index {
            let t = Self::read_into::<_, PkoObj_SectionIndexEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.section_index.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoObj {
}
impl PkoObj {
    pub fn title(&self) -> Ref<'_, Vec<u8>> {
        self.title.borrow()
    }
}
impl PkoObj {
    pub fn version(&self) -> Ref<'_, i32> {
        self.version.borrow()
    }
}
impl PkoObj {
    pub fn file_size(&self) -> Ref<'_, i32> {
        self.file_size.borrow()
    }
}
impl PkoObj {
    pub fn section_cnt_x(&self) -> Ref<'_, i32> {
        self.section_cnt_x.borrow()
    }
}
impl PkoObj {
    pub fn section_cnt_y(&self) -> Ref<'_, i32> {
        self.section_cnt_y.borrow()
    }
}
impl PkoObj {
    pub fn section_width(&self) -> Ref<'_, i32> {
        self.section_width.borrow()
    }
}
impl PkoObj {
    pub fn section_height(&self) -> Ref<'_, i32> {
        self.section_height.borrow()
    }
}
impl PkoObj {
    pub fn section_obj_num(&self) -> Ref<'_, i32> {
        self.section_obj_num.borrow()
    }
}
impl PkoObj {
    pub fn section_index(&self) -> Ref<'_, Vec<OptRc<PkoObj_SectionIndexEntry>>> {
        self.section_index.borrow()
    }
}
impl PkoObj {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

/**
 * SSceneObjInfo — 20-byte MSVC-aligned record.
 * sTypeID top 2 bits = type (0=model, 1=effect), lower 14 = ID.
 */

#[derive(Default, Debug, Clone)]
pub struct PkoObj_SceneObjInfo {
    pub _root: SharedType<PkoObj>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    type_id: RefCell<i16>,
    pad1: RefCell<Vec<u8>>,
    nx: RefCell<i32>,
    ny: RefCell<i32>,
    height_off: RefCell<i16>,
    yaw_angle: RefCell<i16>,
    scale: RefCell<i16>,
    pad2: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoObj_SceneObjInfo {
    type Root = PkoObj;
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
        *self_rc.type_id.borrow_mut() = _io.read_s2le()?.into();
        *self_rc.pad1.borrow_mut() = _io.read_bytes(2 as usize)?.into();
        *self_rc.nx.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.ny.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.height_off.borrow_mut() = _io.read_s2le()?.into();
        *self_rc.yaw_angle.borrow_mut() = _io.read_s2le()?.into();
        *self_rc.scale.borrow_mut() = _io.read_s2le()?.into();
        *self_rc.pad2.borrow_mut() = _io.read_bytes(2 as usize)?.into();
        Ok(())
    }
}
impl PkoObj_SceneObjInfo {
}
impl PkoObj_SceneObjInfo {
    pub fn type_id(&self) -> Ref<'_, i16> {
        self.type_id.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn pad1(&self) -> Ref<'_, Vec<u8>> {
        self.pad1.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn nx(&self) -> Ref<'_, i32> {
        self.nx.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn ny(&self) -> Ref<'_, i32> {
        self.ny.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn height_off(&self) -> Ref<'_, i16> {
        self.height_off.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn yaw_angle(&self) -> Ref<'_, i16> {
        self.yaw_angle.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn scale(&self) -> Ref<'_, i16> {
        self.scale.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn pad2(&self) -> Ref<'_, Vec<u8>> {
        self.pad2.borrow()
    }
}
impl PkoObj_SceneObjInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoObj_SectionIndexEntry {
    pub _root: SharedType<PkoObj>,
    pub _parent: SharedType<PkoObj>,
    pub _self: SharedType<Self>,
    offset: RefCell<i32>,
    count: RefCell<i32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoObj_SectionIndexEntry {
    type Root = PkoObj;
    type Parent = PkoObj;

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
        *self_rc.offset.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.count.borrow_mut() = _io.read_s4le()?.into();
        Ok(())
    }
}
impl PkoObj_SectionIndexEntry {
}
impl PkoObj_SectionIndexEntry {
    pub fn offset(&self) -> Ref<'_, i32> {
        self.offset.borrow()
    }
}
impl PkoObj_SectionIndexEntry {
    pub fn count(&self) -> Ref<'_, i32> {
        self.count.borrow()
    }
}
impl PkoObj_SectionIndexEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
