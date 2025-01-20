use base64::prelude::*;
use cgmath::{InnerSpace, Matrix, Matrix4, Quaternion, Vector3};
use gltf::json::{
    self, accessor::{ComponentType, GenericComponentType, Type}, buffer::View, scene::UnitQuaternion, validation::{self, USize64}, Accessor, Buffer, Index, Node, Root, Scene, Skin
};
use serde_json::value::RawValue;
use std::{collections::HashMap, fs::File, io::BufWriter, path::PathBuf};

pub struct Character {
    animation_file_path: PathBuf,
}

use binrw::{binrw, BinRead, BinResult, VecArgs};
use std::io::{Read, Seek};

// Constants
pub const LW_MAX_NAME: usize = 64;
pub const LW_INVALID_INDEX: u32 = 0xFFFFFFFF; // Example sentinel

// Example key_type constants
pub const BONE_KEY_TYPE_MAT43: u32 = 1;
pub const BONE_KEY_TYPE_MAT44: u32 = 2;
pub const BONE_KEY_TYPE_QUAT: u32 = 3;

//--------------------------------------------------------------------------------
// Basic vector/matrix types (assuming 32-bit floats in a tight array).

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwVector3(
    #[br(map = |raw: [f32; 3]| Vector3::new(raw[0], raw[1], raw[2]))]
    #[bw(map = |v: &Vector3<f32>| [v.x, v.y, v.z])]
    Vector3<f32>,
);

impl LwVector3 {
    pub fn to_slice(&self) -> [f32; 3] {
        let v = &self.0;
        [v.x, v.y, v.z]
    }
}

#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwQuaternion(
    #[br(map = |raw: [f32; 4]| Quaternion::new(raw[3], raw[0], raw[1], raw[2])) ]
    #[bw(map = |q: &Quaternion<f32>| [q.v.x, q.v.y, q.v.z, q.s])]
    Quaternion<f32>,
);

impl LwQuaternion {
    pub fn to_slice(&self) -> [f32; 4] {
        let q = &self.0;
        [q.v.x, q.v.y, q.v.z, q.s]
    }
}

// 4×3 matrix (row-major?), total 12 floats
#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwMatrix43(
    // data in the .lab format is stored in row-major
    // we want to convert it to column-major
    #[br(map = |raw: [f32; 12]| Matrix4::new(
        raw[0], raw[3], raw[6], raw[9],
        raw[1], raw[4], raw[7], raw[10],
        raw[2], raw[5], raw[8], raw[11], 
        0.0, 0.0, 0.0, 1.0
    ))]

    // we want to convert it back to row-major while writing to the file again
    #[bw(map = |m: &Matrix4<f32>| [
        m.x.x, m.y.x, m.z.x, 
        m.w.x, m.x.y, m.y.y,
        m.z.y, m.w.y, m.x.z,
        m.y.z, m.z.z, m.w.z
    ])]
    Matrix4<f32>,
);

fn matrix4_to_quaternion(mat: Matrix4<f32>) -> Quaternion<f32> {
    let m00 = mat.x.x; let m01 = mat.y.x; let m02 = mat.z.x;
    let m10 = mat.x.y; let m11 = mat.y.y; let m12 = mat.z.y;
    let m20 = mat.x.z; let m21 = mat.y.z; let m22 = mat.z.z;

    let trace = m00 + m11 + m22;
    if trace > 0.0 {
        let s= 0.5 / (trace + 1.0).sqrt();
        let w= 0.25 / s;
        let x= (m21 - m12) * s;
        let y= (m02 - m20) * s;
        let z= (m10 - m01) * s;
        Quaternion::new(x, y, z, w).normalize()
    } else if m00 > m11 && m00 > m22 {
        let s = 2.0 * (1.0 + m00 - m11 - m22).sqrt();
        let inv_s = 1.0 / s;
        let w = (m21 - m12) * inv_s;
        let x = 0.25 * s;
        let y = (m01 + m10) * inv_s;
        let z = (m02 + m20) * inv_s;
        Quaternion::new(w, x, y, z).normalize()
    } else if m11 > m22 {
        let s = 2.0 * (1.0 + m11 - m00 - m22).sqrt();
        let inv_s = 1.0 / s;
        let w = (m02 - m20) * inv_s;
        let x = (m01 + m10) * inv_s;
        let y = 0.25 * s;
        let z = (m12 + m21) * inv_s;
        Quaternion::new(w, x, y, z).normalize()
    } else {
        let s = 2.0 * (1.0 + m22 - m00 - m11).sqrt();
        let inv_s = 1.0 / s;
        let w = (m10 - m01) * inv_s;
        let x = (m02 + m20) * inv_s;
        let y = (m12 + m21) * inv_s;
        let z = 0.25 * s;
        Quaternion::new(w, x, y, z).normalize()
    }
}

impl LwMatrix43 {
    pub fn to_translation_rotation_scale(&self) -> (LwVector3, LwQuaternion, LwVector3) {
        let translation = LwVector3(Vector3::new(self.0.x.z, self.0.y.z, self.0.z.z));

        let mut col0 = Vector3::new(self.0.x.x, self.0.y.x, self.0.z.x);
        let mut col1 = Vector3::new(self.0.x.y, self.0.y.y, self.0.z.y);
        let mut col2 = Vector3::new(self.0.x.z, self.0.y.z, self.0.z.z);

        let scale_x = col0.magnitude();
        let scale_y = col1.magnitude();
        let scale_z = col2.magnitude();
        let scale = LwVector3(Vector3::new(scale_x, scale_y, scale_z));

        if scale_x != 0.0 { col0 /= scale_x; }
        if scale_y != 0.0 { col1 /= scale_y; }
        if scale_z != 0.0 { col2 /= scale_z; }

        let rot_mat = Matrix4::new(
            col0.x, col1.x, col2.x, 0.0,
            col0.y, col1.y, col2.y, 0.0,
            col0.z, col1.z, col2.z, 0.0,
            0.0, 0.0, 0.0, 1.0
        );

        let rotation = matrix4_to_quaternion(rot_mat);

        (translation, LwQuaternion(rotation), scale)
    }
}

// 4×4 matrix, total 16 floats
#[binrw]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LwMatrix44(
    #[br(map = |raw: [f32; 16]| Matrix4::new(
        raw[0], raw[4], raw[8], raw[12],
        raw[1], raw[5], raw[9], raw[13],
        raw[2], raw[6], raw[10], raw[14],
        raw[3], raw[7], raw[11], raw[15]
    ))]
    #[bw(map = |m: &Matrix4<f32>| [
        m.x.x, m.y.x, m.z.x, m.w.x,
        m.x.y, m.y.y, m.z.y, m.w.y,
        m.x.z, m.y.z, m.z.z, m.w.z,
        m.x.w, m.y.w, m.z.w, m.w.w
    ])]
    Matrix4<f32>,
);

impl LwMatrix44 {
    pub fn to_slice(&self) -> [f32; 16] {
        let m = &self.0;
        [
            m.x.x, m.x.y, m.x.z, m.x.w, m.y.x, m.y.y, m.y.z, m.y.w, m.z.x, m.z.y, m.z.z, m.z.w,
            m.w.x, m.w.y, m.w.z, m.w.w,
        ]
    }

    pub fn to_row_major_slice(&self) -> [f32; 16] {
        let m = &self.0;
        [
            m.x.x, m.y.x, m.z.x, m.w.x, m.x.y, m.y.y, m.z.y, m.w.y, m.x.z, m.y.z, m.z.z, m.w.z,
            m.x.w, m.y.w, m.z.w, m.w.w,
        ]
    }

    pub fn to_translation_rotation_scale(&self) -> (LwVector3, LwQuaternion, LwVector3) {
        let translation = Vector3::new(self.0.x.z, self.0.y.z, self.0.z.z);

        let mut col0 = Vector3::new(self.0.x.x, self.0.y.x, self.0.z.x);
        let mut col1 = Vector3::new(self.0.x.y, self.0.y.y, self.0.z.y);
        let mut col2 = Vector3::new(self.0.x.z, self.0.y.z, self.0.z.z);

        let scale_x = col0.magnitude();
        let scale_y = col1.magnitude();
        let scale_z = col2.magnitude();
        let scale = LwVector3(Vector3::new(scale_x, scale_y, scale_z));

        if scale_x != 0.0 { col0 /= scale_x; }
        if scale_y != 0.0 { col1 /= scale_y; }
        if scale_z != 0.0 { col2 /= scale_z; }

        let rot_mat = Matrix4::new(
            col0.x, col1.x, col2.x, 0.0,
            col0.y, col1.y, col2.y, 0.0,
            col0.z, col1.z, col2.z, 0.0,
            0.0, 0.0, 0.0, 1.0
        );

        let rotation_quat = matrix4_to_quaternion(rot_mat);

        (LwVector3(translation) ,LwQuaternion(rotation_quat), scale)
    }
}

#[binrw]
#[derive(Debug, Clone, Default)]
#[br(little)]
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
        raw_name.copy_from_slice(&[0]);

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
#[br(import { frame_num: u32, key_type:  u32, version: u32, parent_id: u32 })]
pub struct LwBoneKeyInfo {
    #[br(default)]
    pub mat43_seq: Option<Vec<LwMatrix43>>,

    #[br(default)]
    pub mat44_seq: Option<Vec<LwMatrix44>>,

    #[br(default)]
    pub pos_seq: Option<Vec<LwVector3>>,

    #[br(default)]
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

pub struct LwBoneFileArgs<'a> {
    update_channel: &'a tokio::sync::mpsc::Sender<(String, u8)>,
}

impl BinRead for LwBoneFile {
    type Args<'a> = LwBoneFileArgs<'a>;

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        opts: binrw::Endian,
        args: Self::Args<'_>,
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

        args.update_channel
            .try_send(("Reading version".to_string(), 10));
        this.version = u32::read_options(reader, opts, ())?;

        if this.version == 0 {
            this.old_version = u32::read_options(reader, opts, ())?;
        }

        args.update_channel
            .try_send(("Reading header".to_string(), 20));
        this.header = LwBoneInfoHeader::read_options(reader, opts, ())?;

        args.update_channel
            .try_send(("Reading bone information".to_string(), 30));
        this.base_seq = Vec::read_options(
            reader,
            opts,
            binrw::VecArgs {
                count: this.header.bone_num as usize,
                inner: (),
            },
        )?;

        args.update_channel
            .try_send(("Reading initial position matrices".to_string(), 40));
        this.invmat_seq = Vec::read_options(
            reader,
            opts,
            binrw::VecArgs {
                count: this.header.bone_num as usize,
                inner: (),
            },
        )?;

        args.update_channel
            .try_send(("Reading dummy information".to_string(), 60));
        this.dummy_seq = Vec::read_options(
            reader,
            opts,
            binrw::VecArgs {
                count: this.header.dummy_num as usize,
                inner: (),
            },
        )?;

        args.update_channel
            .try_send(("Reading keyframe data".to_string(), 100));

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

impl LwBoneFile {
    fn get_node_rot_and_translation(
        &self,
        node_id: usize,
        frame: usize,
    ) -> Result<(LwQuaternion, LwVector3), String> {
        // let mut rot_seq = Vec::new();
        let key_seq = &self.key_seq[node_id];
        let key_type = &self.header.key_type;

        match *key_type {
            BONE_KEY_TYPE_MAT43 => {
                let key_seq = key_seq.mat43_seq.as_ref().unwrap();
                let mat = key_seq.get(frame).unwrap();
                let (translation, rotation, _scale) = mat.to_translation_rotation_scale();

                return Ok((rotation, translation));
            }

            BONE_KEY_TYPE_MAT44 => {
                let key_seq = key_seq.mat44_seq.as_ref().unwrap();
                let mat = key_seq.get(frame).unwrap();
                let (translation, rotation, _scale) = mat.to_translation_rotation_scale();

                return Ok((rotation, translation));
            }

            BONE_KEY_TYPE_QUAT => {
                let pos_seq = key_seq.pos_seq.as_ref().unwrap();
                let quat_seq = key_seq.quat_seq.as_ref().unwrap();

                let translation = pos_seq.get(frame).unwrap();
                let rotation = quat_seq.get(frame).unwrap();

                return Ok((rotation.clone(), translation.clone()));
            }
            _ => {}
        };

        Ok((LwQuaternion(Quaternion::new(0.0, 0.0, 0.0, 1.0)), LwVector3(Vector3::new(0.0, 0.0, 0.0))))
    }
    pub fn to_gltf(&self) {
        let mut bone_id_to_node_index = HashMap::new();
        let bone_num = self.header.bone_num as usize;

        let mut gltf_nodes = Vec::with_capacity(bone_num);

        for i in 0..bone_num {
            let base_info = &self.base_seq[i];
            let node_index = i;

            bone_id_to_node_index.insert(base_info.id, node_index);
            let (rotation, translation) = self.get_node_rot_and_translation(node_index, 0).unwrap();

            println!("Bone {} translation: {:?}", base_info.name, translation);
            println!("Bone {} rotation: {:?}", base_info.name, rotation);

            let node = Node {
                camera: None,
                children: None,
                matrix: None,
                rotation: Some(UnitQuaternion(rotation.to_slice())),
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


            let node = Node {
                camera: None,
                children: None,
                matrix: None,
                rotation: Some(UnitQuaternion(rotation.to_slice())),
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

        for i in 0..dummy_num {
            let dummy_info = &self.dummy_seq[i];
            let parent_bone_id = dummy_info.parent_bone_id;

            if let Some(&parent_node_index) = bone_id_to_node_index.get(&parent_bone_id) {
                let gltf_node = &mut gltf_nodes[parent_node_index];
                if gltf_node.children.is_none() {
                    gltf_node.children = Some(vec![Index::new((i + bone_num) as u32)]);
                } else if let Some(ref mut children) = gltf_node.children {
                    children.push(Index::new((i + bone_num) as u32));
                }
            }
        }

        // build the buffers and accessors for the initial bind pose inverse matrices
        let ibm_count = bone_num + dummy_num;
        // each inverse bind matrix is 4x4 of f32
        let ibm_byte_count = ibm_count * 16 * std::mem::size_of::<f32>();
        let mut buffer_data: Vec<u8> = Vec::with_capacity(ibm_byte_count);

        for i in 0..bone_num {
            let mat = &self.invmat_seq[i].to_slice();
            let mat_bytes = bytemuck::cast_slice(mat);

            buffer_data.extend_from_slice(mat_bytes);
        }

        for i in 0..dummy_num {
            let mat = &self.dummy_seq[i].mat.to_slice();
            let mat_bytes = bytemuck::cast_slice(mat);

            buffer_data.extend_from_slice(mat_bytes);
        }

        let mut buffer_views = Vec::new();
        let mut accessors = Vec::new();

        let ibm_buffer_view = View {
            buffer: Index::new(0),
            byte_length: USize64(ibm_byte_count as u64),
            byte_offset: Some(USize64(0)),
            byte_stride: None,
            target: None,
            extensions: None,
            extras: Default::default(),
            name: Some("InverseBindMatrices".to_string()),
        };

        let ibm_buffer_view_index: Index<View> = Index::new(buffer_views.len() as u32);
        buffer_views.push(ibm_buffer_view);

        let component_type = GenericComponentType(ComponentType::F32);

        let ibm_accessor = Accessor {
            buffer_view: Some(ibm_buffer_view_index),
            byte_offset: Some(USize64(0)),
            component_type: validation::Checked::Valid(component_type),
            count: USize64(ibm_count as u64),
            extensions: None,
            extras: Default::default(),
            max: None,
            min: None,
            name: Some("InverseBindAccessor".to_string()),
            normalized: false,
            sparse: None,
            type_: validation::Checked::Valid(Type::Mat4),
        };
        let ibm_accessor_index: Index<Accessor> = Index::new(accessors.len() as u32);
        accessors.push(ibm_accessor);

        let encoded = BASE64_STANDARD.encode(&buffer_data);
        let ibm_buffer = Buffer {
            byte_length: USize64(ibm_byte_count as u64),
            uri: Some(format!("data:application/octet-stream;base64,{}", encoded)),
            name: Some("InverseBindMatrices".to_string()),
            extensions: None,
            extras: Default::default(),
        };

        let skeleton_root = root_nodes.first().cloned();

        let skin = Skin {
            extensions: None,
            extras: None,
            joints: (0..bone_num).map(|i| Index::new(i as u32)).collect(),
            skeleton: skeleton_root,
            name: Some("TestSkin".to_string()),
            inverse_bind_matrices: Some(ibm_accessor_index),
        };

        let scene = Scene {
            name: Some("TestScene".to_string()),
            nodes: root_nodes,
            extensions: None,
            extras: Default::default(),
        };

        let root = Root {
            extensions: None,
            extras: Default::default(),
            accessors,
            animations: vec![],
            asset: Default::default(),
            buffers: vec![ibm_buffer],
            buffer_views,
            cameras: vec![],
            images: vec![],
            materials: vec![],
            meshes: vec![],
            nodes: gltf_nodes,
            samplers: vec![],
            scenes: vec![scene],
            scene: Some(Index::new(0)),
            extensions_used: vec![],
            extensions_required: vec![],
            skins: vec![skin],
            textures: vec![],
        };

        let file = File::create("test.gltf").unwrap();
        let writer = BufWriter::new(file);
        json::serialize::to_writer_pretty(writer, &root).unwrap();
    }
}

impl Character {
    pub fn new(animation_file_path: PathBuf) -> Self {
        Self {
            animation_file_path,
        }
    }

    pub fn load_animation(&self, update_channel: tokio::sync::mpsc::Sender<(String, u8)>) {
        println!("Loading animation from {:?}", self.animation_file_path);
        let file_path = self.animation_file_path.clone();
        tokio::task::spawn_blocking(move || {
            let mut file = std::fs::File::open(file_path).unwrap();
            println!("Opened file");
            println!("Reading file");
            let lw_bone_file: LwBoneFile = BinRead::read_options(
                &mut file,
                binrw::Endian::Little,
                LwBoneFileArgs {
                    update_channel: &update_channel,
                },
            )
            .unwrap();

            lw_bone_file.to_gltf();
        });
    }
}
