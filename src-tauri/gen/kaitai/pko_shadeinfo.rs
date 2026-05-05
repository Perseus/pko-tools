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
 * Binary table used by CShadeInfoMgr::Load("scripts/table/shadeinfo", ...).
 * The file layout is:
 * 1) u4 record_size (sizeof(CShadeInfo) = 172)
 * 2) repeated CShadeInfo records to EOF
 * 
 * For the original 32-bit client, record_size is 172 bytes.
 * Important: shade IDs are stored in each entry as `n_id` and are 1-based in this file.
 * The Kaitai `entries` array is 0-based, so `entries[0]` has `n_id = 1`.
 * Struct source:
 * - CRawDataInfo in Common/common/include/TableData.h
 * - CShadeInfo in Client/src/EffectSet.h:246-287
 */

#[derive(Default, Debug, Clone)]
pub struct PkoShadeinfo {
    pub _root: SharedType<PkoShadeinfo>,
    pub _parent: SharedType<PkoShadeinfo>,
    pub _self: SharedType<Self>,
    record_size: RefCell<u32>,
    entries: RefCell<Vec<OptRc<PkoShadeinfo_ShadeInfoEntry>>>,
    _io: RefCell<BytesReader>,
    f_entry_count: Cell<bool>,
    entry_count: RefCell<i32>,
    f_has_expected_record_size: Cell<bool>,
    has_expected_record_size: RefCell<bool>,
}
impl KStruct for PkoShadeinfo {
    type Root = PkoShadeinfo;
    type Parent = PkoShadeinfo;

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
                let t = Self::read_into::<_, PkoShadeinfo_ShadeInfoEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.entries.borrow_mut().push(t);
                _i += 1;
            }
        }
        Ok(())
    }
}
impl PkoShadeinfo {
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
        *self.has_expected_record_size.borrow_mut() = (((*self.record_size() as u32) == (172 as u32))) as bool;
        Ok(self.has_expected_record_size.borrow())
    }
}

/**
 * Size in bytes of each record (sizeof(CShadeInfo) = 172)
 */
impl PkoShadeinfo {
    pub fn record_size(&self) -> Ref<'_, u32> {
        self.record_size.borrow()
    }
}

/**
 * Array of shade info records until end-of-stream
 */
impl PkoShadeinfo {
    pub fn entries(&self) -> Ref<'_, Vec<OptRc<PkoShadeinfo_ShadeInfoEntry>>> {
        self.entries.borrow()
    }
}
impl PkoShadeinfo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

/**
 * CShadeInfo record (172 bytes). CRawDataInfo base (108 bytes) + CShadeInfo fields (64 bytes).
 */

#[derive(Default, Debug, Clone)]
pub struct PkoShadeinfo_ShadeInfoEntry {
    pub _root: SharedType<PkoShadeinfo>,
    pub _parent: SharedType<PkoShadeinfo>,
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
    sz_name: RefCell<String>,
    n_photo_tex_id: RefCell<i32>,
    f_size: RefCell<f32>,
    n_ani: RefCell<i32>,
    n_row: RefCell<i32>,
    n_col: RefCell<i32>,
    n_use_alpha_test: RefCell<i32>,
    n_alpha_type: RefCell<i32>,
    n_color_r: RefCell<i32>,
    n_color_g: RefCell<i32>,
    n_color_b: RefCell<i32>,
    n_color_a: RefCell<i32>,
    n_type: RefCell<i32>,
    _io: RefCell<BytesReader>,
    f_b_enable: Cell<bool>,
    b_enable: RefCell<bool>,
    f_b_exist: Cell<bool>,
    b_exist: RefCell<bool>,
}
impl KStruct for PkoShadeinfo_ShadeInfoEntry {
    type Root = PkoShadeinfo;
    type Parent = PkoShadeinfo;

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
        *self_rc.sz_name.borrow_mut() = bytes_to_str(&bytes_terminate(&bytes_strip_right(&_io.read_bytes(16 as usize)?.into(), 0).into(), 0, false).into(), "ASCII")?;
        *self_rc.n_photo_tex_id.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.f_size.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.n_ani.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_row.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_col.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_use_alpha_test.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_alpha_type.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_color_r.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_color_g.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_color_b.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_color_a.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_type.borrow_mut() = _io.read_s4le()?.into();
        Ok(())
    }
}
impl PkoShadeinfo_ShadeInfoEntry {

    /**
     * Boolean: record is enabled
     */
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

    /**
     * Boolean: record is active
     */
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
}

/**
 * Whether this record is active (nonzero = yes)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn b_exist_raw(&self) -> Ref<'_, u32> {
        self.b_exist_raw.borrow()
    }
}

/**
 * Array index within the shade data set
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_index(&self) -> Ref<'_, i32> {
        self.n_index.borrow()
    }
}

/**
 * Texture resource name (e.g., 'shade_circle', 'shade_aoe')
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn sz_data_name(&self) -> Ref<'_, String> {
        self.sz_data_name.borrow()
    }
}

/**
 * Last-access tick count (runtime only, always 0 in file)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn dw_last_use_tick(&self) -> Ref<'_, u32> {
        self.dw_last_use_tick.borrow()
    }
}

/**
 * Whether record is enabled (nonzero = yes)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn b_enable_raw(&self) -> Ref<'_, u32> {
        self.b_enable_raw.borrow()
    }
}

/**
 * Runtime data pointer (always 0 in serialized file)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn p_data(&self) -> Ref<'_, u32> {
        self.p_data.borrow()
    }
}

/**
 * Offset into pack file (unused)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn dw_pack_offset(&self) -> Ref<'_, u32> {
        self.dw_pack_offset.borrow()
    }
}

/**
 * Original data file size (unused)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn dw_data_size(&self) -> Ref<'_, u32> {
        self.dw_data_size.borrow()
    }
}

/**
 * Shade ID (primary key, 1-based)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_id(&self) -> Ref<'_, i32> {
        self.n_id.borrow()
    }
}

/**
 * Resource load count (runtime only)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn dw_load_cnt(&self) -> Ref<'_, u32> {
        self.dw_load_cnt.borrow()
    }
}

/**
 * Display name for this shade entry
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn sz_name(&self) -> Ref<'_, String> {
        self.sz_name.borrow()
    }
}

/**
 * Photo texture ID reference
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_photo_tex_id(&self) -> Ref<'_, i32> {
        self.n_photo_tex_id.borrow()
    }
}

/**
 * Radius of the shade in world units
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn f_size(&self) -> Ref<'_, f32> {
        self.f_size.borrow()
    }
}

/**
 * Animated flag (0=static, nonzero=animated)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_ani(&self) -> Ref<'_, i32> {
        self.n_ani.borrow()
    }
}

/**
 * Number of rows in sprite sheet grid
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_row(&self) -> Ref<'_, i32> {
        self.n_row.borrow()
    }
}

/**
 * Number of columns in sprite sheet grid
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_col(&self) -> Ref<'_, i32> {
        self.n_col.borrow()
    }
}

/**
 * Whether to use alpha test (0=no, nonzero=yes)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_use_alpha_test(&self) -> Ref<'_, i32> {
        self.n_use_alpha_test.borrow()
    }
}

/**
 * Alpha blend mode (0=standard, 1=additive, 2=screen)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_alpha_type(&self) -> Ref<'_, i32> {
        self.n_alpha_type.borrow()
    }
}

/**
 * Red color component (0-255)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_color_r(&self) -> Ref<'_, i32> {
        self.n_color_r.borrow()
    }
}

/**
 * Green color component (0-255)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_color_g(&self) -> Ref<'_, i32> {
        self.n_color_g.borrow()
    }
}

/**
 * Blue color component (0-255)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_color_b(&self) -> Ref<'_, i32> {
        self.n_color_b.borrow()
    }
}

/**
 * Alpha color component (0-255)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_color_a(&self) -> Ref<'_, i32> {
        self.n_color_a.borrow()
    }
}

/**
 * Shade type (0=character shadow, 1=effect)
 */
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn n_type(&self) -> Ref<'_, i32> {
        self.n_type.borrow()
    }
}
impl PkoShadeinfo_ShadeInfoEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
