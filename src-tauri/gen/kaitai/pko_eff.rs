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
 * Binary model-effect format loaded by CMPResManger::LoadEffectFromFile and
 * I_Effect::LoadFromFile in the PKO client engine.
 */

#[derive(Default, Debug, Clone)]
pub struct PkoEff {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<PkoEff>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    idx_tech: RefCell<i32>,
    use_path: RefCell<u8>,
    path_name: RefCell<String>,
    use_sound: RefCell<u8>,
    sound_name: RefCell<String>,
    rotating: RefCell<u8>,
    rota_axis: RefCell<OptRc<PkoEff_Vec3>>,
    rota_vel: RefCell<f32>,
    effect_count: RefCell<i32>,
    effects: RefCell<Vec<OptRc<PkoEff_Effect>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff {
    type Root = PkoEff;
    type Parent = PkoEff;

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
        *self_rc.idx_tech.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.use_path.borrow_mut() = _io.read_u1()?.into();
        *self_rc.path_name.borrow_mut() = bytes_to_str(&_io.read_bytes(32 as usize)?.into(), "ASCII")?;
        *self_rc.use_sound.borrow_mut() = _io.read_u1()?.into();
        *self_rc.sound_name.borrow_mut() = bytes_to_str(&_io.read_bytes(32 as usize)?.into(), "ASCII")?;
        *self_rc.rotating.borrow_mut() = _io.read_u1()?.into();
        let t = Self::read_into::<_, PkoEff_Vec3>(&*_io, Some(self_rc._root.clone()), None)?.into();
        *self_rc.rota_axis.borrow_mut() = t;
        *self_rc.rota_vel.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.effect_count.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.effects.borrow_mut() = Vec::new();
        let l_effects = *self_rc.effect_count();
        for _i in 0..l_effects {
            let f = |t : &mut PkoEff_Effect| Ok(t.set_params((*self_rc.version()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoEff_Effect>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.effects.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoEff {
}
impl PkoEff {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoEff {
    pub fn idx_tech(&self) -> Ref<'_, i32> {
        self.idx_tech.borrow()
    }
}
impl PkoEff {
    pub fn use_path(&self) -> Ref<'_, u8> {
        self.use_path.borrow()
    }
}
impl PkoEff {
    pub fn path_name(&self) -> Ref<'_, String> {
        self.path_name.borrow()
    }
}
impl PkoEff {
    pub fn use_sound(&self) -> Ref<'_, u8> {
        self.use_sound.borrow()
    }
}
impl PkoEff {
    pub fn sound_name(&self) -> Ref<'_, String> {
        self.sound_name.borrow()
    }
}
impl PkoEff {
    pub fn rotating(&self) -> Ref<'_, u8> {
        self.rotating.borrow()
    }
}
impl PkoEff {
    pub fn rota_axis(&self) -> Ref<'_, OptRc<PkoEff_Vec3>> {
        self.rota_axis.borrow()
    }
}
impl PkoEff {
    pub fn rota_vel(&self) -> Ref<'_, f32> {
        self.rota_vel.borrow()
    }
}
impl PkoEff {
    pub fn effect_count(&self) -> Ref<'_, i32> {
        self.effect_count.borrow()
    }
}
impl PkoEff {
    pub fn effects(&self) -> Ref<'_, Vec<OptRc<PkoEff_Effect>>> {
        self.effects.borrow()
    }
}
impl PkoEff {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_Color4f {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<PkoEff_Effect>,
    pub _self: SharedType<Self>,
    r: RefCell<f32>,
    g: RefCell<f32>,
    b: RefCell<f32>,
    a: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_Color4f {
    type Root = PkoEff;
    type Parent = PkoEff_Effect;

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
impl PkoEff_Color4f {
}
impl PkoEff_Color4f {
    pub fn r(&self) -> Ref<'_, f32> {
        self.r.borrow()
    }
}
impl PkoEff_Color4f {
    pub fn g(&self) -> Ref<'_, f32> {
        self.g.borrow()
    }
}
impl PkoEff_Color4f {
    pub fn b(&self) -> Ref<'_, f32> {
        self.b.borrow()
    }
}
impl PkoEff_Color4f {
    pub fn a(&self) -> Ref<'_, f32> {
        self.a.borrow()
    }
}
impl PkoEff_Color4f {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_CylinderParam {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<PkoEff_Effect>,
    pub _self: SharedType<Self>,
    segments: RefCell<i32>,
    hei: RefCell<f32>,
    top_radius: RefCell<f32>,
    bottom_radius: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_CylinderParam {
    type Root = PkoEff;
    type Parent = PkoEff_Effect;

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
        *self_rc.segments.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.hei.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.top_radius.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.bottom_radius.borrow_mut() = _io.read_f4le()?.into();
        Ok(())
    }
}
impl PkoEff_CylinderParam {
}
impl PkoEff_CylinderParam {
    pub fn segments(&self) -> Ref<'_, i32> {
        self.segments.borrow()
    }
}
impl PkoEff_CylinderParam {
    pub fn hei(&self) -> Ref<'_, f32> {
        self.hei.borrow()
    }
}
impl PkoEff_CylinderParam {
    pub fn top_radius(&self) -> Ref<'_, f32> {
        self.top_radius.borrow()
    }
}
impl PkoEff_CylinderParam {
    pub fn bottom_radius(&self) -> Ref<'_, f32> {
        self.bottom_radius.borrow()
    }
}
impl PkoEff_CylinderParam {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_Effect {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<PkoEff>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    effect_name: RefCell<String>,
    effect_type: RefCell<i32>,
    src_blend: RefCell<i32>,
    dest_blend: RefCell<i32>,
    length: RefCell<f32>,
    frame_count: RefCell<u16>,
    frame_time: RefCell<Vec<f32>>,
    frame_size: RefCell<Vec<OptRc<PkoEff_Vec3>>>,
    frame_angle: RefCell<Vec<OptRc<PkoEff_Vec3>>>,
    frame_pos: RefCell<Vec<OptRc<PkoEff_Vec3>>>,
    frame_color: RefCell<Vec<OptRc<PkoEff_Color4f>>>,
    texcoord_ver_count: RefCell<u16>,
    texcoord_coord_count: RefCell<u16>,
    texcoord_frame_time: RefCell<f32>,
    texcoord_lists: RefCell<Vec<OptRc<PkoEff_TexcoordCoordSet>>>,
    tex_count: RefCell<u16>,
    tex_frame_time: RefCell<f32>,
    tex_name: RefCell<String>,
    tex_lists: RefCell<Vec<OptRc<PkoEff_TexListEntry>>>,
    model_name: RefCell<String>,
    billboard: RefCell<u8>,
    vs_index: RefCell<i32>,
    n_segments: RefCell<i32>,
    r_height: RefCell<f32>,
    r_radius: RefCell<f32>,
    r_bot_radius: RefCell<f32>,
    texframe_count: RefCell<u16>,
    texframe_time_a: RefCell<f32>,
    texframe_names: RefCell<Vec<String>>,
    texframe_time_b: RefCell<f32>,
    use_param: RefCell<i32>,
    cylinder_params: RefCell<Vec<OptRc<PkoEff_CylinderParam>>>,
    rota_loop: RefCell<u8>,
    rota_loop_v: RefCell<OptRc<PkoEff_Vec4>>,
    alpha: RefCell<u8>,
    rota_board: RefCell<u8>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_Effect {
    type Root = PkoEff;
    type Parent = PkoEff;

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
        *self_rc.effect_name.borrow_mut() = bytes_to_str(&_io.read_bytes(32 as usize)?.into(), "ASCII")?;
        *self_rc.effect_type.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.src_blend.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.dest_blend.borrow_mut() = _io.read_s4le()?.into();
        *self_rc.length.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.frame_count.borrow_mut() = _io.read_u2le()?.into();
        *self_rc.frame_time.borrow_mut() = Vec::new();
        let l_frame_time = *self_rc.frame_count();
        for _i in 0..l_frame_time {
            self_rc.frame_time.borrow_mut().push(_io.read_f4le()?.into());
        }
        *self_rc.frame_size.borrow_mut() = Vec::new();
        let l_frame_size = *self_rc.frame_count();
        for _i in 0..l_frame_size {
            let t = Self::read_into::<_, PkoEff_Vec3>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.frame_size.borrow_mut().push(t);
        }
        *self_rc.frame_angle.borrow_mut() = Vec::new();
        let l_frame_angle = *self_rc.frame_count();
        for _i in 0..l_frame_angle {
            let t = Self::read_into::<_, PkoEff_Vec3>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.frame_angle.borrow_mut().push(t);
        }
        *self_rc.frame_pos.borrow_mut() = Vec::new();
        let l_frame_pos = *self_rc.frame_count();
        for _i in 0..l_frame_pos {
            let t = Self::read_into::<_, PkoEff_Vec3>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.frame_pos.borrow_mut().push(t);
        }
        *self_rc.frame_color.borrow_mut() = Vec::new();
        let l_frame_color = *self_rc.frame_count();
        for _i in 0..l_frame_color {
            let t = Self::read_into::<_, PkoEff_Color4f>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            self_rc.frame_color.borrow_mut().push(t);
        }
        *self_rc.texcoord_ver_count.borrow_mut() = _io.read_u2le()?.into();
        *self_rc.texcoord_coord_count.borrow_mut() = _io.read_u2le()?.into();
        *self_rc.texcoord_frame_time.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.texcoord_lists.borrow_mut() = Vec::new();
        let l_texcoord_lists = *self_rc.texcoord_coord_count();
        for _i in 0..l_texcoord_lists {
            let f = |t : &mut PkoEff_TexcoordCoordSet| Ok(t.set_params((*self_rc.texcoord_ver_count()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoEff_TexcoordCoordSet>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.texcoord_lists.borrow_mut().push(t);
        }
        *self_rc.tex_count.borrow_mut() = _io.read_u2le()?.into();
        *self_rc.tex_frame_time.borrow_mut() = _io.read_f4le()?.into();
        *self_rc.tex_name.borrow_mut() = bytes_to_str(&_io.read_bytes(32 as usize)?.into(), "ASCII")?;
        *self_rc.tex_lists.borrow_mut() = Vec::new();
        let l_tex_lists = *self_rc.tex_count();
        for _i in 0..l_tex_lists {
            let f = |t : &mut PkoEff_TexListEntry| Ok(t.set_params((*self_rc.texcoord_ver_count()).try_into().map_err(|_| KError::CastError)?));
            let t = Self::read_into_with_init::<_, PkoEff_TexListEntry>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()), &f)?.into();
            self_rc.tex_lists.borrow_mut().push(t);
        }
        *self_rc.model_name.borrow_mut() = bytes_to_str(&_io.read_bytes(32 as usize)?.into(), "ASCII")?;
        *self_rc.billboard.borrow_mut() = _io.read_u1()?.into();
        *self_rc.vs_index.borrow_mut() = _io.read_s4le()?.into();
        if ((*self_rc.version() as u32) > (1 as u32)) {
            *self_rc.n_segments.borrow_mut() = _io.read_s4le()?.into();
        }
        if ((*self_rc.version() as u32) > (1 as u32)) {
            *self_rc.r_height.borrow_mut() = _io.read_f4le()?.into();
        }
        if ((*self_rc.version() as u32) > (1 as u32)) {
            *self_rc.r_radius.borrow_mut() = _io.read_f4le()?.into();
        }
        if ((*self_rc.version() as u32) > (1 as u32)) {
            *self_rc.r_bot_radius.borrow_mut() = _io.read_f4le()?.into();
        }
        if ((*self_rc.version() as u32) > (2 as u32)) {
            *self_rc.texframe_count.borrow_mut() = _io.read_u2le()?.into();
        }
        if ((*self_rc.version() as u32) > (2 as u32)) {
            *self_rc.texframe_time_a.borrow_mut() = _io.read_f4le()?.into();
        }
        if ((*self_rc.version() as u32) > (2 as u32)) {
            *self_rc.texframe_names.borrow_mut() = Vec::new();
            let l_texframe_names = *self_rc.texframe_count();
            for _i in 0..l_texframe_names {
                self_rc.texframe_names.borrow_mut().push(bytes_to_str(&_io.read_bytes(32 as usize)?.into(), "ASCII")?);
            }
        }
        if ((*self_rc.version() as u32) > (2 as u32)) {
            *self_rc.texframe_time_b.borrow_mut() = _io.read_f4le()?.into();
        }
        if ((*self_rc.version() as u32) > (3 as u32)) {
            *self_rc.use_param.borrow_mut() = _io.read_s4le()?.into();
        }
        if  ((((*self_rc.version() as u32) > (3 as u32))) && (((*self_rc.use_param() as i32) > (0 as i32))))  {
            *self_rc.cylinder_params.borrow_mut() = Vec::new();
            let l_cylinder_params = *self_rc.frame_count();
            for _i in 0..l_cylinder_params {
                let t = Self::read_into::<_, PkoEff_CylinderParam>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
                self_rc.cylinder_params.borrow_mut().push(t);
            }
        }
        if ((*self_rc.version() as u32) > (4 as u32)) {
            *self_rc.rota_loop.borrow_mut() = _io.read_u1()?.into();
        }
        if ((*self_rc.version() as u32) > (4 as u32)) {
            let t = Self::read_into::<_, PkoEff_Vec4>(&*_io, Some(self_rc._root.clone()), Some(self_rc._self.clone()))?.into();
            *self_rc.rota_loop_v.borrow_mut() = t;
        }
        if ((*self_rc.version() as u32) > (5 as u32)) {
            *self_rc.alpha.borrow_mut() = _io.read_u1()?.into();
        }
        if ((*self_rc.version() as u32) > (6 as u32)) {
            *self_rc.rota_board.borrow_mut() = _io.read_u1()?.into();
        }
        Ok(())
    }
}
impl PkoEff_Effect {
    pub fn version(&self) -> Ref<'_, u32> {
        self.version.borrow()
    }
}
impl PkoEff_Effect {
    pub fn set_params(&mut self, version: u32) {
        *self.version.borrow_mut() = version;
    }
}
impl PkoEff_Effect {
}
impl PkoEff_Effect {
    pub fn effect_name(&self) -> Ref<'_, String> {
        self.effect_name.borrow()
    }
}
impl PkoEff_Effect {
    pub fn effect_type(&self) -> Ref<'_, i32> {
        self.effect_type.borrow()
    }
}
impl PkoEff_Effect {
    pub fn src_blend(&self) -> Ref<'_, i32> {
        self.src_blend.borrow()
    }
}
impl PkoEff_Effect {
    pub fn dest_blend(&self) -> Ref<'_, i32> {
        self.dest_blend.borrow()
    }
}
impl PkoEff_Effect {
    pub fn length(&self) -> Ref<'_, f32> {
        self.length.borrow()
    }
}
impl PkoEff_Effect {
    pub fn frame_count(&self) -> Ref<'_, u16> {
        self.frame_count.borrow()
    }
}
impl PkoEff_Effect {
    pub fn frame_time(&self) -> Ref<'_, Vec<f32>> {
        self.frame_time.borrow()
    }
}
impl PkoEff_Effect {
    pub fn frame_size(&self) -> Ref<'_, Vec<OptRc<PkoEff_Vec3>>> {
        self.frame_size.borrow()
    }
}
impl PkoEff_Effect {
    pub fn frame_angle(&self) -> Ref<'_, Vec<OptRc<PkoEff_Vec3>>> {
        self.frame_angle.borrow()
    }
}
impl PkoEff_Effect {
    pub fn frame_pos(&self) -> Ref<'_, Vec<OptRc<PkoEff_Vec3>>> {
        self.frame_pos.borrow()
    }
}
impl PkoEff_Effect {
    pub fn frame_color(&self) -> Ref<'_, Vec<OptRc<PkoEff_Color4f>>> {
        self.frame_color.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texcoord_ver_count(&self) -> Ref<'_, u16> {
        self.texcoord_ver_count.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texcoord_coord_count(&self) -> Ref<'_, u16> {
        self.texcoord_coord_count.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texcoord_frame_time(&self) -> Ref<'_, f32> {
        self.texcoord_frame_time.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texcoord_lists(&self) -> Ref<'_, Vec<OptRc<PkoEff_TexcoordCoordSet>>> {
        self.texcoord_lists.borrow()
    }
}
impl PkoEff_Effect {
    pub fn tex_count(&self) -> Ref<'_, u16> {
        self.tex_count.borrow()
    }
}
impl PkoEff_Effect {
    pub fn tex_frame_time(&self) -> Ref<'_, f32> {
        self.tex_frame_time.borrow()
    }
}
impl PkoEff_Effect {
    pub fn tex_name(&self) -> Ref<'_, String> {
        self.tex_name.borrow()
    }
}
impl PkoEff_Effect {
    pub fn tex_lists(&self) -> Ref<'_, Vec<OptRc<PkoEff_TexListEntry>>> {
        self.tex_lists.borrow()
    }
}
impl PkoEff_Effect {
    pub fn model_name(&self) -> Ref<'_, String> {
        self.model_name.borrow()
    }
}
impl PkoEff_Effect {
    pub fn billboard(&self) -> Ref<'_, u8> {
        self.billboard.borrow()
    }
}
impl PkoEff_Effect {
    pub fn vs_index(&self) -> Ref<'_, i32> {
        self.vs_index.borrow()
    }
}
impl PkoEff_Effect {
    pub fn n_segments(&self) -> Ref<'_, i32> {
        self.n_segments.borrow()
    }
}
impl PkoEff_Effect {
    pub fn r_height(&self) -> Ref<'_, f32> {
        self.r_height.borrow()
    }
}
impl PkoEff_Effect {
    pub fn r_radius(&self) -> Ref<'_, f32> {
        self.r_radius.borrow()
    }
}
impl PkoEff_Effect {
    pub fn r_bot_radius(&self) -> Ref<'_, f32> {
        self.r_bot_radius.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texframe_count(&self) -> Ref<'_, u16> {
        self.texframe_count.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texframe_time_a(&self) -> Ref<'_, f32> {
        self.texframe_time_a.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texframe_names(&self) -> Ref<'_, Vec<String>> {
        self.texframe_names.borrow()
    }
}
impl PkoEff_Effect {
    pub fn texframe_time_b(&self) -> Ref<'_, f32> {
        self.texframe_time_b.borrow()
    }
}
impl PkoEff_Effect {
    pub fn use_param(&self) -> Ref<'_, i32> {
        self.use_param.borrow()
    }
}
impl PkoEff_Effect {
    pub fn cylinder_params(&self) -> Ref<'_, Vec<OptRc<PkoEff_CylinderParam>>> {
        self.cylinder_params.borrow()
    }
}
impl PkoEff_Effect {
    pub fn rota_loop(&self) -> Ref<'_, u8> {
        self.rota_loop.borrow()
    }
}
impl PkoEff_Effect {
    pub fn rota_loop_v(&self) -> Ref<'_, OptRc<PkoEff_Vec4>> {
        self.rota_loop_v.borrow()
    }
}
impl PkoEff_Effect {
    pub fn alpha(&self) -> Ref<'_, u8> {
        self.alpha.borrow()
    }
}
impl PkoEff_Effect {
    pub fn rota_board(&self) -> Ref<'_, u8> {
        self.rota_board.borrow()
    }
}
impl PkoEff_Effect {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_TexListEntry {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<PkoEff_Effect>,
    pub _self: SharedType<Self>,
    ver_count: RefCell<u16>,
    coords: RefCell<Vec<OptRc<PkoEff_Vec2>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_TexListEntry {
    type Root = PkoEff;
    type Parent = PkoEff_Effect;

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
        *self_rc.coords.borrow_mut() = Vec::new();
        let l_coords = *self_rc.ver_count();
        for _i in 0..l_coords {
            let t = Self::read_into::<_, PkoEff_Vec2>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.coords.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoEff_TexListEntry {
    pub fn ver_count(&self) -> Ref<'_, u16> {
        self.ver_count.borrow()
    }
}
impl PkoEff_TexListEntry {
    pub fn set_params(&mut self, ver_count: u16) {
        *self.ver_count.borrow_mut() = ver_count;
    }
}
impl PkoEff_TexListEntry {
}
impl PkoEff_TexListEntry {
    pub fn coords(&self) -> Ref<'_, Vec<OptRc<PkoEff_Vec2>>> {
        self.coords.borrow()
    }
}
impl PkoEff_TexListEntry {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_TexcoordCoordSet {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<PkoEff_Effect>,
    pub _self: SharedType<Self>,
    ver_count: RefCell<u16>,
    coords: RefCell<Vec<OptRc<PkoEff_Vec2>>>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_TexcoordCoordSet {
    type Root = PkoEff;
    type Parent = PkoEff_Effect;

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
        *self_rc.coords.borrow_mut() = Vec::new();
        let l_coords = *self_rc.ver_count();
        for _i in 0..l_coords {
            let t = Self::read_into::<_, PkoEff_Vec2>(&*_io, Some(self_rc._root.clone()), None)?.into();
            self_rc.coords.borrow_mut().push(t);
        }
        Ok(())
    }
}
impl PkoEff_TexcoordCoordSet {
    pub fn ver_count(&self) -> Ref<'_, u16> {
        self.ver_count.borrow()
    }
}
impl PkoEff_TexcoordCoordSet {
    pub fn set_params(&mut self, ver_count: u16) {
        *self.ver_count.borrow_mut() = ver_count;
    }
}
impl PkoEff_TexcoordCoordSet {
}
impl PkoEff_TexcoordCoordSet {
    pub fn coords(&self) -> Ref<'_, Vec<OptRc<PkoEff_Vec2>>> {
        self.coords.borrow()
    }
}
impl PkoEff_TexcoordCoordSet {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_Vec2 {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_Vec2 {
    type Root = PkoEff;
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
        Ok(())
    }
}
impl PkoEff_Vec2 {
}
impl PkoEff_Vec2 {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoEff_Vec2 {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoEff_Vec2 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_Vec3 {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<KStructUnit>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    z: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_Vec3 {
    type Root = PkoEff;
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
impl PkoEff_Vec3 {
}
impl PkoEff_Vec3 {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoEff_Vec3 {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoEff_Vec3 {
    pub fn z(&self) -> Ref<'_, f32> {
        self.z.borrow()
    }
}
impl PkoEff_Vec3 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}

#[derive(Default, Debug, Clone)]
pub struct PkoEff_Vec4 {
    pub _root: SharedType<PkoEff>,
    pub _parent: SharedType<PkoEff_Effect>,
    pub _self: SharedType<Self>,
    x: RefCell<f32>,
    y: RefCell<f32>,
    z: RefCell<f32>,
    w: RefCell<f32>,
    _io: RefCell<BytesReader>,
}
impl KStruct for PkoEff_Vec4 {
    type Root = PkoEff;
    type Parent = PkoEff_Effect;

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
impl PkoEff_Vec4 {
}
impl PkoEff_Vec4 {
    pub fn x(&self) -> Ref<'_, f32> {
        self.x.borrow()
    }
}
impl PkoEff_Vec4 {
    pub fn y(&self) -> Ref<'_, f32> {
        self.y.borrow()
    }
}
impl PkoEff_Vec4 {
    pub fn z(&self) -> Ref<'_, f32> {
        self.z.borrow()
    }
}
impl PkoEff_Vec4 {
    pub fn w(&self) -> Ref<'_, f32> {
        self.w.borrow()
    }
}
impl PkoEff_Vec4 {
    pub fn _io(&self) -> Ref<'_, BytesReader> {
        self._io.borrow()
    }
}
