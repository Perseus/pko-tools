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
use super::pko_lmo::PkoLmo_GeometryChunk;

/**
 * Direct lwGeomObjInfo container used by .lgo resources.
 * The layout is:
 *   - u32 version
 *   - lwGeomObjInfo payload (same body parser as geometry chunks in pko_lmo)
 */

#[derive(Default, Debug, Clone)]
pub struct PkoLgo {
    pub _root: SharedType<PkoLgo>,
    pub _parent: SharedType<PkoLgo>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    geometry: RefCell<OptRc<PkoLmo_GeometryChunk>>,
    _io: RefCell<BytesReader>,
    geometry_raw: RefCell<Vec<u8>>,
}
impl KStruct for PkoLgo {
    type Root = PkoLgo;
    type Parent = PkoLgo;

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
        *self_rc.geometry_raw.borrow_mut() = _io.read_bytes_full()?.into();
        let geometry_raw = self_rc.geometry_raw.borrow();
        let _t_geometry_raw_io = BytesReader::from(geometry_raw.clone());
        let f = |t : &mut PkoLmo_GeometryChunk| Ok(t.set_params((*self_rc.version()).try_into().map_err(|_| KError::CastError)?, (0).try_into().map_err(|_| KError::CastError)?));
        let t = Self::read_into_with_init::<BytesReader, PkoLmo_GeometryChunk>(&_t_geometry_raw_io, None, None, &f)?.into();
        *self_rc.geometry.borrow_mut() = t;
        Ok(())
    }
}
impl PkoLgo {
}
impl PkoLgo {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoLgo {
    pub fn geometry(&self) -> Ref<'_, OptRc<PkoLmo_GeometryChunk>> {
        self.geometry.borrow()
    }
}
impl PkoLgo {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
impl PkoLgo {
    pub fn geometry_raw(&self) -> Ref<'_, Vec<u8>> {
        self.geometry_raw.borrow()
    }
}
