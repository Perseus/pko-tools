use std::collections::BTreeMap;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use base64::{prelude::BASE64_STANDARD, Engine};
use binrw::{BinRead, BinWrite};
use cgmath::{Matrix4, SquareMatrix, Vector3};
use ::gltf::json::{
    accessor::{ComponentType, GenericComponentType},
    image::MimeType,
    material::{AlphaMode, PbrBaseColorFactor, PbrMetallicRoughness, StrengthFactor},
    validation::{Checked, USize64},
    Accessor, Index,
};
use ::gltf::json as gltf;
use ::gltf::Semantic;
use serde::Deserialize;
use serde_json::value::RawValue;

use crate::animation::character::LW_INVALID_INDEX;
use crate::character::{
    helper::{BoundingSphereInfo, HelperData, HelperDummyInfo, HELPER_TYPE_BSPHERE, HELPER_TYPE_DUMMY},
    mesh::{
        CharacterInfoMeshHeader, CharacterMeshBlendInfo, CharacterMeshInfo,
        CharacterMeshSubsetInfo, D3DFVF_NORMAL, D3DFVF_TEX1, D3DFVF_XYZ,
    },
    model::{
        CharGeoModelInfoHeader, CharacterGeometricModel, EXP_OBJ_VERSION_1_0_0_5,
        GeomObjType, LW_RENDERCTRL_VS_FIXEDFUNCTION, RenderCtrlCreateInfo, StateCtrl,
    },
    texture::{
        CharMaterial, CharMaterialTextureInfo, ColorKeyType, ColorValue4F,
        LwColorValue4b, MaterialTextureInfoTransparencyType, RenderStateAtom, TextureInfo,
        TextureType,
    },
    GLTFFieldsToAggregate,
};
use crate::d3d::{D3DFormat, D3DPool, D3DPrimitiveType, D3DVertexElement9};
use crate::math::{LwMatrix44, LwSphere, LwVector2, LwVector3};

use super::{Item, ItemMetadata};

impl Item {
    /// Get glTF JSON for a specific model variant of this item.
    /// Item models are static meshes (no skeleton/skinning). Textures may be in
    /// a non-standard format, so we handle texture loading with fallback.
    pub fn get_gltf_json(&self, project_dir: &Path, model_id: &str) -> anyhow::Result<String> {
        if model_id == "0" || model_id.is_empty() {
            return Err(anyhow::anyhow!("No model available for this variant"));
        }

        let model_path = resolve_item_model_path(project_dir, model_id)
            .ok_or_else(|| anyhow::anyhow!("Item model file not found: {}.lgo", model_id))?;

        let geom = CharacterGeometricModel::from_file(model_path)?;

        let mesh_info = geom
            .mesh_info
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Item model has no mesh data"))?;

        let mut fields = GLTFFieldsToAggregate {
            buffer: vec![],
            buffer_view: vec![],
            accessor: vec![],
            image: vec![],
            texture: vec![],
            material: vec![],
            sampler: vec![],
            animation: vec![],
            skin: vec![],
            nodes: vec![],
        };

        let materials_vec = geom.material_seq.as_ref().map(|v| v.as_slice()).unwrap_or(&[]);

        // Split subsets: main weapon primitives (non-overlay) and glow overlay (subset 1)
        let (main_primitives, overlay_primitives) = build_item_primitives_split(
            project_dir,
            mesh_info,
            materials_vec,
            &mut fields,
        );

        let mut meshes = vec![];
        let mut all_nodes = vec![];
        let mut scene_nodes = vec![];

        // Main weapon mesh (subset 0 + any non-overlay subsets)
        meshes.push(gltf::Mesh {
            name: Some(model_id.to_string()),
            primitives: main_primitives,
            weights: None,
            extensions: None,
            extras: None,
        });
        all_nodes.push(gltf::Node {
            mesh: Some(gltf::Index::new(0)),
            name: Some(format!("Item_{}", model_id)),
            ..Default::default()
        });
        scene_nodes.push(gltf::Index::new(0));

        // Glow overlay mesh (subset 1) — separate node so extras propagate reliably
        if !overlay_primitives.is_empty() {
            let overlay_mesh_idx = meshes.len() as u32;
            meshes.push(gltf::Mesh {
                name: Some("glow_overlay_mesh".to_string()),
                primitives: overlay_primitives,
                weights: None,
                extensions: None,
                extras: None,
            });

            let overlay_node_idx = all_nodes.len() as u32;
            all_nodes.push(gltf::Node {
                mesh: Some(gltf::Index::new(overlay_mesh_idx)),
                name: Some("glow_overlay".to_string()),
                extras: Some(
                    RawValue::from_string(r#"{"glowOverlay":true}"#.to_string()).unwrap(),
                ),
                ..Default::default()
            });
            scene_nodes.push(gltf::Index::new(overlay_node_idx));
        }

        // Add helper nodes (dummy points, bounding spheres)
        let helper_nodes = geom.get_gltf_helper_nodes_for_mesh(0);
        let helper_start = all_nodes.len() as u32;
        for i in 0..helper_nodes.len() {
            scene_nodes.push(gltf::Index::new(helper_start + i as u32));
        }
        all_nodes.extend(helper_nodes);

        let scene = gltf::Scene {
            nodes: scene_nodes,
            name: Some("ItemScene".to_string()),
            extensions: None,
            extras: None,
        };

        let root = gltf::Root {
            asset: gltf::Asset {
                version: "2.0".to_string(),
                generator: Some("pko-tools".to_string()),
                ..Default::default()
            },
            nodes: all_nodes,
            scenes: vec![scene],
            scene: Some(gltf::Index::new(0)),
            accessors: fields.accessor,
            buffers: fields.buffer,
            buffer_views: fields.buffer_view,
            meshes,
            images: fields.image,
            textures: fields.texture,
            materials: fields.material,
            samplers: fields.sampler,
            ..Default::default()
        };

        let gltf_json = serde_json::to_string_pretty(&root)?;
        Ok(gltf_json)
    }

    /// Get metadata for this item's model
    pub fn get_metadata(&self, project_dir: &Path, model_id: &str) -> anyhow::Result<ItemMetadata> {
        let mut vertex_count = 0u32;
        let mut triangle_count = 0u32;
        let mut material_count = 0u32;
        let mut dummy_count = 0u32;
        let mut bspheres = 0u32;
        let mut bboxes = 0u32;

        if model_id != "0" && !model_id.is_empty() {
            if let Some(model_path) = resolve_item_model_path(project_dir, model_id) {
                if let Ok(geom) = CharacterGeometricModel::from_file(model_path) {
                    if let Some(ref mesh_info) = geom.mesh_info {
                        vertex_count = mesh_info.header.vertex_num;
                        triangle_count = mesh_info.header.index_num / 3;
                    }
                    if let Some(ref material_seq) = geom.material_seq {
                        material_count = material_seq.len() as u32;
                    }
                    if let Some(ref helper_data) = geom.helper_data {
                        dummy_count = helper_data.dummy_num;
                        bspheres = helper_data.bsphere_num;
                        bboxes = helper_data.bbox_num;
                    }
                }
            }
        }

        let mut available_models = vec![];
        let variants = [
            ("Ground", &self.model_ground),
            ("Lance", &self.model_lance),
            ("Carsise", &self.model_carsise),
            ("Phyllis", &self.model_phyllis),
            ("Ami", &self.model_ami),
        ];
        for (label, id) in variants {
            if id != "0" && !id.is_empty() {
                available_models.push(format!("{}: {}", label, id));
            }
        }

        Ok(ItemMetadata {
            item_id: self.id,
            item_name: self.name.clone(),
            item_type: self.item_type,
            model_id: model_id.to_string(),
            vertex_count,
            triangle_count,
            material_count,
            dummy_count,
            bounding_spheres: bspheres,
            bounding_boxes: bboxes,
            available_models,
        })
    }
}

/// Result returned from a successful item import.
pub struct ItemImportPaths {
    pub lgo_file: PathBuf,
    pub texture_files: Vec<PathBuf>,
}

/// Import a glTF file and write it as a PKO item .lgo model + .bmp textures.
///
/// Items are static meshes (no skeleton/animation). During export, subset 1 (glow overlay)
/// was split into a separate glTF mesh node. This function merges it back.
pub fn import_item_from_gltf(
    file_path: &Path,
    model_id: &str,
    output_dir: &Path,
) -> anyhow::Result<ItemImportPaths> {
    let (doc, buffers, images) = ::gltf::import(file_path)?;

    // ------------------------------------------------------------------
    // 1. Identify nodes by extras
    // ------------------------------------------------------------------
    let mut main_mesh_idx: Option<usize> = None;
    let mut overlay_mesh_idx: Option<usize> = None;
    let mut helper_nodes: Vec<::gltf::Node> = vec![];

    for node in doc.nodes() {
        if let Some(mesh) = node.mesh() {
            let is_overlay = node.extras().as_ref().map_or(false, |e| {
                e.get().contains("\"glowOverlay\"")
            });
            if is_overlay {
                overlay_mesh_idx = Some(mesh.index());
            } else if main_mesh_idx.is_none() {
                main_mesh_idx = Some(mesh.index());
            }
        } else if let Some(extras) = node.extras() {
            let text = extras.get();
            if text.contains("\"bounding_sphere\"") || text.contains("\"dummy\"") {
                helper_nodes.push(node);
            }
        }
    }

    let main_mesh_idx = main_mesh_idx
        .ok_or_else(|| anyhow::anyhow!("No main mesh node found in glTF"))?;

    // ------------------------------------------------------------------
    // 2. Read shared vertex data from the main mesh's first primitive
    // ------------------------------------------------------------------
    let main_mesh = doc.meshes().nth(main_mesh_idx)
        .ok_or_else(|| anyhow::anyhow!("Main mesh index {} not found", main_mesh_idx))?;
    let first_prim = main_mesh.primitives().next()
        .ok_or_else(|| anyhow::anyhow!("Main mesh has no primitives"))?;

    let mut vertex_seq: Vec<LwVector3> = vec![];
    let mut normal_seq: Vec<LwVector3> = vec![];
    let mut texcoord_seq: Vec<LwVector2> = vec![];

    for (semantic, accessor) in first_prim.attributes() {
        let view = accessor.view().ok_or_else(|| anyhow::anyhow!("Accessor has no buffer view"))?;
        let buf = &buffers[view.buffer().index()].0;
        let data = &buf[(accessor.offset() + view.offset())..];
        let mut reader = std::io::Cursor::new(data);

        match semantic {
            ::gltf::Semantic::Positions => {
                for _ in 0..accessor.count() {
                    vertex_seq.push(LwVector3::read_le(&mut reader)?);
                }
            }
            ::gltf::Semantic::Normals => {
                for _ in 0..accessor.count() {
                    normal_seq.push(LwVector3::read_le(&mut reader)?);
                }
            }
            ::gltf::Semantic::TexCoords(0) => {
                for _ in 0..accessor.count() {
                    texcoord_seq.push(LwVector2::read_le(&mut reader)?);
                }
            }
            _ => {} // Skip joints/weights/etc — items are static
        }
    }

    let vertex_num = vertex_seq.len() as u32;

    // ------------------------------------------------------------------
    // 3. Read indices from each primitive to reconstruct subsets
    //    Order: main primitives first, then insert glow overlay at index 1
    // ------------------------------------------------------------------
    struct SubsetData {
        indices: Vec<u32>,
        material_index: Option<usize>,
    }

    fn read_indices(
        primitive: &::gltf::Primitive,
        buffers: &[::gltf::buffer::Data],
    ) -> anyhow::Result<Vec<u32>> {
        let accessor = primitive.indices()
            .ok_or_else(|| anyhow::anyhow!("Primitive has no indices"))?;
        let view = accessor.view()
            .ok_or_else(|| anyhow::anyhow!("Index accessor has no buffer view"))?;
        let buf = &buffers[view.buffer().index()].0;
        let data = &buf[(accessor.offset() + view.offset())..];
        let mut reader = std::io::Cursor::new(data);
        let mut indices = Vec::with_capacity(accessor.count());

        match accessor.data_type() {
            ::gltf::accessor::DataType::U16 => {
                for _ in 0..accessor.count() {
                    indices.push(u16::read_le(&mut reader)? as u32);
                }
            }
            ::gltf::accessor::DataType::U32 => {
                for _ in 0..accessor.count() {
                    indices.push(u32::read_le(&mut reader)?);
                }
            }
            dt => return Err(anyhow::anyhow!("Unsupported index data type: {:?}", dt)),
        }
        Ok(indices)
    }

    let mut main_subsets: Vec<SubsetData> = vec![];
    for prim in main_mesh.primitives() {
        main_subsets.push(SubsetData {
            indices: read_indices(&prim, &buffers)?,
            material_index: prim.material().index(),
        });
    }

    let overlay_subsets: Vec<SubsetData> = if let Some(ov_idx) = overlay_mesh_idx {
        let ov_mesh = doc.meshes().nth(ov_idx)
            .ok_or_else(|| anyhow::anyhow!("Overlay mesh index {} not found", ov_idx))?;
        let mut subs = vec![];
        for prim in ov_mesh.primitives() {
            subs.push(SubsetData {
                indices: read_indices(&prim, &buffers)?,
                material_index: prim.material().index(),
            });
        }
        subs
    } else {
        vec![]
    };

    // Merge: [main_subset_0, overlay_subset(s), main_subset_1, main_subset_2, ...]
    let mut all_subsets: Vec<SubsetData> = vec![];
    if !main_subsets.is_empty() {
        all_subsets.push(main_subsets.remove(0)); // subset 0
    }
    all_subsets.extend(overlay_subsets); // subset 1 (glow overlay)
    all_subsets.extend(main_subsets);    // remaining subsets

    // Build unified index_seq and subset_seq
    let mut index_seq: Vec<u32> = vec![];
    let mut subset_seq: Vec<CharacterMeshSubsetInfo> = vec![];
    for sd in &all_subsets {
        let start_index = index_seq.len() as u32;
        let tri_count = (sd.indices.len() / 3) as u32;
        // Compute vertex_num for this subset (number of unique vertices referenced)
        let min_idx = sd.indices.iter().copied().min().unwrap_or(0);
        let max_idx = sd.indices.iter().copied().max().unwrap_or(0);
        let subset_vert_count = if sd.indices.is_empty() { 0 } else { max_idx - min_idx + 1 };
        subset_seq.push(CharacterMeshSubsetInfo {
            start_index,
            primitive_num: tri_count,
            vertex_num: subset_vert_count,
            min_index: min_idx,
        });
        index_seq.extend_from_slice(&sd.indices);
    }

    let index_num = index_seq.len() as u32;

    // ------------------------------------------------------------------
    // 4. Extract textures and build material sequence
    // ------------------------------------------------------------------
    let texture_dir = output_dir.join("texture");
    std::fs::create_dir_all(&texture_dir)?;

    let mut material_seq: Vec<CharMaterialTextureInfo> = vec![];
    let mut texture_files: Vec<PathBuf> = vec![];

    // Track which texture files we've already written (by glTF image index)
    let mut written_textures: std::collections::HashMap<usize, (PathBuf, [u8; 64])> =
        std::collections::HashMap::new();

    // Build one material per subset (1:1 mapping required by .lgo format).
    // Multiple subsets may reference the same glTF material — that's fine,
    // we create duplicate material entries so material_seq[i] matches subset_seq[i].
    for sd in &all_subsets {
        let mut mtl = CharMaterialTextureInfo::new();
        mtl.transp_type = MaterialTextureInfoTransparencyType::Filter;
        mtl.opacity = 1.0;

        if let Some(mat_idx) = sd.material_index {
            if let Some(gltf_mat) = doc.materials().nth(mat_idx) {
                let roughness = gltf_mat.pbr_metallic_roughness();
                let base_color = roughness.base_color_factor();
                let emissive = gltf_mat.emissive_factor();

                mtl.material = CharMaterial {
                    dif: ColorValue4F { r: base_color[0], g: base_color[1], b: base_color[2], a: base_color[3] },
                    amb: ColorValue4F { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
                    spe: Some(ColorValue4F { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }),
                    emi: Some(ColorValue4F { r: emissive[0], g: emissive[1], b: emissive[2], a: 0.0 }),
                    power: 0.0,
                };

                // Extract texture image if present
                if let Some(tex_info) = roughness.base_color_texture() {
                    let img_source = tex_info.texture().source();
                    let img_idx = img_source.index();

                    if let Some((_, cached_name)) = written_textures.get(&img_idx) {
                        // Texture already written — reuse the file name
                        mtl.tex_seq[0] = TextureInfo {
                            stage: 0,
                            level: u32::MAX,
                            usage: 0,
                            d3d_format: D3DFormat::Unknown,
                            d3d_pool: D3DPool::Managed,
                            _type: TextureType::File,
                            colorkey: LwColorValue4b::from_color(0),
                            colorkey_type: ColorKeyType::None,
                            data: 0,
                            byte_alignment_flag: 0,
                            file_name: *cached_name,
                            width: 0,
                            height: 0,
                            tss_set: [RenderStateAtom::new(); 8],
                        };
                    } else if let Some(img_data) = images.get(img_idx) {
                        // Determine texture file name from glTF image name or generate one
                        let tex_name = img_source.name()
                            .map(|n| n.to_string())
                            .unwrap_or_else(|| format!("{}_{}", model_id, mat_idx));

                        let bmp_path = texture_dir.join(format!("{}.bmp", tex_name));

                        // Convert gltf image data to a DynamicImage, then save as BMP
                        let dyn_img = image_from_gltf_data(img_data)?;
                        let mut bmp_buf: Vec<u8> = vec![];
                        dyn_img.write_to(
                            &mut std::io::Cursor::new(&mut bmp_buf),
                            image::ImageFormat::Bmp,
                        )?;

                        // PKO-encode and write
                        let encoded = encode_pko_texture(&bmp_buf);
                        std::fs::write(&bmp_path, &encoded)?;
                        texture_files.push(bmp_path.clone());

                        // Set texture info in material
                        let mut file_name_bytes = [0u8; 64];
                        let name_str = format!("{}.bmp", tex_name);
                        for (i, b) in name_str.bytes().enumerate().take(63) {
                            file_name_bytes[i] = b;
                        }
                        mtl.tex_seq[0] = TextureInfo {
                            stage: 0,
                            level: u32::MAX,
                            usage: 0,
                            d3d_format: D3DFormat::Unknown,
                            d3d_pool: D3DPool::Managed,
                            _type: TextureType::File,
                            colorkey: LwColorValue4b::from_color(0),
                            colorkey_type: ColorKeyType::None,
                            data: 0,
                            byte_alignment_flag: 0,
                            file_name: file_name_bytes,
                            width: 0,
                            height: 0,
                            tss_set: [RenderStateAtom::new(); 8],
                        };

                        written_textures.insert(img_idx, (bmp_path, file_name_bytes));
                    }
                }
            }
        }

        material_seq.push(mtl);
    }

    // Ensure at least one material exists
    if material_seq.is_empty() {
        material_seq.push(CharMaterialTextureInfo::new());
    }

    // ------------------------------------------------------------------
    // 5. Build helper data from glTF nodes
    // ------------------------------------------------------------------
    let mut helper_type: u32 = 0;
    let mut dummy_seq: Vec<HelperDummyInfo> = vec![];
    let mut bsphere_seq: Vec<BoundingSphereInfo> = vec![];

    #[derive(Deserialize)]
    struct DummyExtras {
        id: u32,
        parent_type: u32,
        parent_id: u32,
        r#type: String,
    }

    #[derive(Deserialize)]
    struct BsphereExtras {
        id: u32,
        radius: f32,
        center: [f32; 3],
        r#type: String,
    }

    for node in &helper_nodes {
        let extras_str = node.extras().as_ref().unwrap().get();
        let mat_array = node.transform().matrix();
        let mat = LwMatrix44(Matrix4::new(
            mat_array[0][0], mat_array[0][1], mat_array[0][2], mat_array[0][3],
            mat_array[1][0], mat_array[1][1], mat_array[1][2], mat_array[1][3],
            mat_array[2][0], mat_array[2][1], mat_array[2][2], mat_array[2][3],
            mat_array[3][0], mat_array[3][1], mat_array[3][2], mat_array[3][3],
        ));

        if let Ok(dummy) = serde_json::from_str::<DummyExtras>(extras_str) {
            if dummy.r#type == "dummy" {
                helper_type |= HELPER_TYPE_DUMMY;
                dummy_seq.push(HelperDummyInfo {
                    id: dummy.id,
                    mat,
                    mat_local: LwMatrix44(Matrix4::identity()),
                    parent_type: dummy.parent_type,
                    parent_id: dummy.parent_id,
                });
                continue;
            }
        }
        if let Ok(bs) = serde_json::from_str::<BsphereExtras>(extras_str) {
            if bs.r#type == "bounding_sphere" {
                helper_type |= HELPER_TYPE_BSPHERE;
                bsphere_seq.push(BoundingSphereInfo {
                    id: bs.id,
                    sphere: LwSphere {
                        c: LwVector3(Vector3::new(bs.center[0], bs.center[1], bs.center[2])),
                        r: bs.radius,
                    },
                    mat,
                });
            }
        }
    }

    // Default to BSPHERE type if no helpers found (matches character import)
    if helper_type == 0 {
        helper_type = HELPER_TYPE_BSPHERE;
    }

    let helper_data = HelperData {
        _type: helper_type,
        dummy_num: dummy_seq.len() as u32,
        dummy_seq,
        box_num: 0,
        box_seq: vec![],
        mesh_num: 0,
        mesh_seq: vec![],
        bbox_num: 0,
        bbox_seq: vec![],
        bsphere_num: bsphere_seq.len() as u32,
        bsphere_seq,
    };

    // ------------------------------------------------------------------
    // 6. Build vertex element sequence for static mesh (no blend weights)
    // ------------------------------------------------------------------
    let fvf = D3DFVF_XYZ | D3DFVF_NORMAL | D3DFVF_TEX1; // 0x112 = 274
    let mut vertex_element_seq: Vec<D3DVertexElement9> = vec![];
    let mut offset: u16 = 0;

    // POSITION (float3)
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0, offset, _type: 2, method: 0, usage: 0, usage_index: 0,
    });
    offset += 12;

    // NORMAL (float3)
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0, offset, _type: 2, method: 0, usage: 3, usage_index: 0,
    });
    offset += 12;

    // TEXCOORD (float2)
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0, offset, _type: 1, method: 0, usage: 5, usage_index: 0,
    });

    // D3DDECL_END
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0xFF, offset: 0, _type: 17, method: 0, usage: 0, usage_index: 0,
    });

    // ------------------------------------------------------------------
    // 7. Compute sizes for the header
    // ------------------------------------------------------------------
    let mtl_size = {
        let mut size = std::mem::size_of::<u32>(); // material_num field
        for mat in &material_seq {
            size += std::mem::size_of_val(&mat.opacity);
            size += std::mem::size_of_val(&mat.transp_type);
            size += std::mem::size_of_val(&mat.material);
            size += std::mem::size_of_val(&mat.rs_set);
            size += std::mem::size_of_val(&mat.tex_seq);
        }
        size as u32
    };

    // mesh_size: header + vertex_elements + vertices + normals + texcoords + indices + subsets
    let mesh_size = {
        let header_size = std::mem::size_of::<CharacterInfoMeshHeader>();
        let ve_size = vertex_element_seq.len() * std::mem::size_of::<D3DVertexElement9>();
        let vert_size = vertex_seq.len() * std::mem::size_of::<LwVector3>();
        let norm_size = normal_seq.len() * std::mem::size_of::<LwVector3>();
        let tc_size = texcoord_seq.len() * std::mem::size_of::<LwVector2>();
        let idx_size = index_seq.len() * std::mem::size_of::<u32>();
        let sub_size = subset_seq.len() * std::mem::size_of::<CharacterMeshSubsetInfo>();
        (header_size + ve_size + vert_size + norm_size + tc_size + idx_size + sub_size) as u32
    };

    // helper_size: _type(4) + for each section: num(4) + data
    let helper_size = {
        let mut size = 4u32; // _type field
        if helper_data._type & HELPER_TYPE_DUMMY > 0 {
            size += 4; // dummy_num
            // HelperDummyInfo: id(4) + mat(64) + mat_local(64) + parent_type(4) + parent_id(4) = 140
            size += helper_data.dummy_num * 140;
        }
        if helper_data._type & HELPER_TYPE_BSPHERE > 0 {
            size += 4; // bsphere_num
            // BoundingSphereInfo: id(4) + sphere(16) + mat(64) = 84
            size += helper_data.bsphere_num * 84;
        }
        size
    };

    // ------------------------------------------------------------------
    // 8. Assemble CharacterGeometricModel and write .lgo
    // ------------------------------------------------------------------
    let mesh_info = CharacterMeshInfo {
        header: CharacterInfoMeshHeader {
            fvf,
            pt_type: D3DPrimitiveType::TriangleList,
            vertex_num,
            index_num,
            subset_num: subset_seq.len() as u32,
            bone_index_num: 0,
            bone_infl_factor: 0,
            vertex_element_num: vertex_element_seq.len() as u32,
            rs_set: [RenderStateAtom::new(); 8],
        },
        vertex_seq,
        normal_seq,
        texcoord_seq: [texcoord_seq, vec![], vec![], vec![]],
        vercol_seq: vec![],
        index_seq,
        bone_index_seq: vec![],
        blend_seq: vec![],
        subset_seq,
        vertex_element_seq,
    };

    let geom = CharacterGeometricModel {
        version: EXP_OBJ_VERSION_1_0_0_5,
        header: CharGeoModelInfoHeader {
            id: 0,
            parent_id: LW_INVALID_INDEX,
            _type: GeomObjType::Generic as u32,
            mat_local: LwMatrix44(Matrix4::identity()),
            rcci: RenderCtrlCreateInfo {
                ctrl_id: LW_RENDERCTRL_VS_FIXEDFUNCTION,
                decl_id: 3,
                vs_id: LW_INVALID_INDEX,
                ps_id: LW_INVALID_INDEX,
            },
            state_ctrl: StateCtrl {
                _state_seq: [1, 1, 0, 0, 0, 0, 0, 0],
            },
            mtl_size,
            mesh_size,
            helper_size,
            anim_size: 0,
        },
        old_version: 0,
        material_num: material_seq.len() as u32,
        material_seq: Some(material_seq),
        mesh_info: Some(mesh_info),
        helper_data: Some(helper_data),
    };

    let model_dir = output_dir.join("model");
    std::fs::create_dir_all(&model_dir)?;
    let lgo_path = model_dir.join(format!("{}.lgo", model_id));
    let file = std::fs::File::create(&lgo_path)?;
    let mut writer = BufWriter::new(file);
    geom.write_le(&mut writer)?;

    Ok(ItemImportPaths {
        lgo_file: lgo_path,
        texture_files,
    })
}

/// Convert glTF image data to a DynamicImage.
fn image_from_gltf_data(img_data: &::gltf::image::Data) -> anyhow::Result<image::DynamicImage> {
    use image::{DynamicImage, ImageBuffer, Rgba, Rgb};

    match img_data.format {
        ::gltf::image::Format::R8G8B8 => {
            let img = ImageBuffer::<Rgb<u8>, _>::from_raw(
                img_data.width, img_data.height, img_data.pixels.clone(),
            ).ok_or_else(|| anyhow::anyhow!("Failed to create RGB image buffer"))?;
            Ok(DynamicImage::ImageRgb8(img))
        }
        ::gltf::image::Format::R8G8B8A8 => {
            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(
                img_data.width, img_data.height, img_data.pixels.clone(),
            ).ok_or_else(|| anyhow::anyhow!("Failed to create RGBA image buffer"))?;
            Ok(DynamicImage::ImageRgba8(img))
        }
        other => Err(anyhow::anyhow!("Unsupported glTF image format: {:?}", other)),
    }
}

/// Build glTF primitives for an item mesh, split into main primitives and glow overlay.
///
/// Returns `(main_primitives, overlay_primitives)`:
/// - `main_primitives`: all subsets except index 1 (the glow overlay)
/// - `overlay_primitives`: subset 1 only (empty if no subset 1 exists)
///
/// In the game, subset 1 is the glow overlay mesh (blade overlay), hidden by default
/// via `CSceneItem::LitUnresetTexture()` → `SetRenderFlag(FALSE)`. It only becomes
/// visible when a lit effect is applied. We separate it so the frontend can manage it
/// as a distinct node with reliable extras propagation.
fn build_item_primitives_split(
    project_dir: &Path,
    mesh_info: &CharacterMeshInfo,
    materials_vec: &[CharMaterialTextureInfo],
    fields: &mut GLTFFieldsToAggregate,
) -> (Vec<gltf::mesh::Primitive>, Vec<gltf::mesh::Primitive>) {
    // Shared vertex data (positions, normals, UVs) — created once, referenced by all primitives
    let pos_idx = mesh_info.get_vertex_position_accessor(fields);
    let norm_idx = mesh_info.get_vertex_normal_accessor(fields);
    let tc_idx = if !mesh_info.texcoord_seq[0].is_empty() {
        Some(mesh_info.get_vertex_texcoord_accessor(fields, 0))
    } else {
        None
    };

    let mode = match &mesh_info.header.pt_type {
        crate::d3d::D3DPrimitiveType::TriangleList => gltf::mesh::Mode::Triangles,
        crate::d3d::D3DPrimitiveType::TriangleStrip => gltf::mesh::Mode::TriangleStrip,
        _ => gltf::mesh::Mode::Triangles,
    };

    let build_attributes = || {
        let mut attrs = BTreeMap::from([
            (Checked::Valid(Semantic::Positions), Index::new(pos_idx as u32)),
            (Checked::Valid(Semantic::Normals), Index::new(norm_idx as u32)),
        ]);
        if let Some(tc) = tc_idx {
            attrs.insert(Checked::Valid(Semantic::TexCoords(0)), Index::new(tc as u32));
        }
        attrs
    };

    if mesh_info.subset_seq.is_empty() {
        // No subsets — single primitive with all indices and first material
        let idx_acc = mesh_info.get_vertex_index_accessor(fields);
        let mat_idx = build_single_material(project_dir, materials_vec.first(), fields);
        return (vec![gltf::mesh::Primitive {
            attributes: build_attributes(),
            indices: Some(Index::new(idx_acc as u32)),
            material: Some(Index::new(mat_idx as u32)),
            mode: Checked::Valid(mode),
            targets: None,
            extensions: None,
            extras: None,
        }], vec![]);
    }

    let mut main_prims = Vec::new();
    let mut overlay_prims = Vec::new();

    for (si, subset) in mesh_info.subset_seq.iter().enumerate() {
        let start = subset.start_index as usize;
        let count = (subset.primitive_num * 3) as usize;
        let end = (start + count).min(mesh_info.index_seq.len());
        let subset_indices = &mesh_info.index_seq[start..end];

        let idx_acc = create_index_accessor(subset_indices, si, fields);
        let is_glow_overlay = si == 1;

        // For glow overlay (subset 1), use material 0's texture instead of
        // its placeholder. The game replaces the texture at runtime with the
        // lit texture from item.lit.
        let mat = if is_glow_overlay {
            materials_vec.first()
        } else {
            materials_vec.get(si)
        };
        let mat_idx = build_single_material(project_dir, mat, fields);

        if is_glow_overlay {
            // Make overlay material fully transparent so it's invisible in
            // standard glTF viewers. The app's renderer hides this node and
            // re-renders it with a custom shader when forge effects are active.
            let overlay_mat = &mut fields.material[mat_idx];
            overlay_mat.alpha_mode = Checked::Valid(AlphaMode::Blend);
            overlay_mat.pbr_metallic_roughness.base_color_factor =
                PbrBaseColorFactor([1.0, 1.0, 1.0, 0.0]);
        }

        let prim = gltf::mesh::Primitive {
            attributes: build_attributes(),
            indices: Some(Index::new(idx_acc as u32)),
            material: Some(Index::new(mat_idx as u32)),
            mode: Checked::Valid(mode),
            targets: None,
            extensions: None,
            extras: None,
        };

        if is_glow_overlay {
            overlay_prims.push(prim);
        } else {
            main_prims.push(prim);
        }
    }

    (main_prims, overlay_prims)
}

/// Create a glTF index accessor for a slice of indices.
fn create_index_accessor(
    indices: &[u32],
    label: usize,
    fields: &mut GLTFFieldsToAggregate,
) -> usize {
    let buffer_index = fields.buffer.len();
    let buffer_view_index = fields.buffer_view.len();
    let accessor_index = fields.accessor.len();

    let mut data = Vec::with_capacity(indices.len() * 4);
    for idx in indices {
        data.extend_from_slice(&idx.to_le_bytes());
    }

    fields.buffer.push(gltf::Buffer {
        byte_length: USize64(data.len() as u64),
        extensions: None,
        extras: None,
        name: Some(format!("indices_buffer_{}", label)),
        uri: Some(format!(
            "data:application/octet-stream;base64,{}",
            BASE64_STANDARD.encode(&data)
        )),
    });

    fields.buffer_view.push(gltf::buffer::View {
        buffer: Index::new(buffer_index as u32),
        byte_length: USize64(data.len() as u64),
        byte_offset: Some(USize64(0)),
        target: Some(Checked::Valid(gltf::buffer::Target::ElementArrayBuffer)),
        byte_stride: None,
        extensions: None,
        extras: None,
        name: Some(format!("indices_view_{}", label)),
    });

    fields.accessor.push(Accessor {
        buffer_view: Some(Index::new(buffer_view_index as u32)),
        byte_offset: Some(USize64(0)),
        component_type: Checked::Valid(GenericComponentType(ComponentType::U32)),
        count: USize64(indices.len() as u64),
        extensions: None,
        extras: None,
        max: None,
        min: None,
        name: Some(format!("indices_accessor_{}", label)),
        normalized: false,
        sparse: None,
        type_: Checked::Valid(gltf::accessor::Type::Scalar),
    });

    accessor_index
}

/// Build a glTF material from a single CharMaterialTextureInfo.
/// Tries to load the texture from disk; falls back to color-only material.
fn build_single_material(
    project_dir: &Path,
    mat_info: Option<&CharMaterialTextureInfo>,
    fields: &mut GLTFFieldsToAggregate,
) -> usize {
    let material_index = fields.material.len();

    // Extract texture file name from the first valid texture slot
    let texture_file_name = mat_info.and_then(|mat| {
        mat.tex_seq
            .iter()
            .find(|tex| tex.stage != LW_INVALID_INDEX)
            .map(|tex| {
                let mut name = String::new();
                for &b in tex.file_name.iter() {
                    if b == 0 || b == b'.' {
                        break;
                    }
                    name.push(b as char);
                }
                name
            })
    });

    // Try to find and load the texture
    let mut texture_loaded = false;
    if let Some(ref tex_name) = texture_file_name {
        if !tex_name.is_empty() {
            let dirs = ["texture/item", "texture/character", "texture"];
            let exts = ["bmp", "tga", "dds", "png"];

            'search: for dir in &dirs {
                for ext in &exts {
                    let candidate = project_dir.join(dir).join(tex_name).with_extension(ext);
                    if !candidate.exists() {
                        continue;
                    }
                    if let Ok(raw_bytes) = std::fs::read(&candidate) {
                        let decoded = decode_pko_texture(&raw_bytes);
                        if let Ok(img) = image::load_from_memory(&decoded) {
                            let mut png_data = Vec::new();
                            let mut cursor = std::io::Cursor::new(&mut png_data);
                            if img
                                .write_to(&mut cursor, image::ImageFormat::Png)
                                .is_ok()
                            {
                                let data_uri = format!(
                                    "data:image/png;base64,{}",
                                    BASE64_STANDARD.encode(&png_data)
                                );

                                let image_index = fields.image.len();
                                fields.image.push(gltf::Image {
                                    name: Some(tex_name.clone()),
                                    buffer_view: None,
                                    extensions: None,
                                    mime_type: Some(MimeType("image/png".to_string())),
                                    extras: None,
                                    uri: Some(data_uri),
                                });

                                let sampler_index = fields.sampler.len();
                                fields.sampler.push(gltf::texture::Sampler {
                                    mag_filter: Some(Checked::Valid(
                                        ::gltf::texture::MagFilter::Linear,
                                    )),
                                    min_filter: Some(Checked::Valid(
                                        gltf::texture::MinFilter::LinearMipmapLinear,
                                    )),
                                    wrap_s: Checked::Valid(
                                        gltf::texture::WrappingMode::Repeat,
                                    ),
                                    wrap_t: Checked::Valid(
                                        gltf::texture::WrappingMode::Repeat,
                                    ),
                                    ..Default::default()
                                });

                                let texture_index = fields.texture.len();
                                fields.texture.push(gltf::Texture {
                                    name: Some(tex_name.clone()),
                                    sampler: Some(Index::new(sampler_index as u32)),
                                    source: Index::new(image_index as u32),
                                    extensions: None,
                                    extras: None,
                                });

                                let (base_color, emissive) = extract_material_colors(mat_info);

                                fields.material.push(gltf::Material {
                                    pbr_metallic_roughness: PbrMetallicRoughness {
                                        base_color_factor: PbrBaseColorFactor(base_color),
                                        base_color_texture: Some(gltf::texture::Info {
                                            index: Index::new(texture_index as u32),
                                            tex_coord: 0,
                                            extensions: None,
                                            extras: None,
                                        }),
                                        metallic_factor: StrengthFactor(0.0),
                                        roughness_factor: StrengthFactor(0.8),
                                        metallic_roughness_texture: None,
                                        extensions: None,
                                        extras: None,
                                    },
                                    emissive_factor: gltf::material::EmissiveFactor(emissive),
                                    ..Default::default()
                                });

                                texture_loaded = true;
                                break 'search;
                            }
                        }
                    }
                }
            }
        }
    }

    // Fallback: color-only material
    if !texture_loaded {
        let (base_color, emissive) = extract_material_colors(mat_info);
        fields.material.push(gltf::Material {
            pbr_metallic_roughness: PbrMetallicRoughness {
                base_color_factor: PbrBaseColorFactor(base_color),
                base_color_texture: None,
                metallic_factor: StrengthFactor(0.0),
                roughness_factor: StrengthFactor(0.8),
                metallic_roughness_texture: None,
                extensions: None,
                extras: None,
            },
            emissive_factor: gltf::material::EmissiveFactor(emissive),
            ..Default::default()
        });
    }

    material_index
}

/// Extract base color and emissive factor from material info.
fn extract_material_colors(mat_info: Option<&CharMaterialTextureInfo>) -> ([f32; 4], [f32; 3]) {
    mat_info
        .map(|mat| {
            let dif = &mat.material.dif;
            let emi = mat.material.emi.as_ref();
            (
                [dif.r, dif.g, dif.b, dif.a],
                emi.map(|e| [e.r, e.g, e.b]).unwrap_or([0.0, 0.0, 0.0]),
            )
        })
        .unwrap_or(([0.7, 0.7, 0.7, 1.0], [0.0, 0.0, 0.0]))
}

/// Decode a PKO-encoded texture file.
/// PKO uses a simple obfuscation: swap the first 44 bytes with the last 44 bytes,
/// then append a 4-byte "mp.x" marker. If the marker is present, reverse the process
/// to recover the original BMP/TGA/DDS data.
fn decode_pko_texture(data: &[u8]) -> Vec<u8> {
    const MARKER: &[u8; 4] = b"mp.x";
    const SWAP_SIZE: usize = 44;

    if data.len() > SWAP_SIZE + MARKER.len() && &data[data.len() - 4..] == MARKER {
        // Remove the 4-byte marker, then swap first/last 44 bytes
        let trimmed = &data[..data.len() - 4];
        let mut decoded = trimmed.to_vec();
        let len = decoded.len();
        if len >= SWAP_SIZE * 2 {
            let (first, rest) = decoded.split_at_mut(SWAP_SIZE);
            let last_start = rest.len() - SWAP_SIZE;
            let last = &mut rest[last_start..];
            // Swap in place
            for i in 0..SWAP_SIZE {
                std::mem::swap(&mut first[i], &mut last[i]);
            }
        }
        decoded
    } else {
        data.to_vec()
    }
}

/// Encode raw BMP data into PKO-obfuscated texture format.
/// Inverse of `decode_pko_texture`: swap first/last 44 bytes, then append "mp.x" marker.
pub fn encode_pko_texture(data: &[u8]) -> Vec<u8> {
    const MARKER: &[u8; 4] = b"mp.x";
    const SWAP_SIZE: usize = 44;

    let mut encoded = data.to_vec();
    let len = encoded.len();
    if len >= SWAP_SIZE * 2 {
        let (first, rest) = encoded.split_at_mut(SWAP_SIZE);
        let last_start = rest.len() - SWAP_SIZE;
        let last = &mut rest[last_start..];
        for i in 0..SWAP_SIZE {
            std::mem::swap(&mut first[i], &mut last[i]);
        }
    }
    encoded.extend_from_slice(MARKER);
    encoded
}

/// Resolve an item model .lgo path with case-insensitive matching.
fn resolve_item_model_path(project_dir: &Path, model_id: &str) -> Option<PathBuf> {
    let target = format!("{}.lgo", model_id).to_lowercase();

    // Check model/item/ directory
    let item_dir = project_dir.join("model/item");
    if item_dir.exists() {
        for entry in std::fs::read_dir(&item_dir).ok()?.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.to_lowercase() == target {
                    return Some(entry.path());
                }
            }
        }
    }

    // Fallback: check model/character/ directory (some items share character models)
    let char_dir = project_dir.join("model/character");
    if char_dir.exists() {
        let padded_target = format!("{:0>10}.lgo", model_id).to_lowercase();
        for entry in std::fs::read_dir(&char_dir).ok()?.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                let lower = file_name.to_lowercase();
                if lower == target || lower == padded_target {
                    return Some(entry.path());
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_pko_texture_round_trip() {
        // Create fake BMP data large enough for the 44-byte swap
        let mut original = vec![0u8; 256];
        for (i, byte) in original.iter_mut().enumerate() {
            *byte = (i % 256) as u8;
        }

        let encoded = encode_pko_texture(&original);
        // Encoded should be 4 bytes longer (mp.x marker)
        assert_eq!(encoded.len(), original.len() + 4);
        assert_eq!(&encoded[encoded.len() - 4..], b"mp.x");

        let decoded = decode_pko_texture(&encoded);
        assert_eq!(decoded, original);
    }

    #[test]
    fn encode_decode_small_data() {
        // Data smaller than 88 bytes (2 * SWAP_SIZE) — no swap occurs
        let original = vec![42u8; 50];
        let encoded = encode_pko_texture(&original);
        let decoded = decode_pko_texture(&encoded);
        assert_eq!(decoded, original);
    }
}
