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
 * Derived from MPMapData.cpp and MPMapDef.h.
 * Layout:
 * 1) MPMapFileHeader
 * 2) Section offset table (u4 * sectionCount)
 * 3) Section tile blobs referenced by offsets
 */

#[derive(Default, Debug, Clone)]
pub struct PkoMap {
    pub _root: SharedType<PkoMap>,
    pub _parent: SharedType<PkoMap>,
    pub _self: SharedType<Self>,
    header: RefCell<OptRc<PkoMap_MapHeader>>,
    section_index: RefCell<Vec<OptRc<PkoMap_SectionPtr>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoMap {
    type Root = PkoMap;
    type Parent = PkoMap;

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
        let t = Self::read_into::<_, PkoMap_MapHeader>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
        *self_rc.header.borrow_mut() = t;
        *self_rc.section_index.borrow_mut() = Vec::new();
        let l_section_index = ((((*self_rc.header().n_width() as i32) / (*self_rc.header().n_section_width() as i32)) as i32) * (((*self_rc.header().n_height() as i32) / (*self_rc.header().n_section_height() as i32)) as i32));
        for _i in 0..l_section_index {
            let f = |t : &mut PkoMap_SectionPtr| Ok(t.set_params((((*self_rc.header().n_section_width() as i32) * (*self_rc.header().n_section_height() as i32))).try_into().map_err(|_| KError::CastError)?, (*self_rc.header().n_map_flag()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoMap_SectionPtr>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.section_index.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoMap {
}
impl PkoMap {
    pub fn header(&self) -> Ref<'_, OptRc<PkoMap_MapHeader>> {
        self.header.borrow()
    }
}
impl PkoMap {
    pub fn section_index(&self) -> Ref<'_, Vec<OptRc<PkoMap_SectionPtr>>> {
        self.section_index.borrow()
    }
}
impl PkoMap {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoMap_MapHeader {
    pub _root: SharedType<PkoMap>,
    pub _parent: SharedType<PkoMap>,
    pub _self: SharedType<Self>,
    n_map_flag: RefCell<i32>,
    n_width: RefCell<i32>,
    n_height: RefCell<i32>,
    n_section_width: RefCell<i32>,
    n_section_height: RefCell<i32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoMap_MapHeader {
    type Root = PkoMap;
    type Parent = PkoMap;

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
        *self_rc.n_map_flag.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_width.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_height.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_section_width.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.n_section_height.borrow_mut() = _io.read_s4le()?.into();
        Ok(())
    }
}
impl PkoMap_MapHeader {
}
impl PkoMap_MapHeader {
    pub fn n_map_flag(&self) -> Ref<'_, i32> {
        self.n_map_flag.borrow()
    }
}
impl PkoMap_MapHeader {
    pub fn n_width(&self) -> Ref<'_, i32> {
        self.n_width.borrow()
    }
}
impl PkoMap_MapHeader {
    pub fn n_height(&self) -> Ref<'_, i32> {
        self.n_height.borrow()
    }
}
impl PkoMap_MapHeader {
    pub fn n_section_width(&self) -> Ref<'_, i32> {
        self.n_section_width.borrow()
    }
}
impl PkoMap_MapHeader {
    pub fn n_section_height(&self) -> Ref<'_, i32> {
        self.n_section_height.borrow()
    }
}
impl PkoMap_MapHeader {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoMap_SectionNew {
    pub _root: SharedType<PkoMap>,
    pub _parent: SharedType<PkoMap_SectionPtr>,
    pub _self: SharedType<Self>,
    tile_count: RefCell<i32>,
    tiles: RefCell<Vec<OptRc<PkoMap_TileNew>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoMap_SectionNew {
    type Root = PkoMap;
    type Parent = PkoMap_SectionPtr;

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
        *self_rc.tiles.borrow_mut() = Vec::new();
        let l_tiles = *self_rc.tile_count();
        for _i in 0..l_tiles {
            let t = Self::read_into::<_, PkoMap_TileNew>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.tiles.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoMap_SectionNew {
    pub fn tile_count(&self) -> Ref<'_, i32> {
        self.tile_count.borrow()
    }
}
impl PkoMap_SectionNew {
    pub fn set_params(&mut self, tile_count: i32) {
        *self.tile_count.borrow_mut() = tile_count;
    }
}
impl PkoMap_SectionNew {
}
impl PkoMap_SectionNew {
    pub fn tiles(&self) -> Ref<'_, Vec<OptRc<PkoMap_TileNew>>> {
        self.tiles.borrow()
    }
}
impl PkoMap_SectionNew {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoMap_SectionOld {
    pub _root: SharedType<PkoMap>,
    pub _parent: SharedType<PkoMap_SectionPtr>,
    pub _self: SharedType<Self>,
    tile_count: RefCell<i32>,
    tiles: RefCell<Vec<OptRc<PkoMap_TileOld>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoMap_SectionOld {
    type Root = PkoMap;
    type Parent = PkoMap_SectionPtr;

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
        *self_rc.tiles.borrow_mut() = Vec::new();
        let l_tiles = *self_rc.tile_count();
        for _i in 0..l_tiles {
            let t = Self::read_into::<_, PkoMap_TileOld>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.tiles.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoMap_SectionOld {
    pub fn tile_count(&self) -> Ref<'_, i32> {
        self.tile_count.borrow()
    }
}
impl PkoMap_SectionOld {
    pub fn set_params(&mut self, tile_count: i32) {
        *self.tile_count.borrow_mut() = tile_count;
    }
}
impl PkoMap_SectionOld {
}
impl PkoMap_SectionOld {
    pub fn tiles(&self) -> Ref<'_, Vec<OptRc<PkoMap_TileOld>>> {
        self.tiles.borrow()
    }
}
impl PkoMap_SectionOld {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoMap_SectionPtr {
    pub _root: SharedType<PkoMap>,
    pub _parent: SharedType<PkoMap>,
    pub _self: SharedType<Self>,
    tile_count: RefCell<i32>,
    map_flag: RefCell<i32>,
    offset: RefCell<u32>,
    _io: RefCell<BytesReader>,
    f_section: Cell<bool>,
    section: RefCell<Option<PkoMap_SectionPtr_Section>>,
}
#[derive(Debug, Clone)]
pub enum PkoMap_SectionPtr_Section {
    PkoMap_SectionOld(OptRc<PkoMap_SectionOld>),
    PkoMap_SectionNew(OptRc<PkoMap_SectionNew>),
}
impl From<&PkoMap_SectionPtr_Section> for OptRc<PkoMap_SectionOld> {
    fn from(v: &PkoMap_SectionPtr_Section) -> Self {
        if let PkoMap_SectionPtr_Section::PkoMap_SectionOld(x) = v {
            return x.clone();
        }
        panic!("expected PkoMap_SectionPtr_Section::PkoMap_SectionOld, got {:?}", v)
    }
}
impl From<OptRc<PkoMap_SectionOld>> for PkoMap_SectionPtr_Section {
    fn from(v: OptRc<PkoMap_SectionOld>) -> Self {
        Self::PkoMap_SectionOld(v)
    }
}
impl From<&PkoMap_SectionPtr_Section> for OptRc<PkoMap_SectionNew> {
    fn from(v: &PkoMap_SectionPtr_Section) -> Self {
        if let PkoMap_SectionPtr_Section::PkoMap_SectionNew(x) = v {
            return x.clone();
        }
        panic!("expected PkoMap_SectionPtr_Section::PkoMap_SectionNew, got {:?}", v)
    }
}
impl From<OptRc<PkoMap_SectionNew>> for PkoMap_SectionPtr_Section {
    fn from(v: OptRc<PkoMap_SectionNew>) -> Self {
        Self::PkoMap_SectionNew(v)
    }
}
impl KStruct for PkoMap_SectionPtr {
    type Root = PkoMap;
    type Parent = PkoMap;

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
        *self_rc.offset.borrow_mut() = _io.read_u4le()?.into();
        Ok(())
    }
}
impl PkoMap_SectionPtr {
    pub fn tile_count(&self) -> Ref<'_, i32> {
        self.tile_count.borrow()
    }
}
impl PkoMap_SectionPtr {
    pub fn map_flag(&self) -> Ref<'_, i32> {
        self.map_flag.borrow()
    }
}
impl PkoMap_SectionPtr {
    pub fn set_params(&mut self, tile_count: i32, map_flag: i32) {
        *self.tile_count.borrow_mut() = tile_count;
        *self.map_flag.borrow_mut() = map_flag;
    }
}
impl PkoMap_SectionPtr {
    pub fn section(
        &self
    ) -> KResult<Ref<'_, Option<PkoMap_SectionPtr_Section>>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_section.get() {
            return Ok(self.section.borrow());
        }
        self.f_section.set(true);
        if ((*self.offset() as u32) != (0 as u32)) {
            let io = Clone::clone(&*_r._io());
            let _pos = io.pos();
            io.seek(*self.offset() as usize)?;
            match *self.map_flag() {
                780626 => {
                    let f = |t : &mut PkoMap_SectionOld| Ok(t.set_params((*self.tile_count()).try_into().map_err(|_| KError::CastError)?));
                    let t = Self::read_into_with_init::<BytesReader, PkoMap_SectionOld>(&io, Some(self._root.clone()), Some(self._self.clone()), &f)?.into();
                    *self.section.borrow_mut() = Some(t);
                }
                780627 => {
                    let f = |t : &mut PkoMap_SectionNew| Ok(t.set_params((*self.tile_count()).try_into().map_err(|_| KError::CastError)?));
                    let t = Self::read_into_with_init::<BytesReader, PkoMap_SectionNew>(&io, Some(self._root.clone()), Some(self._self.clone()), &f)?.into();
                    *self.section.borrow_mut() = Some(t);
                }
                _ => {}
            }
            io.seek(_pos)?;
        }
        Ok(self.section.borrow())
    }
}
impl PkoMap_SectionPtr {
    pub fn offset(&self) -> Ref<'_, u32> {
        self.offset.borrow()
    }
}
impl PkoMap_SectionPtr {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoMap_TileNew {
    pub _root: SharedType<PkoMap>,
    pub _parent: SharedType<PkoMap_SectionNew>,
    pub _self: SharedType<Self>,
    dw_tile_info: RefCell<u32>,
    bt_tile_info: RefCell<u8>,
    s_color_565: RefCell<u16>,
    c_height: RefCell<i8>,
    s_region: RefCell<i16>,
    bt_island: RefCell<u8>,
    bt_block: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
    f_alpha0: Cell<bool>,
    alpha0: RefCell<i8>,
    f_alpha1: Cell<bool>,
    alpha1: RefCell<i32>,
    f_alpha2: Cell<bool>,
    alpha2: RefCell<i32>,
    f_alpha3: Cell<bool>,
    alpha3: RefCell<i32>,
    f_height_m: Cell<bool>,
    height_m: RefCell<f64>,
    f_tex0: Cell<bool>,
    tex0: RefCell<u8>,
    f_tex1: Cell<bool>,
    tex1: RefCell<i32>,
    f_tex2: Cell<bool>,
    tex2: RefCell<i32>,
    f_tex3: Cell<bool>,
    tex3: RefCell<i32>,
}
impl KStruct for PkoMap_TileNew {
    type Root = PkoMap;
    type Parent = PkoMap_SectionNew;

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
        *self_rc.dw_tile_info.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.bt_tile_info.borrow_mut() = _io.read_u1()?.into();
        *self_rc.s_color_565.borrow_mut() = _io.read_u2le()?.into();
        *self_rc.c_height.borrow_mut() = _io.read_s1()?.into();
        *self_rc.s_region.borrow_mut() = _io.read_s2le()?.into();
        *self_rc.bt_island.borrow_mut() = _io.read_u1()?.into();
        *self_rc.bt_block.borrow_mut() = Vec::new();
        let l_bt_block = 4;
        for _i in 0..l_bt_block {
            self_rc.bt_block.borrow_mut().push(_io.read_u1()?.into());
        }
        Ok(())
    }
}
impl PkoMap_TileNew {
    pub fn alpha0(
        &self
    ) -> KResult<Ref<'_, i8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha0.get() {
            return Ok(self.alpha0.borrow());
        }
        self.f_alpha0.set(true);
        *self.alpha0.borrow_mut() = (15) as i8;
        Ok(self.alpha0.borrow())
    }
    pub fn alpha1(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha1.get() {
            return Ok(self.alpha1.borrow());
        }
        self.f_alpha1.set(true);
        *self.alpha1.borrow_mut() = (((((*self.dw_tile_info() as u32) >> (22 as u32)) as i32) & (15 as i32))) as i32;
        Ok(self.alpha1.borrow())
    }
    pub fn alpha2(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha2.get() {
            return Ok(self.alpha2.borrow());
        }
        self.f_alpha2.set(true);
        *self.alpha2.borrow_mut() = (((((*self.dw_tile_info() as u32) >> (12 as u32)) as i32) & (15 as i32))) as i32;
        Ok(self.alpha2.borrow())
    }
    pub fn alpha3(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha3.get() {
            return Ok(self.alpha3.borrow());
        }
        self.f_alpha3.set(true);
        *self.alpha3.borrow_mut() = (((((*self.dw_tile_info() as u32) >> (2 as u32)) as i32) & (15 as i32))) as i32;
        Ok(self.alpha3.borrow())
    }
    pub fn height_m(
        &self
    ) -> KResult<Ref<'_, f64>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_height_m.get() {
            return Ok(self.height_m.borrow());
        }
        self.f_height_m.set(true);
        *self.height_m.borrow_mut() = (((*self.c_height() as f64) * (0.1 as f64))) as f64;
        Ok(self.height_m.borrow())
    }
    pub fn tex0(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex0.get() {
            return Ok(self.tex0.borrow());
        }
        self.f_tex0.set(true);
        *self.tex0.borrow_mut() = (*self.bt_tile_info()) as u8;
        Ok(self.tex0.borrow())
    }
    pub fn tex1(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex1.get() {
            return Ok(self.tex1.borrow());
        }
        self.f_tex1.set(true);
        *self.tex1.borrow_mut() = (((((*self.dw_tile_info() as u32) >> (26 as u32)) as i32) & (63 as i32))) as i32;
        Ok(self.tex1.borrow())
    }
    pub fn tex2(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex2.get() {
            return Ok(self.tex2.borrow());
        }
        self.f_tex2.set(true);
        *self.tex2.borrow_mut() = (((((*self.dw_tile_info() as u32) >> (16 as u32)) as i32) & (63 as i32))) as i32;
        Ok(self.tex2.borrow())
    }
    pub fn tex3(
        &self
    ) -> KResult<Ref<'_, i32>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex3.get() {
            return Ok(self.tex3.borrow());
        }
        self.f_tex3.set(true);
        *self.tex3.borrow_mut() = (((((*self.dw_tile_info() as u32) >> (6 as u32)) as i32) & (63 as i32))) as i32;
        Ok(self.tex3.borrow())
    }
}
impl PkoMap_TileNew {
    pub fn dw_tile_info(&self) -> Ref<'_, u32> {
        self.dw_tile_info.borrow()
    }
}
impl PkoMap_TileNew {
    pub fn bt_tile_info(&self) -> Ref<'_, u8> {
        self.bt_tile_info.borrow()
    }
}
impl PkoMap_TileNew {
    pub fn s_color_565(&self) -> Ref<'_, u16> {
        self.s_color_565.borrow()
    }
}
impl PkoMap_TileNew {
    pub fn c_height(&self) -> Ref<'_, i8> {
        self.c_height.borrow()
    }
}
impl PkoMap_TileNew {
    pub fn s_region(&self) -> Ref<'_, i16> {
        self.s_region.borrow()
    }
}
impl PkoMap_TileNew {
    pub fn bt_island(&self) -> Ref<'_, u8> {
        self.bt_island.borrow()
    }
}
impl PkoMap_TileNew {
    pub fn bt_block(&self) -> Ref<'_, Vec<u8>> {
        self.bt_block.borrow()
    }
}
impl PkoMap_TileNew {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoMap_TileOld {
    pub _root: SharedType<PkoMap>,
    pub _parent: SharedType<PkoMap_SectionOld>,
    pub _self: SharedType<Self>,
    t: RefCell<Vec<u8>>,
    s_height: RefCell<i16>,
    dw_color: RefCell<u32>,
    s_region: RefCell<i16>,
    bt_island: RefCell<u8>,
    bt_block: RefCell<Vec<u8>>,
    _io: RefCell<BytesReader>,
    f_alpha0: Cell<bool>,
    alpha0: RefCell<u8>,
    f_alpha1: Cell<bool>,
    alpha1: RefCell<u8>,
    f_alpha2: Cell<bool>,
    alpha2: RefCell<u8>,
    f_alpha3: Cell<bool>,
    alpha3: RefCell<u8>,
    f_height_m: Cell<bool>,
    height_m: RefCell<f64>,
    f_tex0: Cell<bool>,
    tex0: RefCell<u8>,
    f_tex1: Cell<bool>,
    tex1: RefCell<u8>,
    f_tex2: Cell<bool>,
    tex2: RefCell<u8>,
    f_tex3: Cell<bool>,
    tex3: RefCell<u8>,
}
impl KStruct for PkoMap_TileOld {
    type Root = PkoMap;
    type Parent = PkoMap_SectionOld;

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
        *self_rc.t.borrow_mut() = Vec::new();
        let l_t = 8;
        for _i in 0..l_t {
            self_rc.t.borrow_mut().push(_io.read_u1()?.into());
        }
        *self_rc.s_height.borrow_mut() = _io.read_s2le()?.into();
        *self_rc.dw_color.borrow_mut() = _io.read_u4le()?.into();
        *self_rc.s_region.borrow_mut() = _io.read_s2le()?.into();
        *self_rc.bt_island.borrow_mut() = _io.read_u1()?.into();
        *self_rc.bt_block.borrow_mut() = Vec::new();
        let l_bt_block = 4;
        for _i in 0..l_bt_block {
            self_rc.bt_block.borrow_mut().push(_io.read_u1()?.into());
        }
        Ok(())
    }
}
impl PkoMap_TileOld {
    pub fn alpha0(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha0.get() {
            return Ok(self.alpha0.borrow());
        }
        self.f_alpha0.set(true);
        *self.alpha0.borrow_mut() = (self.t()[1 as usize]) as u8;
        Ok(self.alpha0.borrow())
    }
    pub fn alpha1(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha1.get() {
            return Ok(self.alpha1.borrow());
        }
        self.f_alpha1.set(true);
        *self.alpha1.borrow_mut() = (self.t()[3 as usize]) as u8;
        Ok(self.alpha1.borrow())
    }
    pub fn alpha2(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha2.get() {
            return Ok(self.alpha2.borrow());
        }
        self.f_alpha2.set(true);
        *self.alpha2.borrow_mut() = (self.t()[5 as usize]) as u8;
        Ok(self.alpha2.borrow())
    }
    pub fn alpha3(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_alpha3.get() {
            return Ok(self.alpha3.borrow());
        }
        self.f_alpha3.set(true);
        *self.alpha3.borrow_mut() = (self.t()[7 as usize]) as u8;
        Ok(self.alpha3.borrow())
    }
    pub fn height_m(
        &self
    ) -> KResult<Ref<'_, f64>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_height_m.get() {
            return Ok(self.height_m.borrow());
        }
        self.f_height_m.set(true);
        *self.height_m.borrow_mut() = (((*self.s_height() as f64) / (100.0 as f64))) as f64;
        Ok(self.height_m.borrow())
    }
    pub fn tex0(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex0.get() {
            return Ok(self.tex0.borrow());
        }
        self.f_tex0.set(true);
        *self.tex0.borrow_mut() = (self.t()[0 as usize]) as u8;
        Ok(self.tex0.borrow())
    }
    pub fn tex1(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex1.get() {
            return Ok(self.tex1.borrow());
        }
        self.f_tex1.set(true);
        *self.tex1.borrow_mut() = (self.t()[2 as usize]) as u8;
        Ok(self.tex1.borrow())
    }
    pub fn tex2(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex2.get() {
            return Ok(self.tex2.borrow());
        }
        self.f_tex2.set(true);
        *self.tex2.borrow_mut() = (self.t()[4 as usize]) as u8;
        Ok(self.tex2.borrow())
    }
    pub fn tex3(
        &self
    ) -> KResult<Ref<'_, u8>> {
        let _io = self._io.borrow();
        let _rrc = self._root.get_value().borrow().upgrade();
        let _prc = self._parent.get_value().borrow().upgrade();
        let _r = _rrc.as_ref().unwrap();
        if self.f_tex3.get() {
            return Ok(self.tex3.borrow());
        }
        self.f_tex3.set(true);
        *self.tex3.borrow_mut() = (self.t()[6 as usize]) as u8;
        Ok(self.tex3.borrow())
    }
}
impl PkoMap_TileOld {
    pub fn t(&self) -> Ref<'_, Vec<u8>> {
        self.t.borrow()
    }
}
impl PkoMap_TileOld {
    pub fn s_height(&self) -> Ref<'_, i16> {
        self.s_height.borrow()
    }
}
impl PkoMap_TileOld {
    pub fn dw_color(&self) -> Ref<'_, u32> {
        self.dw_color.borrow()
    }
}
impl PkoMap_TileOld {
    pub fn s_region(&self) -> Ref<'_, i16> {
        self.s_region.borrow()
    }
}
impl PkoMap_TileOld {
    pub fn bt_island(&self) -> Ref<'_, u8> {
        self.bt_island.borrow()
    }
}
impl PkoMap_TileOld {
    pub fn bt_block(&self) -> Ref<'_, Vec<u8>> {
        self.bt_block.borrow()
    }
}
impl PkoMap_TileOld {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
