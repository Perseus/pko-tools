use base64::prelude::*;
use cgmath::{InnerSpace, Matrix3, Matrix4, Quaternion, SquareMatrix, Vector3};
use gltf::{
    animation::Property,
    buffer, image,
    json::{
        self,
        accessor::{ComponentType, GenericComponentType, Type},
        animation::{Channel, Sampler, Target},
        scene::UnitQuaternion,
        validation::{self, Checked, USize64},
        Accessor, Animation, Buffer, Index, Node, Skin,
    },
    Document,
};
use ptree::{print_tree, TreeBuilder};
use serde_json::{json, value::RawValue};
use core::f32;
use std::{
    collections::HashMap, fs::File, path::PathBuf, sync::Mutex,
};

#[derive(Debug, Clone)]
struct MinimalBone {
    id: u32,
    name: String,
    original_idx: usize,
    children: Vec<u32>,
    parent_id: u32,
    _type: u8,
}

use binrw::{binrw, BinRead, BinResult, BinWrite, VecArgs};
use std::io::{Read, Seek};

use crate::{broadcast::BroadcastMessage, character::GLTFFieldsToAggregate, math::{self, matrix4_to_quaternion, LwMatrix43, LwMatrix44, LwQuaternion, LwVector3}};

// Constants
pub const LW_MAX_NAME: usize = 64;
pub const LW_INVALID_INDEX: u32 = 0xFFFFFFFF; // Example sentinel

// Example key_type constants
pub const BONE_KEY_TYPE_MAT43: u32 = 1;
pub const BONE_KEY_TYPE_MAT44: u32 = 2;
pub const BONE_KEY_TYPE_QUAT: u32 = 3;

// Animation resampling constants
const TARGET_FPS: f32 = 30.0;
const FRAME_DURATION: f32 = 1.0 / TARGET_FPS;

/// Represents a single keyframe with its time and value
#[derive(Debug, Clone)]
struct Keyframe<T: Clone> {
    time: f32,
    value: T,
    /// For CUBICSPLINE: (in_tangent, out_tangent)
    tangents: Option<(T, T)>,
}

/// Raw animation channel data extracted from glTF
#[derive(Debug, Clone)]
struct AnimationChannelData<T: Clone> {
    keyframes: Vec<Keyframe<T>>,
    interpolation: gltf::animation::Interpolation,
}

/// Per-bone animation data before resampling
#[derive(Debug, Clone)]
struct BoneAnimationData {
    translation: Option<AnimationChannelData<LwVector3>>,
    rotation: Option<AnimationChannelData<LwQuaternion>>,
}

#[binrw]
#[derive(Debug, Clone, Default)]
#[br(little)]
#[bw(little)]
pub struct LwBoneInfoHeader {
    pub bone_num: u32,
    pub frame_num: u32,
    pub dummy_num: u32,
    pub key_type: u32,
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwBoneBaseInfo {
    #[br(map = |raw_name: [u8; LW_MAX_NAME]| {
        let end = raw_name.iter().position(|&b| b == 0).unwrap_or(LW_MAX_NAME);
        String::from_utf8_lossy(&raw_name[..end]).to_string()
    })]
    #[bw(map = |name: &String| {
        let mut raw_name = [0; LW_MAX_NAME];
        let bytes = name.as_bytes();
        raw_name[..bytes.len()].copy_from_slice(bytes);
        raw_name[bytes.len()] = b'\0';

        raw_name
    })]
    pub name: String,

    pub id: u32,
    pub parent_id: u32,
    
    // Field to track original glTF node index during processing
    // Not written to file - used for inverse bind matrix matching
    #[br(ignore)]
    #[bw(ignore)]
    pub original_node_index: u32,
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwBoneDummyInfo {
    pub id: u32,
    pub parent_bone_id: u32,
    pub mat: LwMatrix44,
}

#[binrw]
#[derive(Debug)]
pub struct LwBoneKeyInfo {
    #[br(default)]
    pub mat43_seq: Option<Vec<LwMatrix43>>,

    #[br(default)]
    pub mat44_seq: Option<Vec<LwMatrix44>>,

    #[br(default)]
    #[bw()]
    pub pos_seq: Option<Vec<LwVector3>>,

    #[br(default)]
    #[bw()]
    pub quat_seq: Option<Vec<LwQuaternion>>,
}

impl LwBoneKeyInfo {
    pub fn read_key_data<R: Read + Seek>(
        reader: &mut R,
        args: (u32, u32, u32, u32),
    ) -> BinResult<Self> {
        let (frame_num, key_type, version, parent_id) = args;

        let mut info = LwBoneKeyInfo {
            mat43_seq: None,
            mat44_seq: None,
            pos_seq: None,
            quat_seq: None,
        };

        match key_type {
            BONE_KEY_TYPE_MAT43 => {
                let mat43_vec: Vec<LwMatrix43> = BinRead::read_options(
                    reader,
                    binrw::Endian::Little,
                    binrw::VecArgs {
                        count: frame_num as usize,
                        inner: (),
                    },
                )?;
                info.mat43_seq = Some(mat43_vec);
            }

            BONE_KEY_TYPE_MAT44 => {
                let mat44_vec: Vec<LwMatrix44> = BinRead::read_options(
                    reader,
                    binrw::Endian::Little,
                    binrw::VecArgs {
                        count: frame_num as usize,
                        inner: (),
                    },
                )?;
                info.mat44_seq = Some(mat44_vec);
            }

            BONE_KEY_TYPE_QUAT => {
                let exp_obj_version_1_0_0_3 = 0x1003;
                if version >= exp_obj_version_1_0_0_3 {
                    let pos_vec: Vec<LwVector3> = BinRead::read_options(
                        reader,
                        binrw::Endian::Little,
                        VecArgs {
                            count: frame_num as usize,
                            inner: (),
                        },
                    )?;

                    let quat_vec: Vec<LwQuaternion> = BinRead::read_options(
                        reader,
                        binrw::Endian::Little,
                        VecArgs {
                            count: frame_num as usize,
                            inner: (),
                        },
                    )?;

                    info.pos_seq = Some(pos_vec);
                    info.quat_seq = Some(quat_vec);
                } else {
                    let pos_num = if parent_id == LW_INVALID_INDEX {
                        frame_num
                    } else {
                        1
                    };

                    let mut partial_pos: Vec<LwVector3> = BinRead::read_options(
                        reader,
                        binrw::Endian::Little,
                        VecArgs {
                            count: pos_num as usize,
                            inner: (),
                        },
                    )?;

                    if pos_num == 1 && !partial_pos.is_empty() {
                        let first_val = partial_pos[0].clone();
                        partial_pos.resize(frame_num as usize, first_val);
                    }

                    let quat_vec: Vec<LwQuaternion> = BinRead::read_options(
                        reader,
                        binrw::Endian::Little,
                        VecArgs {
                            count: frame_num as usize,
                            inner: (),
                        },
                    )?;

                    info.pos_seq = Some(partial_pos);
                    info.quat_seq = Some(quat_vec);
                }
            }

            _ => {
                return Err(binrw::Error::AssertFail {
                    pos: 0,
                    message: format!("Unknown key type: {}", key_type),
                })
            }
        };

        Ok(info)
    }
}

#[derive(Debug)]
pub struct LwBoneFile {
    pub version: u32,

    pub old_version: u32,

    pub header: LwBoneInfoHeader,

    pub base_seq: Vec<LwBoneBaseInfo>,

    pub invmat_seq: Vec<LwMatrix44>,

    pub dummy_seq: Vec<LwBoneDummyInfo>,
    pub key_seq: Vec<LwBoneKeyInfo>,
}

impl BinRead for LwBoneFile {
    type Args<'a> = ();

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        opts: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> BinResult<Self> {
        let mut this = LwBoneFile {
            version: 0,
            old_version: 0,
            header: LwBoneInfoHeader {
                bone_num: 0,
                frame_num: 0,
                dummy_num: 0,
                key_type: 0,
            },
            base_seq: Vec::new(),
            invmat_seq: Vec::new(),
            dummy_seq: Vec::new(),
            key_seq: Vec::new(),
        };

        let total_parsing_steps = 6;
        let mut current_step = 1;

        let _ = crate::broadcast::get_broadcaster()
            .send(BroadcastMessage::ModelLoadingUpdate(
                "Loading animations".to_string(),
                "Fetching version".to_string(),
                current_step,
                total_parsing_steps,
            )); 
        this.version = u32::read_options(reader, opts, ())?;

        if this.version == 0 {
            this.old_version = u32::read_options(reader, opts, ())?;
        }

        current_step += 1;

        let _ = crate::broadcast::get_broadcaster()
            .send(BroadcastMessage::ModelLoadingUpdate(
                "Loading animations".to_string(),
                "Reading header".to_string(),
                current_step,
                total_parsing_steps,
            ));
        this.header = LwBoneInfoHeader::read_options(reader, opts, ())?;

        current_step += 1;
        let _ = crate::broadcast::get_broadcaster()
            .send(BroadcastMessage::ModelLoadingUpdate(
                "Loading animations".to_string(),
                "Reading bone hierarchy".to_string(),
                current_step,
                total_parsing_steps,
            ));

        this.base_seq = Vec::read_options(
            reader,
            opts,
            binrw::VecArgs {
                count: this.header.bone_num as usize,
                inner: (),
            },
        )?;

        current_step += 1;
        let _ = crate::broadcast::get_broadcaster()
            .send(BroadcastMessage::ModelLoadingUpdate(
                "Loading animations".to_string(),
                "Reading inverse bind matrices".to_string(),
                current_step,
                total_parsing_steps,
            ));

        this.invmat_seq = Vec::read_options(
            reader,
            opts,
            binrw::VecArgs {
                count: this.header.bone_num as usize,
                inner: (),
            },
        )?;

        current_step += 1;
        let _ = crate::broadcast::get_broadcaster()
            .send(BroadcastMessage::ModelLoadingUpdate(
                "Loading animations".to_string(),
                "Reading dummy information".to_string(),
                current_step,
                total_parsing_steps,
            ));

        this.dummy_seq = Vec::read_options(
            reader,
            opts,
            binrw::VecArgs {
                count: this.header.dummy_num as usize,
                inner: (),
            },
        )?;

        current_step += 1;
        let _ = crate::broadcast::get_broadcaster()
            .send(BroadcastMessage::ModelLoadingUpdate(
                "Loading animations".to_string(),
                "Reading animation keyframe data".to_string(),
                current_step,
                total_parsing_steps,
            ));

        let mut key_infos = Vec::with_capacity(this.header.bone_num as usize);
        for i in 0..this.header.bone_num {
            let parent_id = this.base_seq[i as usize].parent_id;
            let one_key_info = LwBoneKeyInfo::read_key_data(
                reader,
                (
                    this.header.frame_num,
                    this.header.key_type,
                    this.version,
                    parent_id,
                ),
            )?;

            key_infos.push(one_key_info);
        }

        this.key_seq = key_infos;

        Ok(this)
    }
}

impl BinWrite for LwBoneFile {
    type Args<'a> = ();

    fn write_options<W: std::io::Write + Seek>(
        &self,
        writer: &mut W,
        endian: binrw::Endian,
        args: Self::Args<'_>,
    ) -> BinResult<()> {
        u32::write_options(&self.version, writer, endian, ())?;
        self.header.write_options(writer, endian, ())?;
        Vec::write_options(&self.base_seq, writer, endian, ())?;
        Vec::write_options(&self.invmat_seq, writer, endian, ())?;
        Vec::write_options(&self.dummy_seq, writer, endian, ())?;

        for key_seq in &self.key_seq {
            key_seq.write_options(writer, endian, ())?;
        }
        Ok(())
    }
}

impl LwBoneFile {
    fn get_node_rot_and_translation_and_scale(
        &self,
        node_id: usize,
        frame: usize,
    ) -> Result<(LwQuaternion, LwVector3, LwVector3), String> {
        let key_seq = &self.key_seq[node_id];
        let key_type = &self.header.key_type;

        match *key_type {
            BONE_KEY_TYPE_MAT43 => {
                let key_seq = key_seq.mat43_seq.as_ref().unwrap();
                let mat = key_seq.get(frame).unwrap();
                let (translation, rotation, scale) = mat.to_translation_rotation_scale();

                Ok((rotation, translation, scale))
            }

            BONE_KEY_TYPE_MAT44 => {
                let key_seq = key_seq.mat44_seq.as_ref().unwrap();
                let mat = key_seq.get(frame).unwrap();
                let (translation, rotation, scale) = mat.to_translation_rotation_scale();

                Ok((rotation, translation, scale))
            }

            BONE_KEY_TYPE_QUAT => {
                let pos_seq = key_seq.pos_seq.as_ref().unwrap();
                let quat_seq = key_seq.quat_seq.as_ref().unwrap();

                let translation = pos_seq.get(frame).unwrap();
                let rotation = quat_seq.get(frame).unwrap();

                let scale = LwVector3(Vector3::new(1.0, 1.0, 1.0));

                Ok((rotation.clone(), translation.clone(), scale))
            }
            _ => Err("Unsupported key type".to_string()),
        }
    }

    /// Read keyframe times from the input accessor of an animation sampler
    fn read_keyframe_times(
        sampler: &gltf::animation::Sampler,
        buffers: &[buffer::Data],
    ) -> anyhow::Result<Vec<f32>> {
        let input = sampler.input();
        let input_view = input
            .view()
            .ok_or_else(|| anyhow::anyhow!("Input accessor has no buffer view"))?;
        let buffer = input_view.buffer();
        let buffer_data = buffers
            .get(buffer.index())
            .ok_or_else(|| anyhow::anyhow!("Buffer not found for input accessor"))?;

        let byte_offset = input_view.offset() + input.offset();
        let data = &buffer_data.0[byte_offset..];
        let mut reader = std::io::Cursor::new(data);

        let mut times = Vec::with_capacity(input.count());
        for _ in 0..input.count() {
            let time: f32 = BinRead::read_options(&mut reader, binrw::Endian::Little, ())?;
            times.push(time);
        }

        Ok(times)
    }

    /// Read Vec3 keyframe values (handles CUBICSPLINE tangent data)
    fn read_vec3_keyframes(
        sampler: &gltf::animation::Sampler,
        buffers: &[buffer::Data],
        times: &[f32],
    ) -> anyhow::Result<AnimationChannelData<LwVector3>> {
        let output = sampler.output();
        let output_view = output
            .view()
            .ok_or_else(|| anyhow::anyhow!("Output accessor has no buffer view"))?;
        let buffer = output_view.buffer();
        let buffer_data = buffers
            .get(buffer.index())
            .ok_or_else(|| anyhow::anyhow!("Buffer not found for output accessor"))?;

        let byte_offset = output_view.offset() + output.offset();
        let data = &buffer_data.0[byte_offset..];
        let mut reader = std::io::Cursor::new(data);

        let interpolation = sampler.interpolation();
        let is_cubic = matches!(interpolation, gltf::animation::Interpolation::CubicSpline);

        let keyframe_count = times.len();
        let mut keyframes = Vec::with_capacity(keyframe_count);

        for i in 0..keyframe_count {
            if is_cubic {
                // CUBICSPLINE: read in_tangent, value, out_tangent
                let in_tangent =
                    LwVector3::read_options(&mut reader, binrw::Endian::Little, ())?;
                let value = LwVector3::read_options(&mut reader, binrw::Endian::Little, ())?;
                let out_tangent =
                    LwVector3::read_options(&mut reader, binrw::Endian::Little, ())?;
                keyframes.push(Keyframe {
                    time: times[i],
                    value,
                    tangents: Some((in_tangent, out_tangent)),
                });
            } else {
                // LINEAR/STEP: read value only
                let value = LwVector3::read_options(&mut reader, binrw::Endian::Little, ())?;
                keyframes.push(Keyframe {
                    time: times[i],
                    value,
                    tangents: None,
                });
            }
        }

        Ok(AnimationChannelData {
            keyframes,
            interpolation,
        })
    }

    /// Read Quaternion keyframe values (handles CUBICSPLINE tangent data)
    fn read_quat_keyframes(
        sampler: &gltf::animation::Sampler,
        buffers: &[buffer::Data],
        times: &[f32],
    ) -> anyhow::Result<AnimationChannelData<LwQuaternion>> {
        let output = sampler.output();
        let output_view = output
            .view()
            .ok_or_else(|| anyhow::anyhow!("Output accessor has no buffer view"))?;
        let buffer = output_view.buffer();
        let buffer_data = buffers
            .get(buffer.index())
            .ok_or_else(|| anyhow::anyhow!("Buffer not found for output accessor"))?;

        let byte_offset = output_view.offset() + output.offset();
        let data = &buffer_data.0[byte_offset..];
        let mut reader = std::io::Cursor::new(data);

        let interpolation = sampler.interpolation();
        let is_cubic = matches!(interpolation, gltf::animation::Interpolation::CubicSpline);

        let keyframe_count = times.len();
        let mut keyframes = Vec::with_capacity(keyframe_count);

        for i in 0..keyframe_count {
            if is_cubic {
                let in_tangent =
                    LwQuaternion::read_options(&mut reader, binrw::Endian::Little, ())?;
                let value = LwQuaternion::read_options(&mut reader, binrw::Endian::Little, ())?;
                let out_tangent =
                    LwQuaternion::read_options(&mut reader, binrw::Endian::Little, ())?;
                keyframes.push(Keyframe {
                    time: times[i],
                    value: LwQuaternion(value.0.normalize()),
                    tangents: Some((in_tangent, out_tangent)),
                });
            } else {
                let value = LwQuaternion::read_options(&mut reader, binrw::Endian::Little, ())?;
                keyframes.push(Keyframe {
                    time: times[i],
                    value: LwQuaternion(value.0.normalize()),
                    tangents: None,
                });
            }
        }

        Ok(AnimationChannelData {
            keyframes,
            interpolation,
        })
    }

    /// Find the surrounding keyframe indices for a given time using binary search
    fn find_keyframe_indices(times: &[f32], target_time: f32) -> (usize, usize) {
        let pos = times.partition_point(|&t| t < target_time);

        if pos == 0 {
            (0, 0) // Before first keyframe
        } else if pos >= times.len() {
            let last = times.len() - 1;
            (last, last) // After last keyframe
        } else {
            (pos - 1, pos) // Between keyframes
        }
    }

    /// Resample Vec3 animation channel to uniform 30fps
    fn resample_vec3_channel(
        channel: &AnimationChannelData<LwVector3>,
        frame_count: usize,
    ) -> Vec<LwVector3> {
        let mut result = Vec::with_capacity(frame_count);
        let keyframes = &channel.keyframes;
        let times: Vec<f32> = keyframes.iter().map(|k| k.time).collect();

        for frame_idx in 0..frame_count {
            let target_time = frame_idx as f32 * FRAME_DURATION;
            let (prev_idx, next_idx) = Self::find_keyframe_indices(&times, target_time);

            let value = if prev_idx == next_idx {
                // Exactly at or beyond a keyframe
                keyframes[prev_idx].value.clone()
            } else {
                let prev_kf = &keyframes[prev_idx];
                let next_kf = &keyframes[next_idx];
                let delta_time = next_kf.time - prev_kf.time;
                let t = if delta_time > 0.0 {
                    (target_time - prev_kf.time) / delta_time
                } else {
                    0.0
                };

                match channel.interpolation {
                    gltf::animation::Interpolation::Step => prev_kf.value.clone(),
                    gltf::animation::Interpolation::Linear => prev_kf.value.lerp(&next_kf.value, t),
                    gltf::animation::Interpolation::CubicSpline => {
                        let out_tangent = prev_kf
                            .tangents
                            .as_ref()
                            .map(|(_, out)| out.clone())
                            .unwrap_or_else(|| prev_kf.value.clone());
                        let in_tangent = next_kf
                            .tangents
                            .as_ref()
                            .map(|(inp, _)| inp.clone())
                            .unwrap_or_else(|| next_kf.value.clone());
                        LwVector3::cubic_spline(
                            &prev_kf.value,
                            &out_tangent,
                            &next_kf.value,
                            &in_tangent,
                            t,
                            delta_time,
                        )
                    }
                }
            };

            result.push(value);
        }

        result
    }

    /// Resample Quaternion animation channel to uniform 30fps
    fn resample_quat_channel(
        channel: &AnimationChannelData<LwQuaternion>,
        frame_count: usize,
    ) -> Vec<LwQuaternion> {
        let mut result = Vec::with_capacity(frame_count);
        let keyframes = &channel.keyframes;
        let times: Vec<f32> = keyframes.iter().map(|k| k.time).collect();

        for frame_idx in 0..frame_count {
            let target_time = frame_idx as f32 * FRAME_DURATION;
            let (prev_idx, next_idx) = Self::find_keyframe_indices(&times, target_time);

            let value = if prev_idx == next_idx {
                keyframes[prev_idx].value.clone()
            } else {
                let prev_kf = &keyframes[prev_idx];
                let next_kf = &keyframes[next_idx];
                let delta_time = next_kf.time - prev_kf.time;
                let t = if delta_time > 0.0 {
                    (target_time - prev_kf.time) / delta_time
                } else {
                    0.0
                };

                match channel.interpolation {
                    gltf::animation::Interpolation::Step => prev_kf.value.clone(),
                    gltf::animation::Interpolation::Linear => prev_kf.value.slerp(&next_kf.value, t),
                    gltf::animation::Interpolation::CubicSpline => {
                        let out_tangent = prev_kf
                            .tangents
                            .as_ref()
                            .map(|(_, out)| out.clone())
                            .unwrap_or_else(|| prev_kf.value.clone());
                        let in_tangent = next_kf
                            .tangents
                            .as_ref()
                            .map(|(inp, _)| inp.clone())
                            .unwrap_or_else(|| next_kf.value.clone());
                        LwQuaternion::cubic_spline(
                            &prev_kf.value,
                            &out_tangent,
                            &next_kf.value,
                            &in_tangent,
                            t,
                            delta_time,
                        )
                    }
                }
            };

            result.push(LwQuaternion(value.0.normalize()));
        }

        result
    }

    pub fn to_gltf_skin_and_nodes(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
    ) -> (Skin, Vec<Node>) {
        // Default to 1 mesh for backwards compatibility
        self.to_gltf_skin_and_nodes_multi(fields_to_aggregate, 1, false)
    }
    
    /// Create glTF skin and nodes with support for multiple meshes
    /// Each mesh gets its own skinned mesh node referencing the shared skeleton
    pub fn to_gltf_skin_and_nodes_multi(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
        mesh_count: usize,
        y_up: bool,
    ) -> (Skin, Vec<Node>) {
        let bone_num = self.header.bone_num as usize;
        let mut bone_id_to_node_index = HashMap::new();
        let mut gltf_nodes = Vec::with_capacity(bone_num);

        // create nodes for bones and dummy objects
        for i in 0..bone_num {
            let base_info = &self.base_seq[i];
            let node_index = i;

            bone_id_to_node_index.insert(base_info.id, node_index);
            let (rotation, translation, scale) = self.get_node_rot_and_translation_and_scale(node_index, 0).unwrap();
            let rot = LwQuaternion(rotation.0.normalize());
            let rot_slice = if y_up { math::z_up_to_y_up_quat(rot.to_slice()) } else { rot.to_slice() };
            let trans_slice = if y_up { math::z_up_to_y_up_vec3(translation.to_slice()) } else { translation.to_slice() };
            let bone_extras = RawValue::from_string(format!(r#"{{"bone_id":{}}}"#, base_info.id)).unwrap();
            let node = Node {
                camera: None,
                children: None,
                matrix: None,
                rotation: Some(UnitQuaternion(rot_slice)),
                scale: Some(scale.to_slice()),
                translation: Some(trans_slice),
                skin: None,
                mesh: None,
                name: Some(base_info.name.clone()),
                extensions: None,
                extras: Some(bone_extras),
                weights: None,
            };

            gltf_nodes.push(node);
        }

        let dummy_num = self.header.dummy_num as usize;
        let mut dummy_id_to_node_index = HashMap::new();

        for i in 0..dummy_num {
            let dummy_info = &self.dummy_seq[i];
            let node_index = i + bone_num;

            let dummy_extras = RawValue::from_string(
                format!(r#"{{"dummy":true,"id":{},"parent_bone_id":{}}}"#, dummy_info.id, dummy_info.parent_bone_id)
            ).unwrap();

            let mat = if y_up { math::z_up_to_y_up_mat4(dummy_info.mat.to_slice()) } else { dummy_info.mat.to_slice() };
            let node = Node {
                camera: None,
                children: None,
                matrix: Some(mat),
                rotation: None,
                scale: None,
                translation: None,
                skin: None,
                mesh: None,
                name: Some(format!("Dummy {}", dummy_info.id)),
                extensions: None,
                extras: Some(dummy_extras),
                weights: None,
            };

            dummy_id_to_node_index.insert(dummy_info.id, node_index);
            gltf_nodes.push(node);
        }

        let mut root_nodes: Vec<Index<Node>> = Vec::new();

        // create the hierarchy of nodes
        for i in 0..bone_num {
            let base_info = &self.base_seq[i];
            let parent_id = base_info.parent_id;

            if parent_id == LW_INVALID_INDEX {
                root_nodes.push(Index::new(i as u32));
            } else if let Some(&parent_node_index) = bone_id_to_node_index.get(&parent_id) {
                let gltf_node = &mut gltf_nodes[parent_node_index];
                if gltf_node.children.is_none() {
                    gltf_node.children = Some(vec![Index::new(i as u32)]);
                } else if let Some(ref mut children) = gltf_node.children {
                    children.push(Index::new(i as u32));
                }
            }
        }

        // create the hierarchy of nodes for dummy objects
        for i in 0..dummy_num {
            let dummy_info = &self.dummy_seq[i];
            let parent_bone_id = dummy_info.parent_bone_id;
            let dummy_node_index = dummy_id_to_node_index.get(&dummy_info.id).unwrap();

            if let Some(&parent_node_index) = bone_id_to_node_index.get(&parent_bone_id) {
                let gltf_node = &mut gltf_nodes[parent_node_index];
                if gltf_node.children.is_none() {
                    gltf_node.children = Some(vec![Index::new(*dummy_node_index as u32)]);
                } else if let Some(ref mut children) = gltf_node.children {
                    children.push(Index::new(*dummy_node_index as u32));
                }
            }
        }

        // create the inverse bind matrices buffer
        let ibm_count = bone_num + dummy_num;
        let ibm_byte_count = ibm_count * 16 * std::mem::size_of::<f32>();
        let mut buffer_data: Vec<u8> = Vec::with_capacity(ibm_byte_count);

        for i in 0..bone_num {
            let mut mat = self.invmat_seq[i].to_slice();
            if y_up { mat = math::z_up_to_y_up_mat4(mat); }
            let mat_bytes = bytemuck::cast_slice(&mat);

            buffer_data.extend_from_slice(mat_bytes);
        }

        for i in 0..dummy_num {
            let mut mat = self.dummy_seq[i].mat.to_slice();
            if y_up { mat = math::z_up_to_y_up_mat4(mat); }
            let mat_bytes = bytemuck::cast_slice(&mat);

            buffer_data.extend_from_slice(mat_bytes);
        }

        let ibm_buffer_index = fields_to_aggregate.buffer.len();
        let ibm_buffer_view_index = fields_to_aggregate.buffer_view.len();
        let ibm_accessor_index = fields_to_aggregate.accessor.len();

        let ibm_buffer = Buffer {
            byte_length: USize64(ibm_byte_count as u64),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&buffer_data)
            )),
            extensions: None,
            extras: Default::default(),
            name: Some("InverseBindMatricesBuffer".to_string()),
        };

        let ibm_buffer_view = gltf::json::buffer::View {
            buffer: Index::new(ibm_buffer_index as u32),
            byte_length: USize64(ibm_byte_count as u64),
            byte_offset: Some(USize64(0)),
            byte_stride: None,
            target: None,
            extensions: None,
            extras: Default::default(),
            name: Some("InverseBindMatricesBufferView".to_string()),
        };

        let ibm_accessor = Accessor {
            name: Some("InverseBindMatricesAccessor".to_string()),
            buffer_view: Some(Index::new(ibm_buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: validation::Checked::Valid(GenericComponentType(ComponentType::F32)),
            count: USize64(ibm_count as u64),
            extensions: None,
            extras: Default::default(),
            max: None,
            min: None,
            normalized: false,
            sparse: None,
            type_: validation::Checked::Valid(Type::Mat4),
        };

        fields_to_aggregate.buffer.push(ibm_buffer);
        fields_to_aggregate.buffer_view.push(ibm_buffer_view);
        fields_to_aggregate.accessor.push(ibm_accessor);

        // Create one skinned mesh node per mesh
        // Each node references a different mesh but shares the same skin
        for mesh_idx in 0..mesh_count {
            gltf_nodes.push(Node {
                mesh: Some(Index::new(mesh_idx as u32)),
                skin: Some(Index::new(0)),
                name: Some(format!("CharacterSkinnedMesh_{}", mesh_idx)),
                ..Default::default()
            });
        }

        // Store LAB file version info in skin extras for round-trip preservation
        let skin_extras = RawValue::from_string(format!(
            r#"{{"lab_version":{},"lab_old_version":{}}}"#,
            self.version, self.old_version
        )).unwrap();
        
        let skin = Skin {
            inverse_bind_matrices: Some(Index::new(ibm_accessor_index as u32)),
            skeleton: root_nodes.first().cloned(),
            joints: (0..(bone_num + dummy_num))
                .map(|i| Index::new(i as u32))
                .collect(),
            name: Some("CharacterSkin".to_string()),
            extensions: None,
            extras: Some(skin_extras),
        };

        (skin, gltf_nodes)
    }

    fn get_keyframe_timings(&self) -> Vec<f32> {
        const FRAME_RATE: f32 = 30.0;
        const FRAME_DURATION: f32 = 1.0 / FRAME_RATE;

        // we need one "timing" for each frame.
        // the timing is the time in seconds of the frame
        // the frame rate is the number of frames per second
        // the frame duration is the time it takes to play one frame
        // so we need to multiply the frame number by the frame duration to get the timing
        (0..self.header.frame_num)
            .map(|i| i as f32 * FRAME_DURATION)
            .collect()
    }

    pub fn to_gltf_animations_and_sampler(&self, fields_to_aggregate: &mut GLTFFieldsToAggregate, y_up: bool) {
        let mut channels: Vec<Channel> = Vec::new();
        let mut samplers: Vec<Sampler> = Vec::new();

        let keyframe_timings = self.get_keyframe_timings();

        let keyframe_buffer_index = fields_to_aggregate.buffer.len();
        let keyframe_buffer_view_index = fields_to_aggregate.buffer_view.len();
        let keyframe_accessor_index = fields_to_aggregate.accessor.len();

        let mut keyframe_timings_buffer_data: Vec<u8> = vec![];
        for frame_timing in &keyframe_timings {
            keyframe_timings_buffer_data.extend_from_slice(&frame_timing.to_le_bytes());
        }

        let keyframe_timings_buffer = Buffer {
            byte_length: USize64(keyframe_timings_buffer_data.len() as u64),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&keyframe_timings_buffer_data)
            )),
            extensions: None,
            extras: None,
            name: Some("KeyframeTimings".to_string()),
        };

        let keyframe_timings_buffer_view = gltf::json::buffer::View {
            buffer: Index::new(keyframe_buffer_index as u32),
            byte_length: USize64(keyframe_timings_buffer_data.len() as u64),
            byte_offset: Some(USize64(0)),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("KeyframeBufferView".to_string()),
            target: None,
        };

        let mut keyframe_min = f32::MAX;
        let mut keyframe_max = f32::MIN;
        for timing in &keyframe_timings {
            if *timing < keyframe_min {
                keyframe_min = *timing;
            }
            if *timing > keyframe_max {
                keyframe_max = *timing;
            }
        }
        let keyframe_timings_accessor = Accessor {
            buffer_view: Some(Index::new(keyframe_buffer_view_index as u32)),
            byte_offset: Some(USize64(0)),
            component_type: validation::Checked::Valid(GenericComponentType(ComponentType::F32)),
            count: USize64(keyframe_timings.len() as u64),
            extensions: None,
            extras: None,
            max: Some(json!([keyframe_max])),
            min: Some(json!([keyframe_min])),
            name: Some("KeyframeTimingsAccessor".to_string()),
            normalized: false,
            sparse: None,
            type_: validation::Checked::Valid(Type::Scalar),
        };

        fields_to_aggregate.accessor.push(keyframe_timings_accessor);
        fields_to_aggregate.buffer.push(keyframe_timings_buffer);
        fields_to_aggregate
            .buffer_view
            .push(keyframe_timings_buffer_view);

        for i in 0..self.header.bone_num {
            let keyframe_seq = &self.key_seq[i as usize];
            let (translation, rotation) = match self.header.key_type {
                BONE_KEY_TYPE_QUAT => {
                    let translation = keyframe_seq.pos_seq.as_ref().unwrap();
                    let mut rotation = keyframe_seq.quat_seq.as_ref().unwrap().clone();
                    rotation = rotation
                        .iter_mut()
                        .map(|r| LwQuaternion(r.0.normalize()))
                        .collect();

                    (translation.clone(), rotation.clone())
                }
                BONE_KEY_TYPE_MAT43 => {
                    let animation_mat = keyframe_seq.mat43_seq.as_ref().unwrap();
                    let mut translation_vec = vec![];
                    let mut rotation_vec = vec![];

                    for mat in animation_mat {
                        let (translation, rotation, _) = mat.to_translation_rotation_scale();
                        translation_vec.push(translation);
                        rotation_vec.push(rotation);
                    }

                    (translation_vec, rotation_vec)
                }

                _ => panic!("Unsupported key type"),
            };

            let mut keyframe_translation_buffer_data: Vec<u8> = vec![];
            let mut keyframe_rotation_buffer_data: Vec<u8> = vec![];

            for j in 0..self.header.frame_num {
                let frame_translation = translation.get(j as usize).unwrap();
                let frame_rotation = rotation.get(j as usize).unwrap();

                let t = [frame_translation.0.x, frame_translation.0.y, frame_translation.0.z];
                let t = if y_up { math::z_up_to_y_up_vec3(t) } else { t };
                keyframe_translation_buffer_data.extend_from_slice(&t[0].to_le_bytes());
                keyframe_translation_buffer_data.extend_from_slice(&t[1].to_le_bytes());
                keyframe_translation_buffer_data.extend_from_slice(&t[2].to_le_bytes());

                let r = [frame_rotation.0.v.x, frame_rotation.0.v.y, frame_rotation.0.v.z, frame_rotation.0.s];
                let r = if y_up { math::z_up_to_y_up_quat(r) } else { r };
                keyframe_rotation_buffer_data.extend_from_slice(&r[0].to_le_bytes());
                keyframe_rotation_buffer_data.extend_from_slice(&r[1].to_le_bytes());
                keyframe_rotation_buffer_data.extend_from_slice(&r[2].to_le_bytes());
                keyframe_rotation_buffer_data.extend_from_slice(&r[3].to_le_bytes());
            }

            let keyframe_translation_buffer_index = fields_to_aggregate.buffer.len();
            let keyframe_translation_buffer_view_index = fields_to_aggregate.buffer_view.len();
            let keyframe_translation_accessor_index = fields_to_aggregate.accessor.len();

            let keyframe_translation_buffer = Buffer {
                byte_length: USize64(keyframe_translation_buffer_data.len() as u64),
                uri: Some(format!(
                    "data:application/octet-stream;base64,{}",
                    BASE64_STANDARD.encode(&keyframe_translation_buffer_data)
                )),
                extensions: None,
                extras: None,
                name: Some(format!("KeyframeTranslationBuffer_{}", i)),
            };

            let keyframe_translation_buffer_view = gltf::json::buffer::View {
                buffer: Index::new(keyframe_translation_buffer_index as u32),
                byte_length: USize64(keyframe_translation_buffer_data.len() as u64),
                byte_offset: Some(USize64(0)),
                byte_stride: None,
                target: None,
                extensions: None,
                extras: None,
                name: Some(format!("KeyframeTranslationBufferView_{}", i)),
            };

            let keyframe_translation_accessor = Accessor {
                buffer_view: Some(Index::new(keyframe_translation_buffer_view_index as u32)),
                byte_offset: Some(USize64(0)),
                component_type: validation::Checked::Valid(GenericComponentType(
                    ComponentType::F32,
                )),
                count: USize64(keyframe_timings.len() as u64),
                extensions: None,
                extras: None,
                max: None,
                min: None,
                name: Some(format!("KeyframeTranslationAccessor_{}", i)),
                normalized: false,
                sparse: None,
                type_: validation::Checked::Valid(Type::Vec3),
            };

            fields_to_aggregate
                .accessor
                .push(keyframe_translation_accessor);
            fields_to_aggregate.buffer.push(keyframe_translation_buffer);
            fields_to_aggregate
                .buffer_view
                .push(keyframe_translation_buffer_view);

            let keyframe_rotation_buffer_index = fields_to_aggregate.buffer.len();
            let keyframe_rotation_buffer_view_index = fields_to_aggregate.buffer_view.len();
            let keyframe_rotation_accessor_index = fields_to_aggregate.accessor.len();

            let keyframe_rotation_buffer = Buffer {
                byte_length: USize64(keyframe_rotation_buffer_data.len() as u64),
                uri: Some(format!(
                    "data:application/octet-stream;base64,{}",
                    BASE64_STANDARD.encode(&keyframe_rotation_buffer_data)
                )),
                extensions: None,
                extras: None,
                name: Some(format!("KeyframeRotationBuffer_{}", i)),
            };

            let keyframe_rotation_buffer_view = gltf::json::buffer::View {
                buffer: Index::new(keyframe_rotation_buffer_index as u32),
                byte_length: USize64(keyframe_rotation_buffer_data.len() as u64),
                byte_offset: Some(USize64(0)),
                byte_stride: None,
                target: None,
                extensions: None,
                extras: None,
                name: Some(format!("KeyframeRotationBufferView_{}", i)),
            };

            let keyframe_rotation_accessor = Accessor {
                buffer_view: Some(Index::new(keyframe_rotation_buffer_view_index as u32)),
                byte_offset: Some(USize64(0)),
                component_type: validation::Checked::Valid(GenericComponentType(
                    ComponentType::F32,
                )),
                count: USize64(keyframe_timings.len() as u64),
                extensions: None,
                extras: None,
                max: None,
                min: None,
                name: Some(format!("KeyframeRotationAccessor_{}", i)),
                normalized: false,
                sparse: None,
                type_: validation::Checked::Valid(Type::Vec4),
            };

            fields_to_aggregate
                .accessor
                .push(keyframe_rotation_accessor);
            fields_to_aggregate.buffer.push(keyframe_rotation_buffer);
            fields_to_aggregate
                .buffer_view
                .push(keyframe_rotation_buffer_view);

            let translation_sampler = Sampler {
                input: Index::new(keyframe_accessor_index as u32),
                interpolation: Checked::Valid(json::animation::Interpolation::Linear),
                extensions: None,
                extras: None,
                output: Index::new(keyframe_translation_accessor_index as u32),
            };

            let rotation_sampler = Sampler {
                input: Index::new(keyframe_accessor_index as u32),
                interpolation: Checked::Valid(json::animation::Interpolation::Linear),
                extensions: None,
                extras: None,
                output: Index::new(keyframe_rotation_accessor_index as u32),
            };

            let translation_sampler_index = samplers.len();
            samplers.push(translation_sampler);

            let rotation_sampler_index = samplers.len();
            samplers.push(rotation_sampler);

            let translation_channel = Channel {
                extensions: None,
                extras: None,
                sampler: Index::new(translation_sampler_index as u32),
                target: Target {
                    node: Index::new(i),
                    path: Checked::Valid(Property::Translation),
                    extensions: None,
                    extras: None,
                },
            };

            let rotation_channel = Channel {
                extensions: None,
                extras: None,
                sampler: Index::new(rotation_sampler_index as u32),
                target: Target {
                    node: Index::new(i),
                    path: Checked::Valid(Property::Rotation),
                    extensions: None,
                    extras: None,
                },
            };

            channels.push(translation_channel);
            channels.push(rotation_channel);
        }

        let animation = Animation {
            channels,
            extensions: None,
            extras: None,
            name: Some("CharacterAnimation".to_string()),
            samplers,
        };

        fields_to_aggregate.animation.push(animation);
    }
    pub fn from_file(file_path: PathBuf) -> anyhow::Result<Self> {
        use std::io::{Seek, SeekFrom};
        
        let file = File::open(&file_path)
            .map_err(|e| anyhow::anyhow!("Failed to open LAB file '{}': {}", file_path.display(), e))?;
        
        let file_size = file.metadata()
            .map(|m| m.len())
            .unwrap_or(0);
        
        let mut reader = std::io::BufReader::new(file);
        
        let anim: LwBoneFile = BinRead::read_options(&mut reader, binrw::Endian::Little, ())
            .map_err(|e| {
                let bytes_read = reader.stream_position().unwrap_or(0);
                anyhow::anyhow!(
                    "Failed to parse LAB file '{}': {}\n\
                     File size: {} bytes, bytes read before error: {} bytes\n\
                     This may indicate a corrupted or truncated file.",
                    file_path.display(),
                    e,
                    file_size,
                    bytes_read
                )
            })?;
        
        Ok(anim)
    }

    // debugging fn, creates a tree of gltf nodes
    fn add_node_to_tree(
        node: &gltf::Node,
        tree: &mut TreeBuilder,
        already_parsed: &Mutex<HashMap<usize, bool>>,
    ) {
        if already_parsed.lock().unwrap().contains_key(&node.index()) {
            return;
        }

        if node.children().len() == 0 {
            tree.add_empty_child(format!("[{}]", node.index()) + node.name().unwrap());
            already_parsed.lock().unwrap().insert(node.index(), true);
        } else {
            tree.begin_child(format!("[{}]", node.index()) + node.name().unwrap());
            for child in node.children() {
                LwBoneFile::add_node_to_tree(&child, tree, already_parsed);
                already_parsed.lock().unwrap().insert(node.index(), true);
            }
            tree.end_child();
        }
    }

    // debugging fn, prints a tree of gltf nodes
    fn print_node_tree(gltf: &Document) {
        let mut node_already_parsed = Mutex::new(HashMap::<usize, bool>::new());
        let mut tree = TreeBuilder::new("nodes".to_string());
        let nodes = gltf.nodes().collect::<Vec<gltf::Node>>();

        for node in nodes.iter().rev() {
            LwBoneFile::add_node_to_tree(node, &mut tree, &node_already_parsed);
        }

        print_tree(&tree.build());
    }

    // debugging fn, creates a tree of LAB bones
    fn add_bone_to_tree(
        bone: &MinimalBone,
        bone_idx: usize,
        minimal_bones: &Vec<MinimalBone>,
        tree: &mut TreeBuilder,
        ideal_order: &mut Vec<(u32, u32)>,
    ) {
        if bone.children.is_empty() {
            tree.add_empty_child(bone.name.clone());
            ideal_order.push((bone.original_idx as u32, bone.id));
        } else {
            tree.begin_child(bone.name.clone());
            ideal_order.push((bone.original_idx as u32, bone.id));
            for child_idx in bone.children.clone() {
                let child = &minimal_bones[child_idx as usize];
                LwBoneFile::add_bone_to_tree(
                    child,
                    child_idx as usize,
                    minimal_bones,
                    tree,
                    ideal_order,
                );
            }
            tree.end_child();
        }
    }

    // debugging fn, prints a tree of LAB bones
    fn print_bone_tree(bones: &Vec<LwBoneBaseInfo>, dummies: &Vec<LwBoneDummyInfo>) {
        let mut min_bones: Vec<MinimalBone> = vec![];

        for (idx, bone) in bones.clone().iter().enumerate() {
            min_bones.push(MinimalBone {
                id: bone.id,
                children: vec![],
                original_idx: idx,
                name: bone.name.clone(),
                parent_id: bone.parent_id,
                _type: 0,
            })
        }

        for (idx, dummy) in dummies.clone().iter().enumerate() {
            min_bones.push(MinimalBone {
                id: dummy.id,
                original_idx: idx,
                _type: 1,
                children: vec![],
                name: format!("Dummy {}", dummy.id),
                parent_id: dummy.parent_bone_id,
            });
        }
        let min_bones_ro = min_bones.clone();

        min_bones_ro.iter().enumerate().for_each(|(idx, bone)| {
            if bone.parent_id != LW_INVALID_INDEX {
                let parent_bone = min_bones
                    .iter_mut()
                    .find(|b| b.id == bone.parent_id)
                    .unwrap();
                parent_bone.children.push(idx as u32);
            }
        });

        let mut tree = TreeBuilder::new("bones".to_string());
        let mut ideal_order: Vec<(u32, u32)> = vec![];
        let root_bones = min_bones
            .iter()
            .filter(|b| b.parent_id == LW_INVALID_INDEX)
            .collect::<Vec<&MinimalBone>>();
        for (idx, bone) in root_bones.iter().enumerate() {
            LwBoneFile::add_bone_to_tree(bone, idx, &min_bones, &mut tree, &mut ideal_order);
        }

        print_tree(&tree.build());
    }

    // nodes in GLTF are not necessarily going to be in the "hierarchical" order
    // they will contain data about the children, but the array itself can be randomly arranged
    // we need to create the hierarchy of bones and dummies in the order they should be processed
    // in the LAB file, bones are stored in the order of the hierarchy, like the depth-first traversal of a graph
    // along with the bones, the inverse bind matrices are also stored in that order
    // this returns a vector of tuples, where the first element is the original index of the bone/dummy
    // and the second element is the new index of the bone/dummy
    fn get_ideal_bone_order(
        bones: &Vec<LwBoneBaseInfo>,
    ) -> Vec<(u32, u32)> {
        let mut min_bones: Vec<MinimalBone> = vec![];

        for (idx, bone) in bones.clone().iter().enumerate() {
            min_bones.push(MinimalBone {
                id: bone.id,
                children: vec![],
                original_idx: idx,
                name: bone.name.clone(),
                parent_id: bone.parent_id,
                _type: 0,
            })
        }

        // we create the hierarchy first, setting the children of each bone
        let min_bones_ro = min_bones.clone();
        min_bones_ro.iter().enumerate().for_each(|(idx, bone)| {
            if bone.parent_id != LW_INVALID_INDEX {
                let parent_bone = min_bones
                    .iter_mut()
                    .find(|b| b.id == bone.parent_id)
                    .unwrap();
                parent_bone.children.push(idx as u32);
            }
        });

        let root_bones = min_bones
            .iter()
            .filter(|b| b.parent_id == LW_INVALID_INDEX)
            .collect::<Vec<&MinimalBone>>();
        let mut tree = TreeBuilder::new("bones".to_string());
        let mut ideal_order: Vec<(u32, u32)> = vec![];

        // then we iterate through the root bones (of which there should ideally only be 1) and create a tree of bones
        for (idx, bone) in root_bones.iter().enumerate() {
            LwBoneFile::add_bone_to_tree(bone, idx, &min_bones, &mut tree, &mut ideal_order);
        }

        ideal_order
    }

    pub fn from_gltf(
        gltf: &Document,
        buffers: &Vec<buffer::Data>,
        images: &Vec<image::Data>,
    ) -> anyhow::Result<Self> {
        let nodes = gltf.nodes();
        let animations = gltf.animations();

        if animations.len() == 0 {
            return Err(anyhow::anyhow!("No animations found"));
        }

        // BUG FIX #4: Use skin.joints() as single source of truth for bones
        // This ensures LAB and LGO reference the same skeleton
        let skin = gltf.skins().nth(0)
            .ok_or(anyhow::anyhow!("No skin found in glTF file"))?;
        
        // Extract LAB version info from skin extras if available
        let (lab_version, lab_old_version) = if let Some(extras) = skin.extras() {
            let extras_str = extras.get();
            let parsed: serde_json::Value = serde_json::from_str(extras_str).unwrap_or(serde_json::json!({}));
            let version = parsed.get("lab_version").and_then(|v| v.as_u64()).unwrap_or(4101) as u32;
            let old_version = parsed.get("lab_old_version").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            (version, old_version)
        } else {
            (4101, 0)  // Default values if not found
        };

        let mut bones: Vec<LwBoneBaseInfo> = vec![];
        let mut bone_idx_to_vec_idx = HashMap::<u32, u32>::new();
        let mut node_index_to_bone_array_pos = HashMap::<u32, u32>::new();
        let mut dummies: Vec<LwBoneDummyInfo> = vec![];
        let mut dummy_idx_to_bone_idx = HashMap::<u32, u32>::new();
        let mut dummy_node_indices: Vec<u32> = vec![];  // Track node index for each dummy
        let mut idx_to_node = HashMap::<u32, gltf::Node>::new();
        let mut dummy_num = 0;

        // Extract bones from skin.joints() only
        for joint in skin.joints() {
            idx_to_node.insert(joint.index() as u32, joint.clone());
            
            // Skip dummy nodes (they go in dummy_seq)
            if let Some(extras) = joint.extras() {
                let extra = extras.get();
                if extra.contains("dummy") {
                    // Parse dummy ID and matrix from extras
                    let parsed: serde_json::Value = serde_json::from_str(extra).unwrap_or(serde_json::json!({}));
                    let dummy_id = parsed.get("id").and_then(|v| v.as_u64()).unwrap_or(joint.index() as u64) as u32;
                    
                    // Extract matrix from node transform
                    let transform = joint.transform();
                    let mat_array: [[f32; 4]; 4] = transform.matrix();
                    let mat = LwMatrix44(Matrix4::new(
                        mat_array[0][0], mat_array[0][1], mat_array[0][2], mat_array[0][3],
                        mat_array[1][0], mat_array[1][1], mat_array[1][2], mat_array[1][3],
                        mat_array[2][0], mat_array[2][1], mat_array[2][2], mat_array[2][3],
                        mat_array[3][0], mat_array[3][1], mat_array[3][2], mat_array[3][3],
                    ));
                    
                    let dummy_info = LwBoneDummyInfo {
                        id: dummy_id,
                        parent_bone_id: LW_INVALID_INDEX,
                        mat,
                    };
                    dummies.push(dummy_info);
                    dummy_node_indices.push(joint.index() as u32);  // Store node index
                    dummy_idx_to_bone_idx.insert(joint.index() as u32, dummy_num);
                    dummy_num += 1;
                    continue;
                }
            }
            
            let array_pos = bones.len() as u32;
            let bone = LwBoneBaseInfo {
                id: joint.index() as u32,  // Temporary: node index
                parent_id: LW_INVALID_INDEX,  // Will be set below
                name: joint.name().unwrap_or("unnamed").to_string(),
                original_node_index: joint.index() as u32,
            };
            
            bones.push(bone);
            bone_idx_to_vec_idx.insert(joint.index() as u32, array_pos);
            node_index_to_bone_array_pos.insert(joint.index() as u32, array_pos);
        }

        // BUG FIX #1: Build parent relationships using array positions
        // NOT node indices - this is critical for game engine
        for (bone_array_pos, bone) in bones.iter_mut().enumerate() {
            let node = idx_to_node.get(&bone.original_node_index).unwrap();
            
            // Find this node's parent in skin.joints()
            let parent_joint = skin.joints().find(|j| {
                j.children().any(|c| c.index() == node.index())
            });
            
            if let Some(parent) = parent_joint {
                // Convert parent node index → parent bone array position
                if let Some(parent_array_pos) = node_index_to_bone_array_pos.get(&(parent.index() as u32)) {
                    bone.parent_id = *parent_array_pos;
                } else {
                    eprintln!("Warning: Bone '{}' has parent node {} which is not in skeleton", 
                              bone.name, parent.index());
                    bone.parent_id = LW_INVALID_INDEX;
                }
            }
            // else: no parent found, remains as root (LW_INVALID_INDEX)
        }

        // Handle dummy parent relationships
        for (i, dummy) in dummies.iter_mut().enumerate() {
            let dummy_node_idx = dummy_node_indices[i];
            let dummy_node = idx_to_node.get(&dummy_node_idx);
            if let Some(node) = dummy_node {
                let parent_joint = skin.joints().find(|j| {
                    j.children().any(|c| c.index() == node.index())
                });
                
                if let Some(parent) = parent_joint {
                    if let Some(parent_array_pos) = node_index_to_bone_array_pos.get(&(parent.index() as u32)) {
                        dummy.parent_bone_id = *parent_array_pos;
                    }
                }
            }
        }

        // Reorder bones to depth-first (parent before children)
        let ideal_order = LwBoneFile::get_ideal_bone_order(&bones);
        let mut bone_id_to_orig_idx = HashMap::<u32, u32>::new();
        let mut orig_bone_id_to_new_id = HashMap::<u32, u32>::new();

        let mut reordered_bones: Vec<LwBoneBaseInfo> = vec![];
        for (i, entry) in ideal_order.iter().enumerate() {
            let bone = bones.iter().find(|b| b.id == entry.1).unwrap();
            let mut new_bone = bone.clone();
            orig_bone_id_to_new_id.insert(new_bone.id, i as u32);
            new_bone.id = i as u32;
            bone_id_to_orig_idx.insert(new_bone.id, entry.0);
            reordered_bones.push(new_bone);
        }

        // BUG FIX #2: Map old array positions → new array positions
        // NOT node indices - parent_id already stores array positions from Bug #1 fix
        let mut old_pos_to_new_pos = HashMap::<u32, u32>::new();
        for (new_pos, entry) in ideal_order.iter().enumerate() {
            // entry.0 is the original array position
            old_pos_to_new_pos.insert(entry.0, new_pos as u32);
        }

        // Update parent IDs to reflect new positions after reordering
        reordered_bones.iter_mut().for_each(|bone| {
            if bone.parent_id != LW_INVALID_INDEX {
                bone.parent_id = *old_pos_to_new_pos.get(&bone.parent_id)
                    .expect("Parent bone should have been reordered");
            }
        });

        // Validate depth-first ordering (parent < child)
        for (idx, bone) in reordered_bones.iter().enumerate() {
            if bone.parent_id != LW_INVALID_INDEX {
                assert!(
                    bone.parent_id < idx as u32,
                    "Bone {} '{}': parent_id {} should be < {} (depth-first ordering violated)",
                    bone.id, bone.name, bone.parent_id, idx
                );
            }
        }

        // Update dummy parent IDs
        dummies.iter_mut().for_each(|d| {
            if d.parent_bone_id != LW_INVALID_INDEX {
                d.parent_bone_id = *orig_bone_id_to_new_id.get(&d.parent_bone_id)
                    .expect("Dummy parent bone should exist");
            }
        });

        bones = reordered_bones;

        // inverse bind matrices
        // BUG #5 FIX: Read all IBMs into a HashMap keyed by glTF node index first,
        // then assign them to the final bone array by matching original_node_index.
        // This ensures IBMs are correctly matched to bones even after reordering.
        let skin = gltf.skins().nth(0).unwrap();
        let ibm = skin.inverse_bind_matrices().unwrap();
        let ibm_accessor = ibm.view().unwrap();

        let ibm_buffer = ibm_accessor.buffer();
        let ibm_buffer_data = buffers.get(ibm_buffer.index()).unwrap();
        let ibm_buffer_as_slice = ibm_buffer_data.0.as_slice();
        let ibm_start = ibm.offset() + ibm_accessor.offset();
        let ibm_data_raw = &ibm_buffer_as_slice[ibm_start..];
        let mut reader = std::io::Cursor::new(ibm_data_raw);
        
        // Step 1: Read all IBMs and store them by glTF node index
        let mut ibm_by_node_index = std::collections::HashMap::<u32, LwMatrix44>::new();
        for joint in skin.joints() {
            let ibm = LwMatrix44::read_options(&mut reader, binrw::Endian::Little, ()).unwrap();
            let node_index = joint.index() as u32;
            
            // Handle dummies
            if let Some(extras) = joint.extras() {
                let extra = extras.get();
                if extra.contains("dummy") {
                    let dummy_idx = dummy_idx_to_bone_idx.get(&node_index).unwrap();
                    let transform = joint.transform();
                    let dummy_transform = LwMatrix44(Matrix4::from(transform.matrix()));
                    dummies[*dummy_idx as usize].mat = dummy_transform;
                    continue; // Don't store IBM for dummies
                }
            }
            
            ibm_by_node_index.insert(node_index, ibm);
        }
        
        // Step 2: Assign IBMs to final bone array by matching original_node_index
        let mut ibm_data: Vec<LwMatrix44> =
            vec![LwMatrix44(Matrix4::<f32>::identity(),); bones.len()];
        for (final_pos, bone) in bones.iter().enumerate() {
            if let Some(ibm) = ibm_by_node_index.get(&bone.original_node_index) {
                ibm_data[final_pos] = ibm.clone();
            } else {
                panic!("No inverse bind matrix found for bone {} '{}' with original_node_index {}",
                       bone.id, bone.name, bone.original_node_index);
            }
        }

        let bone_num = ibm_data.len();

        // === STEP 3: Calculate animation duration and frame count ===
        let animation = animations.last().unwrap();
        let mut max_time: f32 = 0.0;

        // First pass: determine animation duration from all channels
        for channel in animation.channels() {
            let sampler = channel.sampler();
            let times = Self::read_keyframe_times(&sampler, buffers)?;
            if let Some(&last_time) = times.last() {
                max_time = max_time.max(last_time);
            }
        }

        // Calculate frame count: duration * fps + 1 (include both endpoints)
        // Frame 0 is at time 0, frame N is at time N/fps
        // So if max_time is 20.467 seconds at 30fps, we need frames 0..614 = 615 frames
        let frame_count = ((max_time * TARGET_FPS).round() as usize) + 1;
        if frame_count <= 1 {
            return Err(anyhow::anyhow!("Animation has zero or one frame"));
        }

        // === STEP 4: Extract animation channels per bone ===
        let mut bone_anim_data: HashMap<u32, BoneAnimationData> = HashMap::new();

        for channel in animation.channels() {
            let target = channel.target();
            let target_node = target.node();
            let node_idx = target_node.index() as u32;
            let property = target.property();
            let sampler = channel.sampler();

            // Skip nodes that aren't bones (e.g., mesh nodes)
            let new_node_idx = match orig_bone_id_to_new_id.get(&node_idx) {
                Some(idx) => *idx,
                None => continue, // Not a bone, skip
            };

            // Read keyframe times
            let times = Self::read_keyframe_times(&sampler, buffers)?;

            // Get or create bone animation data
            let bone_data = bone_anim_data
                .entry(new_node_idx)
                .or_insert_with(|| BoneAnimationData {
                    translation: None,
                    rotation: None,
                });

            match property {
                Property::Translation => {
                    let channel_data = Self::read_vec3_keyframes(&sampler, buffers, &times)?;
                    bone_data.translation = Some(channel_data);
                }
                Property::Rotation => {
                    let channel_data = Self::read_quat_keyframes(&sampler, buffers, &times)?;
                    bone_data.rotation = Some(channel_data);
                }
                Property::Scale => {
                    // Log warning and skip - .lab format doesn't support scale
                    println!(
                        "Warning: Scale channel ignored for bone {} (node {})",
                        new_node_idx, node_idx
                    );
                }
                Property::MorphTargetWeights => {
                    // Skip morph targets
                    continue;
                }
            }
        }

        // === STEP 5: Resample and build keyframe sequences ===
        let mut keyframe_vec: Vec<LwBoneKeyInfo> = Vec::with_capacity(bones.len());

        for bone in &bones {
            let bone_data = bone_anim_data.get(&bone.id);

            let (translation_data, rotation_data) = match bone_data {
                Some(data) => {
                    // Resample available channels
                    let translations = match &data.translation {
                        Some(channel) => Self::resample_vec3_channel(channel, frame_count),
                        None => {
                            // Use rest pose translation from node transform
                            let orig_idx = bone_id_to_orig_idx.get(&bone.id).unwrap_or(&bone.id);
                            let node = idx_to_node.get(orig_idx);
                            let rest_pos = match node {
                                Some(n) => {
                                    let (t, _, _) = n.transform().decomposed();
                                    LwVector3(Vector3::new(t[0], t[1], t[2]))
                                }
                                None => LwVector3(Vector3::new(0.0, 0.0, 0.0)),
                            };
                            vec![rest_pos; frame_count]
                        }
                    };

                    let rotations = match &data.rotation {
                        Some(channel) => Self::resample_quat_channel(channel, frame_count),
                        None => {
                            // Use rest pose rotation from node transform
                            let orig_idx = bone_id_to_orig_idx.get(&bone.id).unwrap_or(&bone.id);
                            let node = idx_to_node.get(orig_idx);
                            let rest_rot = match node {
                                Some(n) => {
                                    let (_, r, _) = n.transform().decomposed();
                                    LwQuaternion(Quaternion::new(r[3], r[0], r[1], r[2]).normalize())
                                }
                                None => LwQuaternion(Quaternion::new(1.0, 0.0, 0.0, 0.0)),
                            };
                            vec![rest_rot; frame_count]
                        }
                    };

                    (translations, rotations)
                }
                None => {
                    // Bone has no animation data - use rest pose
                    println!(
                        "Warning: No animation data for bone {}, using rest pose",
                        bone.id
                    );
                    let orig_idx = bone_id_to_orig_idx.get(&bone.id).unwrap_or(&bone.id);
                    let node = idx_to_node.get(orig_idx);

                    let (rest_pos, rest_rot) = match node {
                        Some(n) => {
                            let (t, r, _) = n.transform().decomposed();
                            (
                                LwVector3(Vector3::new(t[0], t[1], t[2])),
                                LwQuaternion(Quaternion::new(r[3], r[0], r[1], r[2]).normalize()),
                            )
                        }
                        None => (
                            LwVector3(Vector3::new(0.0, 0.0, 0.0)),
                            LwQuaternion(Quaternion::new(1.0, 0.0, 0.0, 0.0)),
                        ),
                    };

                    (vec![rest_pos; frame_count], vec![rest_rot; frame_count])
                }
            };

            let bone_key_info = LwBoneKeyInfo {
                mat43_seq: None,
                mat44_seq: None,
                pos_seq: Some(translation_data),
                quat_seq: Some(rotation_data),
            };

            keyframe_vec.push(bone_key_info);
        }

        // === STEP 6: Build and return LwBoneFile ===
        Ok(LwBoneFile {
            version: lab_version,
            header: LwBoneInfoHeader {
                bone_num: bone_num as u32,
                dummy_num: dummy_num as u32,
                frame_num: frame_count as u32,
                key_type: BONE_KEY_TYPE_QUAT,
            },
            base_seq: bones,
            invmat_seq: ibm_data,
            dummy_seq: dummies,
            key_seq: keyframe_vec,
            old_version: lab_old_version,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_keyframe_indices_before_first() {
        let times = vec![0.0, 0.5, 1.0, 1.5];
        let (prev, next) = LwBoneFile::find_keyframe_indices(&times, -0.1);
        assert_eq!(prev, 0);
        assert_eq!(next, 0);
    }

    #[test]
    fn test_find_keyframe_indices_at_first() {
        let times = vec![0.0, 0.5, 1.0, 1.5];
        let (prev, next) = LwBoneFile::find_keyframe_indices(&times, 0.0);
        assert_eq!(prev, 0);
        assert_eq!(next, 0);
    }

    #[test]
    fn test_find_keyframe_indices_between() {
        let times = vec![0.0, 0.5, 1.0, 1.5];
        let (prev, next) = LwBoneFile::find_keyframe_indices(&times, 0.25);
        assert_eq!(prev, 0);
        assert_eq!(next, 1);
    }

    #[test]
    fn test_find_keyframe_indices_at_middle() {
        let times = vec![0.0, 0.5, 1.0, 1.5];
        let (prev, next) = LwBoneFile::find_keyframe_indices(&times, 0.75);
        assert_eq!(prev, 1);
        assert_eq!(next, 2);
    }

    #[test]
    fn test_find_keyframe_indices_after_last() {
        let times = vec![0.0, 0.5, 1.0, 1.5];
        let (prev, next) = LwBoneFile::find_keyframe_indices(&times, 2.0);
        assert_eq!(prev, 3);
        assert_eq!(next, 3);
    }

    #[test]
    fn test_resample_linear_translation() {
        // Create channel with keyframes at 0.0 and 1.0 seconds
        let channel = AnimationChannelData {
            keyframes: vec![
                Keyframe {
                    time: 0.0,
                    value: LwVector3(Vector3::new(0.0, 0.0, 0.0)),
                    tangents: None,
                },
                Keyframe {
                    time: 1.0,
                    value: LwVector3(Vector3::new(30.0, 0.0, 0.0)),
                    tangents: None,
                },
            ],
            interpolation: gltf::animation::Interpolation::Linear,
        };

        // Resample to 31 frames (0.0 to 1.0 at 30fps)
        let result = LwBoneFile::resample_vec3_channel(&channel, 31);

        assert_eq!(result.len(), 31);
        assert!((result[0].0.x - 0.0).abs() < 0.1); // Frame 0 = 0.0s
        assert!((result[15].0.x - 15.0).abs() < 0.1); // Frame 15 = 0.5s = 15.0
        assert!((result[30].0.x - 30.0).abs() < 0.1); // Frame 30 = 1.0s = 30.0
    }

    #[test]
    fn test_resample_step_translation() {
        let channel = AnimationChannelData {
            keyframes: vec![
                Keyframe {
                    time: 0.0,
                    value: LwVector3(Vector3::new(0.0, 0.0, 0.0)),
                    tangents: None,
                },
                Keyframe {
                    time: 0.5,
                    value: LwVector3(Vector3::new(10.0, 0.0, 0.0)),
                    tangents: None,
                },
            ],
            interpolation: gltf::animation::Interpolation::Step,
        };

        let result = LwBoneFile::resample_vec3_channel(&channel, 31);

        // STEP: should hold previous value until next keyframe
        // Frame 0 (t=0.0): at first keyframe, value = 0.0
        assert!((result[0].0.x - 0.0).abs() < 0.01);
        // Frame 10 (t=0.333s): before second keyframe, value = 0.0
        assert!((result[10].0.x - 0.0).abs() < 0.01);
        // Frame 14 (t=0.467s): still before 0.5s, value = 0.0
        assert!((result[14].0.x - 0.0).abs() < 0.01);
        // Frame 15 (t=0.5s exactly): STEP uses prev value in the segment, so still 0.0
        // (glTF STEP holds value until the NEXT keyframe time is reached in interpolation)
        assert!((result[15].0.x - 0.0).abs() < 0.01);
        // Frame 16+ (t>0.5s): after keyframe, value = 10.0
        assert!((result[16].0.x - 10.0).abs() < 0.01);
        assert!((result[30].0.x - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_resample_single_keyframe() {
        // Single keyframe should be repeated for all frames
        let channel = AnimationChannelData {
            keyframes: vec![Keyframe {
                time: 0.0,
                value: LwVector3(Vector3::new(5.0, 10.0, 15.0)),
                tangents: None,
            }],
            interpolation: gltf::animation::Interpolation::Linear,
        };

        let result = LwBoneFile::resample_vec3_channel(&channel, 10);

        assert_eq!(result.len(), 10);
        for frame in &result {
            assert!((frame.0.x - 5.0).abs() < 0.001);
            assert!((frame.0.y - 10.0).abs() < 0.001);
            assert!((frame.0.z - 15.0).abs() < 0.001);
        }
    }
}
