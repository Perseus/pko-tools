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
 * Binary table of magic/skill effect parameters, serialized by
 * CRawDataSet::_WriteRawDataInfo_Bin().  Each record is a flat
 * EFF_Param struct (inheriting CRawDataInfo) of exactly `record_size`
 * bytes.
 * 
 * File layout:
 *   4 bytes  — record_size (u4le, always 600 for EFF_Param)
 *   N × record_size bytes — one EFF_Param per active record
 */

#[derive(Default, Debug, Clone)]
pub struct PkoMagicSingle {
    pub _root: SharedType<PkoMagicSingle>,
    pub _parent: SharedType<PkoMagicSingle>,
    pub _self: SharedType<Self>,
    record_size: RefCell<u32>,
    records: RefCell<Vec<OptRc<PkoMagicSingle_EffParam>>>,
    _io: RefCell<BytesReader>,
    records_raw: RefCell<Vec<Vec<u8>>>,
}
impl KStruct for PkoMagicSingle {
    type Root = PkoMagicSingle;
    type Parent = PkoMagicSingle;

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
        *self_rc.records_raw.borrow_mut() = Vec::new();
        *self_rc.records.borrow_mut() = Vec::new();
        {
            let mut _i = 0;
            while !_io.is_eof() {
                self_rc.records_raw.borrow_mut().push(_io.read_bytes(*self_rc.record_size() as usize)?.into());
                let records_raw = self_rc.records_raw.borrow();
                let io_records_raw = BytesReader::from(records_raw.last().unwrap().clone());
                let t = Self::read_into::<BytesReader, PkoMagicSingle_EffParam>(&io_records_raw, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.records.borrow_mut().push(t);
                _i += 1;
            }
        }
        Ok(())
    }
}
impl PkoMagicSingle {
}

/**
 * Size in bytes of each record (sizeof(EFF_Param) = 600).
 */
impl PkoMagicSingle {
    pub fn record_size(&self) -> Ref<'_, u32> {
        self.record_size.borrow()
    }
}

/**
 * Array of EFF_Param records until end-of-stream.
 */
impl PkoMagicSingle {
    pub fn records(&self) -> Ref<'_, Vec<OptRc<PkoMagicSingle_EffParam>>> {
        self.records.borrow()
    }
}
impl PkoMagicSingle {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoMagicSingle {
    pub fn records_raw(&self) -> Ref<'_, Vec<Vec<u8>>> {
        self.records_raw.borrow()
    }
}

/**
 * CRawDataInfo base (108 bytes) + EFF_Param derived fields (492 bytes).
 * Total: 600 bytes.
 */

#[derive(Default, Debug, Clone)]
pub struct PkoMagicSingle_EffParam {
    pub _root: SharedType<PkoMagicSingle>,
    pub _parent: SharedType<PkoMagicSingle>,
    pub _self: SharedType<Self>,
    b_exist: RefCell<u32>,
    n_index: RefCell<i32>,
    sz_data_name: RefCell<String>,
    dw_last_use_tick: RefCell<u32>,
    b_enable: RefCell<u32>,
    p_data: RefCell<u32>,
    dw_pack_offset: RefCell<u32>,
    dw_data_size: RefCell<u32>,
    n_id: RefCell<i32>,
    dw_load_cnt: RefCell<u32>,
    sz_name: RefCell<String>,
    n_model_num: RefCell<i32>,
    str_model: RefCell<Vec<String>>,
    n_vel: RefCell<i32>,
    n_par_num: RefCell<i32>,
    str_part: RefCell<Vec<String>>,
    n_dummy: RefCell<Vec<i32>>,
    n_render_idx: RefCell<i32>,
    n_light_id: RefCell<i32>,
    str_result: RefCell<String>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoMagicSingle_EffParam {
    type Root = PkoMagicSingle;
    type Parent = PkoMagicSingle;

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
        *self_rc.b_exist.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.n_index.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.sz_data_name.borrow_mut() = bytes_to_str(&_io.read_bytes(72 as usize)?.into(), "ASCII")?;
        *self_rc.dw_last_use_tick.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.b_enable.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.p_data.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.dw_pack_offset.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.dw_data_size.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.n_id.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.dw_load_cnt.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.sz_name.borrow_mut() = bytes_to_str(&_io.read_bytes(32 as usize)?.into(), "ASCII")?;
        *self_rc.n_model_num.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.str_model.borrow_mut() = Vec::new();
        let l_str_model = 8;
        for _i in 0..l_str_model {
            self_rc.str_model.borrow_mut().push(bytes_to_str(&_io.read_bytes(24 as usize)?.into(), "ASCII")?);
        }
        *self_rc.n_vel.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_par_num.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.str_part.borrow_mut() = Vec::new();
        let l_str_part = 8;
        for _i in 0..l_str_part {
            self_rc.str_part.borrow_mut().push(bytes_to_str(&_io.read_bytes(24 as usize)?.into(), "ASCII")?);
        }
        *self_rc.n_dummy.borrow_mut() = Vec::new();
        let l_n_dummy = 8;
        for _i in 0..l_n_dummy {
            self_rc.n_dummy.borrow_mut().push(_io.read_s4le()?.into());
        }
        *self_rc.n_render_idx.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_light_id.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.str_result.borrow_mut() = bytes_to_str(&_io.read_bytes(24 as usize)?.into(), "ASCII")?;
        Ok(())
    }
}
impl PkoMagicSingle_EffParam {
}

/**
 * Whether this record is active (1 = yes, 0 = no).
 */
impl PkoMagicSingle_EffParam {
    pub fn b_exist(&self) -> Ref<'_, u32> {
        self.b_exist.borrow()
    }
}

/**
 * Array index within the raw data set.
 */
impl PkoMagicSingle_EffParam {
    pub fn n_index(&self) -> Ref<'_, i32> {
        self.n_index.borrow()
    }
}

/**
 * Data source name (null-terminated, zero-padded).
 */
impl PkoMagicSingle_EffParam {
    pub fn sz_data_name(&self) -> Ref<'_, String> {
        self.sz_data_name.borrow()
    }
}

/**
 * Last-access tick count (runtime only, 0 in file).
 */
impl PkoMagicSingle_EffParam {
    pub fn dw_last_use_tick(&self) -> Ref<'_, u32> {
        self.dw_last_use_tick.borrow()
    }
}

/**
 * Whether record is enabled (1 = yes).
 */
impl PkoMagicSingle_EffParam {
    pub fn b_enable(&self) -> Ref<'_, u32> {
        self.b_enable.borrow()
    }
}

/**
 * Runtime data pointer (always 0 in serialized file).
 */
impl PkoMagicSingle_EffParam {
    pub fn p_data(&self) -> Ref<'_, u32> {
        self.p_data.borrow()
    }
}

/**
 * Offset into pack file (unused here).
 */
impl PkoMagicSingle_EffParam {
    pub fn dw_pack_offset(&self) -> Ref<'_, u32> {
        self.dw_pack_offset.borrow()
    }
}

/**
 * Original data file size (unused here).
 */
impl PkoMagicSingle_EffParam {
    pub fn dw_data_size(&self) -> Ref<'_, u32> {
        self.dw_data_size.borrow()
    }
}

/**
 * Magic effect ID — the primary key.
 */
impl PkoMagicSingle_EffParam {
    pub fn n_id(&self) -> Ref<'_, i32> {
        self.n_id.borrow()
    }
}

/**
 * Resource load count (runtime only).
 */
impl PkoMagicSingle_EffParam {
    pub fn dw_load_cnt(&self) -> Ref<'_, u32> {
        self.dw_load_cnt.borrow()
    }
}

/**
 * Display name of the effect (null-terminated).
 */
impl PkoMagicSingle_EffParam {
    pub fn sz_name(&self) -> Ref<'_, String> {
        self.sz_name.borrow()
    }
}

/**
 * Number of model/effect file names (0–8).
 */
impl PkoMagicSingle_EffParam {
    pub fn n_model_num(&self) -> Ref<'_, i32> {
        self.n_model_num.borrow()
    }
}

/**
 * Model/effect file names (8 slots × 24 bytes each).
 * Only the first n_model_num slots are meaningful.
 */
impl PkoMagicSingle_EffParam {
    pub fn str_model(&self) -> Ref<'_, Vec<String>> {
        self.str_model.borrow()
    }
}

/**
 * Effect velocity.
 */
impl PkoMagicSingle_EffParam {
    pub fn n_vel(&self) -> Ref<'_, i32> {
        self.n_vel.borrow()
    }
}

/**
 * Number of particle part names (0–8).
 */
impl PkoMagicSingle_EffParam {
    pub fn n_par_num(&self) -> Ref<'_, i32> {
        self.n_par_num.borrow()
    }
}

/**
 * Particle part names (8 slots × 24 bytes each).
 * Only the first n_par_num slots are meaningful.
 */
impl PkoMagicSingle_EffParam {
    pub fn str_part(&self) -> Ref<'_, Vec<String>> {
        self.str_part.borrow()
    }
}

/**
 * Dummy point indices (8 slots, -1 if unused).
 */
impl PkoMagicSingle_EffParam {
    pub fn n_dummy(&self) -> Ref<'_, Vec<i32>> {
        self.n_dummy.borrow()
    }
}

/**
 * Render mode index.
 */
impl PkoMagicSingle_EffParam {
    pub fn n_render_idx(&self) -> Ref<'_, i32> {
        self.n_render_idx.borrow()
    }
}

/**
 * Light ID reference.
 */
impl PkoMagicSingle_EffParam {
    pub fn n_light_id(&self) -> Ref<'_, i32> {
        self.n_light_id.borrow()
    }
}

/**
 * Result/hit effect name (null-terminated).
 */
impl PkoMagicSingle_EffParam {
    pub fn str_result(&self) -> Ref<'_, String> {
        self.str_result.borrow()
    }
}
impl PkoMagicSingle_EffParam {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
