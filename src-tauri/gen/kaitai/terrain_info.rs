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
 * Binary table used by MPTerrainSet::LoadRawDataInfo("scripts/table/TerrainInfo", ...).
 * The file layout is:
 * 1) u4 record_size (sizeof(MPTerrainInfo))
 * 2) repeated MPTerrainInfo records to EOF
 * 
 * For the original 32-bit client, record_size is 120 bytes.
 * Important: terrain IDs are stored in each entry as `n_id` and are 1-based in this file.
 * The Kaitai `entries` array is 0-based, so `entries[21]` has `n_id = 22`.
 * Struct source:
 * - CRawDataInfo in Common/common/include/TableData.h
 * - MPTerrainInfo in engine/sdk/include/MPTerrainSet.h
 */

#[derive(Default, Debug, Clone)]
pub struct TerrainInfo {
    pub _root: SharedType<TerrainInfo>,
    pub _parent: SharedType<TerrainInfo>,
    pub _self: SharedType<Self>,
    record_size: RefCell<u32>,
    entries: RefCell<Vec<OptRc<TerrainInfo_TerrainInfoEntry>>>,
    _io: RefCell<BytesReader>,
    f_entry_count: Cell<bool>,
    entry_count: RefCell<i32>,
    f_has_expected_record_size: Cell<bool>,
    has_expected_record_size: RefCell<bool>,
}
impl KStruct for TerrainInfo {
    type Root = TerrainInfo;
    type Parent = TerrainInfo;

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
        *self_rc.record_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.entries.borrow_mut() = Vec::new();
        {
            let mut _i = 0;
            while !_io.is_eof() {
                let t = Self::read_into::<_, TerrainInfo_TerrainInfoEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.entries.borrow_mut().push(t);
                _i += 1;
            }
        }
        Ok(())
    }
}
impl TerrainInfo {
    pub fn entry_count(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_entry_count.get() {
            return Ok(self.entry_count.borrow());
        }
        self.f_entry_count.set(true);
        *self.entry_count.borrow_mut() = (self.entries().len()) as i32;
        Ok(self.entry_count.borrow())
    }
    pub fn has_expected_record_size(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_has_expected_record_size.get() {
            return Ok(self.has_expected_record_size.borrow());
        }
        self.f_has_expected_record_size.set(true);
        *self.has_expected_record_size.borrow_mut() = (((*self.record_size() as u32) == (120 as u32))) as bool;
        Ok(self.has_expected_record_size.borrow())
    }
}
impl TerrainInfo {
    pub fn record_size(&self) -> Ref<'_, u32> {
        self.record_size.borrow()
    }
}
impl TerrainInfo {
    pub fn entries(&self) -> Ref<'_, Vec<OptRc<TerrainInfo_TerrainInfoEntry>>> {
        self.entries.borrow()
    }
}
impl TerrainInfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct TerrainInfo_TerrainInfoEntry {
    pub _root: SharedType<TerrainInfo>,
    pub _parent: SharedType<TerrainInfo>,
    pub _self: SharedType<Self>,
    b_exist_raw: RefCell<u32>,
    n_index: RefCell<i32>,
    sz_data_name: RefCell<String>,
    dw_last_use_tick: RefCell<u32>,
    b_enable_raw: RefCell<u32>,
    p_data: RefCell<u32>,
    dw_pack_offset: RefCell<u32>,
    dw_data_size: RefCell<u32>,
    n_id: RefCell<i32>,
    dw_load_cnt: RefCell<u32>,
    bt_type: RefCell<u8>,
    pad_after_type: RefCell<Vec<u8>>,
    n_texture_id: RefCell<i32>,
    bt_attr: RefCell<u8>,
    pad_after_attr: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
    f_b_enable: Cell<bool>,
    b_enable: RefCell<bool>,
    f_b_exist: Cell<bool>,
    b_exist: RefCell<bool>,
    f_is_underwater_type: Cell<bool>,
    is_underwater_type: RefCell<bool>,
}
impl KStruct for TerrainInfo_TerrainInfoEntry {
    type Root = TerrainInfo;
    type Parent = TerrainInfo;

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
        *self_rc.b_exist_raw.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.n_index.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.sz_data_name.borrow_mut() = bytes_to_str(&bytes_terminate(&bytes_strip_right(&_io.read_bytes(72 as usize)?.into(), 0).into(), 0, false).into(), "ASCII")?;
        *self_rc.dw_last_use_tick.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.b_enable_raw.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.p_data.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.dw_pack_offset.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.dw_data_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.n_id.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.dw_load_cnt.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.bt_type.borrow_mut() = _io.read_u1()?.into();
        *self_rc.pad_after_type.borrow_mut() = _io.read_bytes(3 as usize)?.into();
        *self_rc.n_texture_id.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.bt_attr.borrow_mut() = _io.read_u1()?.into();
        *self_rc.pad_after_attr.borrow_mut() = _io.read_bytes(3 as usize)?.into();
        Ok(())
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn b_enable(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_b_enable.get() {
            return Ok(self.b_enable.borrow());
        }
        self.f_b_enable.set(true);
        *self.b_enable.borrow_mut() = (((*self.b_enable_raw() as u32) != (0 as u32))) as bool;
        Ok(self.b_enable.borrow())
    }
    pub fn b_exist(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_b_exist.get() {
            return Ok(self.b_exist.borrow());
        }
        self.f_b_exist.set(true);
        *self.b_exist.borrow_mut() = (((*self.b_exist_raw() as u32) != (0 as u32))) as bool;
        Ok(self.b_exist.borrow())
    }
    pub fn is_underwater_type(
        &self
    ) -> KResult<Ref<'_, bool>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_is_underwater_type.get() {
            return Ok(self.is_underwater_type.borrow());
        }
        self.f_is_underwater_type.set(true);
        *self.is_underwater_type.borrow_mut() = (((*self.bt_type() as u8) == (1 as u8))) as bool;
        Ok(self.is_underwater_type.borrow())
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn b_exist_raw(&self) -> Ref<'_, u32> {
        self.b_exist_raw.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn n_index(&self) -> Ref<'_, i32> {
        self.n_index.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn sz_data_name(&self) -> Ref<'_, String> {
        self.sz_data_name.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn dw_last_use_tick(&self) -> Ref<'_, u32> {
        self.dw_last_use_tick.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn b_enable_raw(&self) -> Ref<'_, u32> {
        self.b_enable_raw.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn p_data(&self) -> Ref<'_, u32> {
        self.p_data.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn dw_pack_offset(&self) -> Ref<'_, u32> {
        self.dw_pack_offset.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn dw_data_size(&self) -> Ref<'_, u32> {
        self.dw_data_size.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn n_id(&self) -> Ref<'_, i32> {
        self.n_id.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn dw_load_cnt(&self) -> Ref<'_, u32> {
        self.dw_load_cnt.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn bt_type(&self) -> Ref<'_, u8> {
        self.bt_type.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn pad_after_type(&self) -> Ref<'_, Vec<u8>> {
        self.pad_after_type.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn n_texture_id(&self) -> Ref<'_, i32> {
        self.n_texture_id.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn bt_attr(&self) -> Ref<'_, u8> {
        self.bt_attr.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn pad_after_attr(&self) -> Ref<'_, Vec<u8>> {
        self.pad_after_attr.borrow()
    }
}
impl TerrainInfo_TerrainInfoEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
