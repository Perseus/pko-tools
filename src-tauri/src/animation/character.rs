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

use crate::{broadcast::BroadcastMessage, character::GLTFFieldsToAggregate, math::{matrix4_to_quaternion, LwMatrix43, LwMatrix44, LwQuaternion, LwVector3}};

// Constants
pub const LW_MAX_NAME: usize = 64;
pub const LW_INVALID_INDEX: u32 = 0xFFFFFFFF; // Example sentinel

// Example key_type constants
pub const BONE_KEY_TYPE_MAT43: u32 = 1;
pub const BONE_KEY_TYPE_MAT44: u32 = 2;
pub const BONE_KEY_TYPE_QUAT: u32 = 3;


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
    fn get_node_rot_and_translation(
        &self,
        node_id: usize,
        frame: usize,
    ) -> Result<(LwQuaternion, LwVector3), String> {
        let key_seq = &self.key_seq[node_id];
        let key_type = &self.header.key_type;

        match *key_type {
            BONE_KEY_TYPE_MAT43 => {
                let key_seq = key_seq.mat43_seq.as_ref().unwrap();
                let mat = key_seq.get(frame).unwrap();
                let (translation, rotation, _scale) = mat.to_translation_rotation_scale();

                Ok((rotation, translation))
            }

            BONE_KEY_TYPE_MAT44 => {
                let key_seq = key_seq.mat44_seq.as_ref().unwrap();
                let mat = key_seq.get(frame).unwrap();
                let (translation, rotation, _scale) = mat.to_translation_rotation_scale();

                Ok((rotation, translation))
            }

            BONE_KEY_TYPE_QUAT => {
                let pos_seq = key_seq.pos_seq.as_ref().unwrap();
                let quat_seq = key_seq.quat_seq.as_ref().unwrap();

                let translation = pos_seq.get(frame).unwrap();
                let rotation = quat_seq.get(frame).unwrap();

                Ok((rotation.clone(), translation.clone()))
            }
            _ => Err("Unsupported key type".to_string()),
        }
    }

    pub fn to_gltf_skin_and_nodes(
        &self,
        fields_to_aggregate: &mut GLTFFieldsToAggregate,
    ) -> (Skin, Vec<Node>) {
        let bone_num = self.header.bone_num as usize;
        let mut bone_id_to_node_index = HashMap::new();
        let mut gltf_nodes = Vec::with_capacity(bone_num);

        // create nodes for bones and dummy objects
        for i in 0..bone_num {
            let base_info = &self.base_seq[i];
            let node_index = i;

            bone_id_to_node_index.insert(base_info.id, node_index);
            let (rotation, translation) = self.get_node_rot_and_translation(node_index, 0).unwrap();
            let rot = LwQuaternion(rotation.0.normalize());
            let node = Node {
                camera: None,
                children: None,
                matrix: None,
                rotation: Some(UnitQuaternion(rot.to_slice())),
                scale: None,
                translation: Some(translation.to_slice()),
                skin: None,
                mesh: None,
                name: Some(base_info.name.clone()),
                extensions: None,
                extras: Default::default(),
                weights: None,
            };

            gltf_nodes.push(node);
        }

        let dummy_num = self.header.dummy_num as usize;
        let mut dummy_id_to_node_index = HashMap::new();

        for i in 0..dummy_num {
            let dummy_info = &self.dummy_seq[i];
            let node_index = i + bone_num;

            let dummy_extras = RawValue::from_string(r#"{"dummy": true}"#.to_string()).unwrap();
            let (translation, rotation, _) = dummy_info.mat.to_translation_rotation_scale();
            let rot = LwQuaternion(rotation.0.normalize());

            let node = Node {
                camera: None,
                children: None,
                matrix: None,
                rotation: Some(UnitQuaternion(rot.to_slice())),
                scale: None,
                translation: Some(translation.to_slice()),
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
            let mat = &mut self.invmat_seq[i].to_slice();
            let mat_bytes = bytemuck::cast_slice(mat);

            buffer_data.extend_from_slice(mat_bytes);
        }

        for i in 0..dummy_num {
            let mat = &mut self.dummy_seq[i].mat.to_slice();
            let mat_bytes = bytemuck::cast_slice(mat);

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

        gltf_nodes.push(Node {
            mesh: Some(Index::new(0)),
            skin: Some(Index::new(0)),
            name: Some("CharacterSkinnedMesh".to_string()),
            ..Default::default()
        });

        let skin = Skin {
            inverse_bind_matrices: Some(Index::new(ibm_accessor_index as u32)),
            skeleton: root_nodes.first().cloned(),
            joints: (0..(bone_num + dummy_num))
                .map(|i| Index::new(i as u32))
                .collect(),
            name: Some("CharacterSkin".to_string()),
            extensions: None,
            extras: Default::default(),
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

    pub fn to_gltf_animations_and_sampler(&self, fields_to_aggregate: &mut GLTFFieldsToAggregate) {
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

                keyframe_translation_buffer_data
                    .extend_from_slice(&frame_translation.0.x.to_le_bytes());
                keyframe_translation_buffer_data
                    .extend_from_slice(&frame_translation.0.y.to_le_bytes());
                keyframe_translation_buffer_data
                    .extend_from_slice(&frame_translation.0.z.to_le_bytes());

                keyframe_rotation_buffer_data
                    .extend_from_slice(&frame_rotation.0.v.x.to_le_bytes());
                keyframe_rotation_buffer_data
                    .extend_from_slice(&frame_rotation.0.v.y.to_le_bytes());
                keyframe_rotation_buffer_data
                    .extend_from_slice(&frame_rotation.0.v.z.to_le_bytes());
                keyframe_rotation_buffer_data.extend_from_slice(&frame_rotation.0.s.to_le_bytes());
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
        let file = File::open(file_path)?;
        let mut reader = std::io::BufReader::new(file);
        let anim: LwBoneFile = BinRead::read_options(&mut reader, binrw::Endian::Little, ())?;
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

        let mut dummy_num = 0;
        let mut bones: Vec<LwBoneBaseInfo> = vec![];
        let mut bone_idx_to_vec_idx = HashMap::<u32, u32>::new();
        let mut dummies: Vec<LwBoneDummyInfo> = vec![];
        let mut dummy_idx_to_bone_idx = HashMap::<u32, u32>::new();
        let mut idx_to_node = HashMap::<u32, gltf::Node>::new();
        let mut child_node_index_to_parent_node_index = HashMap::<u32, u32>::new();
        let mut child_dummy_index_to_parent_node_index = HashMap::<u32, u32>::new();
        
        for node in gltf.nodes() {
            let children = node.children();
            for child in children {
                if let Some(extras) = child.extras() {
                    let extra = extras.get();
                    if extra.contains("dummy") {
                        child_dummy_index_to_parent_node_index
                            .insert(child.index() as u32, node.index() as u32);
                    }
                } else {
                    child_node_index_to_parent_node_index
                        .insert(child.index() as u32, node.index() as u32);
                }
            }
        }

        let mut child_node_index_to_parent_node_vec_index = HashMap::<u32, u32>::new();
        let mut child_dummy_index_to_parent_node_vec_index = HashMap::<u32, u32>::new();

        for node in nodes {
            idx_to_node.insert(node.index() as u32, node.clone());
            if let Some(extras) = node.extras() {
                let extra = extras.get();
                if extra.contains("dummy") {
                    let dummy_info = LwBoneDummyInfo {
                        id: node.index() as u32,
                        parent_bone_id: LW_INVALID_INDEX,
                        mat: LwMatrix44(Matrix4::<f32>::identity()),
                    };
                    dummies.push(dummy_info);
                    dummy_idx_to_bone_idx.insert(node.index() as u32, dummy_num as u32);
                    dummy_num += 1;

                    if let Some(parent_node_idx) =
                        child_dummy_index_to_parent_node_index.get(&(node.index() as u32))
                    {
                        child_dummy_index_to_parent_node_vec_index
                            .insert(node.index() as u32, *parent_node_idx);
                    }
                }
            } else if node.mesh().is_none() {
                let bone_base_info = LwBoneBaseInfo {
                    id: node.index() as u32,
                    parent_id: LW_INVALID_INDEX,
                    name: node.name().unwrap().to_string(),
                };
                let bone_idx = bones.len();
                bones.push(bone_base_info);
                bone_idx_to_vec_idx.insert(node.index() as u32, bone_idx as u32);

                // check if the node has a parent node
                if let Some(parent_node_idx) =
                    child_node_index_to_parent_node_index.get(&(node.index() as u32))
                {
                    child_node_index_to_parent_node_vec_index
                        .insert(node.index() as u32, *parent_node_idx);
                }
            }
        }

        // skeleton hierarchy
        bones.iter_mut().for_each(|bone| {
            if let Some(parent_node_vec_idx) = child_node_index_to_parent_node_index.get(&bone.id) {
                bone.parent_id = *parent_node_vec_idx;
            }
        });

        // dummy hierarchy
        dummies.iter_mut().for_each(|dummy| {
            if let Some(parent_node_vec_idx) =
                child_dummy_index_to_parent_node_vec_index.get(&dummy.id)
            {
                dummy.parent_bone_id = *parent_node_vec_idx;
            }
        });

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

        reordered_bones.iter_mut().for_each(|bone| {
            if bone.parent_id != LW_INVALID_INDEX {
                let new_parent_id = orig_bone_id_to_new_id.get(&bone.parent_id).unwrap();
                bone.parent_id = *new_parent_id;
            }
        });

        dummies.iter_mut().for_each(|d| {
            let new_parent_id = orig_bone_id_to_new_id.get(&d.parent_bone_id).unwrap();
            d.parent_bone_id = *new_parent_id;
        });

        bones = reordered_bones;

        // inverse bind matrices
        let skin = gltf.skins().nth(0).unwrap();
        let ibm = skin.inverse_bind_matrices().unwrap();
        let ibm_accessor = ibm.view().unwrap();

        let ibm_buffer = ibm_accessor.buffer();
        let ibm_buffer_data = buffers.get(ibm_buffer.index()).unwrap();
        let ibm_buffer_as_slice = ibm_buffer_data.0.as_slice();
        let ibm_start = ibm.offset() + ibm_accessor.offset();
        let ibm_data = &ibm_buffer_as_slice[ibm_start..];
        let mut reader = std::io::Cursor::new(ibm_data);
        let mut ibm_data: Vec<LwMatrix44> =
            vec![LwMatrix44(Matrix4::<f32>::identity(),); bones.len()];

        for (i, joint) in skin.joints().enumerate() {
            let ibm = LwMatrix44::read_options(&mut reader, binrw::Endian::Little, ()).unwrap();
            if let Some(extras) = joint.extras() {
                let extra = extras.get();
                if extra.contains("dummy") {
                    let dummy_idx = dummy_idx_to_bone_idx.get(&(joint.index() as u32)).unwrap();
                    let transform = joint.transform();
                    let dummy_transform = LwMatrix44(Matrix4::from(transform.matrix()));
                    dummies[*dummy_idx as usize].mat = dummy_transform;
                }
            } else {
                let node_idx = orig_bone_id_to_new_id.get(&(joint.index() as u32)).unwrap();
                ibm_data[*node_idx as usize] = ibm;
            }
        }

        let bone_num = ibm_data.len();

        // keyframe data
        let animation = animations.last().unwrap();

        // there should be two channels for each bone (translation and rotation)
        if animation.channels().count() != bone_num * 2 {
            return Err(anyhow::anyhow!("Invalid animation channels count"));
        }

        let channels = animation.channels();
        let mut node_idx_to_translation_data = HashMap::<u32, Vec<LwVector3>>::new();
        let mut node_idx_to_rotation_data = HashMap::<u32, Vec<LwQuaternion>>::new();
        let mut frame_num = 0;


        for channel in channels {
            let target = channel.target();
            let target_node = target.node();
            let node_idx = target_node.index() as u32;
            let property = target.property();
            let sampler = channel.sampler();
            let output = sampler.output();
            let output_view = output.view().unwrap();
            let buffer = output_view.buffer();
            let buffer_data = buffers.get(buffer.index()).unwrap();

            // all channels should have the same number of frames
            if frame_num != 0 && frame_num != output.count() {
                return Err(anyhow::anyhow!("Invalid frame number"));
            } else {
                frame_num = output.count();
            }

            // we only support f32
            if output.data_type() != ComponentType::F32 {
                return Err(anyhow::anyhow!("Unsupported data type"));
            }

            let mut translation_data: Vec<LwVector3> = vec![];
            let mut rotation_data: Vec<LwQuaternion> = vec![];
            let byte_offset = output_view.offset();
            let buffer_as_slice = buffer_data.0.as_slice();
            let start = output.offset() + byte_offset;
            let data = &buffer_as_slice[start..];
            let new_node_idx = orig_bone_id_to_new_id.get(&node_idx).unwrap();

            if property == Property::Translation {
                let mut reader = std::io::Cursor::new(data);
                for _ in 0..frame_num {
                    let translation =
                        LwVector3::read_options(&mut reader, binrw::Endian::Little, ()).unwrap();
                    translation_data.push(translation);
                }
                node_idx_to_translation_data.insert(*new_node_idx, translation_data);
            } else if property == Property::Rotation {
                let mut reader = std::io::Cursor::new(data);
                for _ in 0..frame_num {
                    let rotation =
                        LwQuaternion::read_options(&mut reader, binrw::Endian::Little, ()).unwrap();
                    rotation_data.push(rotation);
                }
                node_idx_to_rotation_data.insert(*new_node_idx, rotation_data);
            } else {
                return Err(anyhow::anyhow!("Invalid property").context(format!(
                    "property: {:?}, node_idx: {:?}",
                    property, node_idx
                )));
            }
        }

        let mut keyframe_vec: Vec<LwBoneKeyInfo> = vec![];

        for bone in &bones {
            let translation_data = node_idx_to_translation_data.get(&bone.id);
            let rotation_data = node_idx_to_rotation_data.get(&bone.id);
            if translation_data.is_some() && rotation_data.is_some() {
                let translation_data = translation_data.unwrap().clone();
                let rotation_data = rotation_data.unwrap().clone();

                let bone_key_info = LwBoneKeyInfo {
                    mat43_seq: None,
                    mat44_seq: None,
                    pos_seq: Some(translation_data),
                    quat_seq: Some(rotation_data),
                };

                keyframe_vec.push(bone_key_info);
            } else {
                println!("no keyframe data for bone: {:?}", bone.id);
            }
        }

        Ok(LwBoneFile {
            version: 4101,
            header: LwBoneInfoHeader {
                bone_num: bone_num as u32,
                dummy_num: dummy_num as u32,
                frame_num: frame_num as u32,
                key_type: 3,
            },
            base_seq: bones,
            invmat_seq: ibm_data,
            dummy_seq: dummies,
            key_seq: keyframe_vec,
            old_version: 0,
        })
    }
}
