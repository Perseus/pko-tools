use std::collections::BTreeMap;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use base64::{prelude::BASE64_STANDARD, Engine};
use binrw::{BinRead, BinWrite};
use cgmath::{Matrix4, SquareMatrix, Vector3};
use gltf::json as gltf;
use gltf::{
    accessor::{ComponentType, GenericComponentType},
    image::MimeType,
    material::{AlphaMode, PbrBaseColorFactor, PbrMetallicRoughness, StrengthFactor},
    validation::{Checked, USize64},
    Accessor, Index,
};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::animation::character::LW_INVALID_INDEX;
use crate::character::{
    helper::{
        BoundingSphereInfo, HelperData, HelperDummyInfo, HELPER_TYPE_BSPHERE, HELPER_TYPE_DUMMY,
    },
    mesh::{
        CharacterInfoMeshHeader, CharacterMeshBlendInfo, CharacterMeshInfo,
        CharacterMeshSubsetInfo, D3DFVF_DIFFUSE, D3DFVF_NORMAL, D3DFVF_TEX1, D3DFVF_XYZ,
    },
    model::{
        CharGeoModelInfoHeader, CharacterGeometricModel, GeomObjType, RenderCtrlCreateInfo,
        StateCtrl, EXP_OBJ_VERSION_1_0_0_5, LW_RENDERCTRL_VS_FIXEDFUNCTION,
    },
    texture::{
        CharMaterial, CharMaterialTextureInfo, ColorKeyType, ColorValue4F, LwColorValue4b,
        MaterialTextureInfoTransparencyType, RenderStateAtom, TextureInfo, TextureType,
    },
    GLTFFieldsToAggregate,
};
use crate::d3d::{D3DFormat, D3DPool, D3DPrimitiveType, D3DVertexElement9};
use crate::math::{LwMatrix44, LwSphere, LwVector2, LwVector3};

use super::{Item, ItemMetadata};

// ---------- PKO round-trip extras structs ----------

/// Stored as node extras on the main mesh node.
#[derive(Serialize, Deserialize, Debug)]
struct PkoModelExtras {
    pko_version: u32,
    pko_model: PkoModelHeaderExtras,
}

/// Model header properties that need to survive a glTF round-trip.
#[derive(Serialize, Deserialize, Debug)]
struct PkoModelHeaderExtras {
    id: u32,
    #[serde(rename = "type")]
    obj_type: u32,
    mat_local: [f32; 16],
    rcci: RenderCtrlCreateInfo,
    state_ctrl: [u8; 8],
    mesh_rs_set: [RenderStateAtom; 8],
    #[serde(default)]
    parent_id: Option<u32>,
    #[serde(default)]
    fvf: Option<u32>,
    #[serde(default)]
    pt_type: Option<u32>,
}

/// Stored as mesh-level extras (on the glTF Mesh object).
#[derive(Serialize, Deserialize, Debug)]
struct PkoMaterialExtras {
    pko_materials: Vec<PkoMaterialInfo>,
}

/// Per-material properties preserved across round-trip.
#[derive(Serialize, Deserialize, Debug)]
struct PkoMaterialInfo {
    opacity: f32,
    transp_type: MaterialTextureInfoTransparencyType,
    amb: [f32; 4],
    spe: Option<[f32; 4]>,
    power: f32,
    rs_set: [RenderStateAtom; 8],
    #[serde(default)]
    dif: Option<[f32; 4]>,
    #[serde(default)]
    emi_a: Option<f32>,
    #[serde(default)]
    tex_infos: Option<Vec<PkoTextureStageInfo>>,
}

/// All TextureInfo fields for a single texture stage, stored as primitives.
#[derive(Serialize, Deserialize, Debug)]
struct PkoTextureStageInfo {
    stage: u32,
    level: u32,
    usage: u32,
    d3d_format: u32,
    d3d_pool: u32,
    byte_alignment_flag: u32,
    tex_type: u32,
    width: u32,
    height: u32,
    colorkey_type: u32,
    colorkey: u32,
    data: u32,
    tss_set: [RenderStateAtom; 8],
    #[serde(default)]
    file_name: Option<String>,
}

impl PkoTextureStageInfo {
    fn from_texture_info(t: &TextureInfo) -> Self {
        let name = {
            let s = String::from_utf8_lossy(&t.file_name);
            let trimmed = s.trim_end_matches('\0');
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        };
        PkoTextureStageInfo {
            stage: t.stage,
            level: t.level,
            usage: t.usage,
            d3d_format: t.d3d_format as u32,
            d3d_pool: t.d3d_pool as u32,
            byte_alignment_flag: t.byte_alignment_flag,
            tex_type: t._type as u32,
            width: t.width,
            height: t.height,
            colorkey_type: t.colorkey_type as u32,
            colorkey: t.colorkey.to_color(),
            data: t.data,
            tss_set: t.tss_set,
            file_name: name,
        }
    }

    /// Apply stored fields onto a TextureInfo, preserving its file_name if
    /// this stage has no stored name (primary stage gets name from glTF).
    fn apply_to(&self, tex: &mut TextureInfo) {
        tex.stage = self.stage;
        tex.level = self.level;
        tex.usage = self.usage;
        tex.d3d_format = enum_from_u32_or(self.d3d_format, D3DFormat::Unknown);
        tex.d3d_pool = enum_from_u32_or(self.d3d_pool, D3DPool::Managed);
        tex.byte_alignment_flag = self.byte_alignment_flag;
        tex._type = enum_from_u32_or(self.tex_type, TextureType::File);
        tex.width = self.width;
        tex.height = self.height;
        tex.colorkey_type = enum_from_u32_or(self.colorkey_type, ColorKeyType::None);
        tex.colorkey = LwColorValue4b::from_color(self.colorkey);
        tex.data = self.data;
        tex.tss_set = self.tss_set;
        if let Some(ref name) = self.file_name {
            let mut bytes = [0u8; 64];
            for (i, b) in name.bytes().enumerate().take(63) {
                bytes[i] = b;
            }
            tex.file_name = bytes;
        }
    }
}

/// Read a u32 as a binrw-repr enum, falling back to `default` on failure.
fn enum_from_u32_or<T: for<'a> BinRead<Args<'a> = ()>>(v: u32, default: T) -> T {
    T::read_le(&mut std::io::Cursor::new(&v.to_le_bytes())).unwrap_or(default)
}

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

        let materials_vec = geom
            .material_seq
            .as_ref()
            .map(|v| v.as_slice())
            .unwrap_or(&[]);

        // Split subsets: main weapon primitives (non-overlay) and glow overlay (subset 1)
        // PKO items always have subset 1 as the glow overlay when they have 2+ subsets
        let has_overlay = mesh_info.subset_seq.len() >= 2;
        let split = build_item_primitives_split(
            project_dir,
            mesh_info,
            materials_vec,
            &mut fields,
            has_overlay,
        );

        // Build PKO model extras from the geom header (node-level extras on main mesh node)
        let pko_model_extras = PkoModelExtras {
            pko_version: geom.version,
            pko_model: PkoModelHeaderExtras {
                id: geom.header.id,
                obj_type: geom.header._type,
                mat_local: geom.header.mat_local.to_slice(),
                rcci: geom.header.rcci.clone(),
                state_ctrl: geom.header.state_ctrl._state_seq,
                mesh_rs_set: mesh_info.header.rs_set,
                parent_id: Some(geom.header.parent_id),
                fvf: Some(mesh_info.header.fvf),
                pt_type: Some(mesh_info.header.pt_type as u32),
            },
        };
        let node_extras_json = serde_json::to_string(&pko_model_extras)?;

        // Build per-material PKO extras for main mesh (mesh-level extras)
        let build_material_extras = |indices: &[usize]| -> PkoMaterialExtras {
            PkoMaterialExtras {
                pko_materials: indices
                    .iter()
                    .map(|&si| {
                        let mat = materials_vec.get(si);
                        PkoMaterialInfo {
                            opacity: mat.map(|m| m.opacity).unwrap_or(1.0),
                            transp_type: mat.map(|m| m.transp_type).unwrap_or_default(),
                            amb: mat
                                .map(|m| m.material.amb.to_slice())
                                .unwrap_or([1.0, 1.0, 1.0, 1.0]),
                            spe: mat
                                .map(|m| m.material.spe.as_ref().map(|s| s.to_slice()))
                                .unwrap_or(None),
                            power: mat.map(|m| m.material.power).unwrap_or(0.0),
                            rs_set: mat.map(|m| m.rs_set).unwrap_or([RenderStateAtom::new(); 8]),
                            dif: mat.map(|m| m.material.dif.to_slice()),
                            emi_a: mat.and_then(|m| m.material.emi.as_ref().map(|e| e.a)),
                            tex_infos: mat.map(|m| {
                                m.tex_seq
                                    .iter()
                                    .map(PkoTextureStageInfo::from_texture_info)
                                    .collect()
                            }),
                        }
                    })
                    .collect(),
            }
        };

        let main_mat_extras = build_material_extras(&split.main_material_indices);
        let main_mat_extras_json = serde_json::to_string(&main_mat_extras)?;

        let mut meshes = vec![];
        let mut all_nodes = vec![];
        let mut scene_nodes = vec![];

        // Main weapon mesh (subset 0 + any non-overlay subsets)
        meshes.push(gltf::Mesh {
            name: Some(model_id.to_string()),
            primitives: split.main_primitives,
            weights: None,
            extensions: None,
            extras: Some(RawValue::from_string(main_mat_extras_json)?),
        });
        all_nodes.push(gltf::Node {
            mesh: Some(gltf::Index::new(0)),
            name: Some(format!("Item_{}", model_id)),
            extras: Some(RawValue::from_string(node_extras_json)?),
            ..Default::default()
        });
        scene_nodes.push(gltf::Index::new(0));

        // Glow overlay mesh (subset 1) — separate node so extras propagate reliably
        if !split.overlay_primitives.is_empty() {
            let overlay_mat_extras = build_material_extras(&split.overlay_material_indices);
            let overlay_mat_extras_json = serde_json::to_string(&overlay_mat_extras)?;

            let overlay_mesh_idx = meshes.len() as u32;
            meshes.push(gltf::Mesh {
                name: Some("glow_overlay_mesh".to_string()),
                primitives: split.overlay_primitives,
                weights: None,
                extensions: None,
                extras: Some(RawValue::from_string(overlay_mat_extras_json)?),
            });

            let overlay_node_idx = all_nodes.len() as u32;
            all_nodes.push(gltf::Node {
                mesh: Some(gltf::Index::new(overlay_mesh_idx)),
                name: Some("glow_overlay".to_string()),
                extras: Some(RawValue::from_string(r#"{"glowOverlay":true}"#.to_string()).unwrap()),
                ..Default::default()
            });
            scene_nodes.push(gltf::Index::new(overlay_node_idx));
        }

        // Add helper nodes (dummy points, bounding spheres)
        let helper_nodes = geom.get_gltf_helper_nodes_for_mesh(0, false);
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

fn build_gltf_from_lgo_inner(
    lgo_path: &Path,
    texture_search_dir: &Path,
    has_overlay: bool,
) -> anyhow::Result<String> {
    let model_id = lgo_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");

    let geom = CharacterGeometricModel::from_file(lgo_path.to_path_buf())?;

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

    let materials_vec = geom
        .material_seq
        .as_ref()
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    let split = build_item_primitives_split(
        texture_search_dir,
        mesh_info,
        materials_vec,
        &mut fields,
        has_overlay,
    );

    // Zero out emissive on all preview materials. PKO materials may store
    // white emissive from source models that had emissive textures we couldn't
    // preserve, which washes out the preview to solid white.
    for mat in &mut fields.material {
        mat.emissive_factor = gltf::material::EmissiveFactor([0.0, 0.0, 0.0]);
    }

    let pko_model_extras = PkoModelExtras {
        pko_version: geom.version,
        pko_model: PkoModelHeaderExtras {
            id: geom.header.id,
            obj_type: geom.header._type,
            mat_local: geom.header.mat_local.to_slice(),
            rcci: geom.header.rcci.clone(),
            state_ctrl: geom.header.state_ctrl._state_seq,
            mesh_rs_set: mesh_info.header.rs_set,
            parent_id: Some(geom.header.parent_id),
            fvf: Some(mesh_info.header.fvf),
            pt_type: Some(mesh_info.header.pt_type as u32),
        },
    };
    let node_extras_json = serde_json::to_string(&pko_model_extras)?;

    let build_material_extras = |indices: &[usize]| -> PkoMaterialExtras {
        PkoMaterialExtras {
            pko_materials: indices
                .iter()
                .map(|&si| {
                    let mat = materials_vec.get(si);
                    PkoMaterialInfo {
                        opacity: mat.map(|m| m.opacity).unwrap_or(1.0),
                        transp_type: mat.map(|m| m.transp_type).unwrap_or_default(),
                        amb: mat
                            .map(|m| m.material.amb.to_slice())
                            .unwrap_or([1.0, 1.0, 1.0, 1.0]),
                        spe: mat
                            .map(|m| m.material.spe.as_ref().map(|s| s.to_slice()))
                            .unwrap_or(None),
                        power: mat.map(|m| m.material.power).unwrap_or(0.0),
                        rs_set: mat.map(|m| m.rs_set).unwrap_or([RenderStateAtom::new(); 8]),
                        dif: mat.map(|m| m.material.dif.to_slice()),
                        emi_a: mat.and_then(|m| m.material.emi.as_ref().map(|e| e.a)),
                        tex_infos: mat.map(|m| {
                            m.tex_seq
                                .iter()
                                .map(PkoTextureStageInfo::from_texture_info)
                                .collect()
                        }),
                    }
                })
                .collect(),
        }
    };

    let main_mat_extras = build_material_extras(&split.main_material_indices);
    let main_mat_extras_json = serde_json::to_string(&main_mat_extras)?;

    let mut meshes = vec![];
    let mut all_nodes = vec![];
    let mut scene_nodes = vec![];

    meshes.push(gltf::Mesh {
        name: Some(model_id.to_string()),
        primitives: split.main_primitives,
        weights: None,
        extensions: None,
        extras: Some(RawValue::from_string(main_mat_extras_json)?),
    });
    all_nodes.push(gltf::Node {
        mesh: Some(gltf::Index::new(0)),
        name: Some(format!("Item_{}", model_id)),
        extras: Some(RawValue::from_string(node_extras_json)?),
        ..Default::default()
    });
    scene_nodes.push(gltf::Index::new(0));

    if !split.overlay_primitives.is_empty() {
        let overlay_mat_extras = build_material_extras(&split.overlay_material_indices);
        let overlay_mat_extras_json = serde_json::to_string(&overlay_mat_extras)?;

        let overlay_mesh_idx = meshes.len() as u32;
        meshes.push(gltf::Mesh {
            name: Some("glow_overlay_mesh".to_string()),
            primitives: split.overlay_primitives,
            weights: None,
            extensions: None,
            extras: Some(RawValue::from_string(overlay_mat_extras_json)?),
        });

        let overlay_node_idx = all_nodes.len() as u32;
        all_nodes.push(gltf::Node {
            mesh: Some(gltf::Index::new(overlay_mesh_idx)),
            name: Some("glow_overlay".to_string()),
            extras: Some(RawValue::from_string(r#"{"glowOverlay":true}"#.to_string()).unwrap()),
            ..Default::default()
        });
        scene_nodes.push(gltf::Index::new(overlay_node_idx));
    }

    let helper_nodes = geom.get_gltf_helper_nodes_for_mesh(0, false);
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

/// Build glTF JSON directly from an LGO file path.
///
/// Used for previewing imported models. `texture_search_dir` is used as the
/// `project_dir` for texture lookup — for imports, pass the import directory
/// (e.g. `imports/item/`) so that `texture/` subdirectory search finds the
/// imported BMPs.
pub fn build_gltf_from_lgo(lgo_path: &Path, texture_search_dir: &Path) -> anyhow::Result<String> {
    build_gltf_from_lgo_inner(lgo_path, texture_search_dir, false)
}

/// Build glTF JSON from an LGO file path, optionally treating subset 1 as glow overlay.
pub fn build_gltf_from_lgo_with_overlay(
    lgo_path: &Path,
    texture_search_dir: &Path,
    has_overlay: bool,
) -> anyhow::Result<String> {
    build_gltf_from_lgo_inner(lgo_path, texture_search_dir, has_overlay)
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
    scale_factor: f32,
) -> anyhow::Result<ItemImportPaths> {
    let (doc, buffers, images) = ::gltf::import(file_path)?;

    // ------------------------------------------------------------------
    // 1. Identify nodes by extras; collect all mesh nodes
    // ------------------------------------------------------------------
    let mut main_mesh_indices: Vec<usize> = vec![];
    let mut overlay_mesh_idx: Option<usize> = None;
    let mut helper_nodes: Vec<::gltf::Node> = vec![];
    let mut pko_model_extras: Option<PkoModelExtras> = None;

    for node in doc.nodes() {
        if let Some(mesh) = node.mesh() {
            let is_overlay = node
                .extras()
                .as_ref()
                .map_or(false, |e| e.get().contains("\"glowOverlay\""));
            if is_overlay {
                overlay_mesh_idx = Some(mesh.index());
            } else {
                // Try to extract PKO model extras from the first main mesh node
                if pko_model_extras.is_none() {
                    if let Some(extras) = node.extras() {
                        if let Ok(parsed) = serde_json::from_str::<PkoModelExtras>(extras.get()) {
                            pko_model_extras = Some(parsed);
                        }
                    }
                }
                // Collect all non-overlay mesh indices (avoid duplicates)
                if !main_mesh_indices.contains(&mesh.index()) {
                    main_mesh_indices.push(mesh.index());
                }
            }
        } else if let Some(extras) = node.extras() {
            let text = extras.get();
            if text.contains("\"bounding_sphere\"") || text.contains("\"dummy\"") {
                helper_nodes.push(node);
            }
        }
    }

    if main_mesh_indices.is_empty() {
        return Err(anyhow::anyhow!("No main mesh node found in glTF"));
    }

    // Extract PKO material extras from the first main mesh
    let first_main_mesh = doc
        .meshes()
        .nth(main_mesh_indices[0])
        .ok_or_else(|| anyhow::anyhow!("Main mesh index {} not found", main_mesh_indices[0]))?;
    let main_mat_extras: Option<PkoMaterialExtras> = first_main_mesh
        .extras()
        .as_ref()
        .and_then(|e| serde_json::from_str::<PkoMaterialExtras>(e.get()).ok());
    let overlay_mat_extras: Option<PkoMaterialExtras> = overlay_mesh_idx
        .and_then(|idx| doc.meshes().nth(idx))
        .and_then(|m| {
            m.extras()
                .as_ref()
                .and_then(|e| serde_json::from_str::<PkoMaterialExtras>(e.get()).ok())
        });

    // ------------------------------------------------------------------
    // 2. Read vertex data from ALL main mesh nodes, merging into one
    // ------------------------------------------------------------------
    let mut vertex_seq: Vec<LwVector3> = vec![];
    let mut normal_seq: Vec<LwVector3> = vec![];
    let mut texcoord_seq: Vec<LwVector2> = vec![];
    let mut vercol_seq: Vec<u32> = vec![];

    /// Read vertex attributes from a glTF primitive and append to the output vectors.
    fn read_prim_vertices(
        prim: &::gltf::Primitive,
        buffers: &[::gltf::buffer::Data],
        vertex_seq: &mut Vec<LwVector3>,
        normal_seq: &mut Vec<LwVector3>,
        texcoord_seq: &mut Vec<LwVector2>,
        vercol_seq: &mut Vec<u32>,
    ) -> anyhow::Result<()> {
        for (semantic, accessor) in prim.attributes() {
            let view = accessor
                .view()
                .ok_or_else(|| anyhow::anyhow!("Accessor has no buffer view"))?;
            let buf = &buffers[view.buffer().index()].0;
            let base_offset = accessor.offset() + view.offset();
            let stride = view.stride().unwrap_or(accessor.size());

            match semantic {
                ::gltf::Semantic::Positions => {
                    for i in 0..accessor.count() {
                        let offset = base_offset + i * stride;
                        let mut reader = std::io::Cursor::new(&buf[offset..offset + 12]);
                        vertex_seq.push(LwVector3::read_le(&mut reader)?);
                    }
                }
                ::gltf::Semantic::Normals => {
                    for i in 0..accessor.count() {
                        let offset = base_offset + i * stride;
                        let mut reader = std::io::Cursor::new(&buf[offset..offset + 12]);
                        normal_seq.push(LwVector3::read_le(&mut reader)?);
                    }
                }
                ::gltf::Semantic::TexCoords(0) => {
                    for i in 0..accessor.count() {
                        let offset = base_offset + i * stride;
                        let mut reader = std::io::Cursor::new(&buf[offset..offset + 8]);
                        texcoord_seq.push(LwVector2::read_le(&mut reader)?);
                    }
                }
                ::gltf::Semantic::Colors(0) => {
                    for i in 0..accessor.count() {
                        let offset = base_offset + i * stride;
                        let mut reader = std::io::Cursor::new(&buf[offset..offset + 16]);
                        let r = f32::read_le(&mut reader)?;
                        let g = f32::read_le(&mut reader)?;
                        let b = f32::read_le(&mut reader)?;
                        let a = f32::read_le(&mut reader)?;
                        let packed = ((r * 255.0).round() as u32)
                            | (((g * 255.0).round() as u32) << 8)
                            | (((b * 255.0).round() as u32) << 16)
                            | (((a * 255.0).round() as u32) << 24);
                        vercol_seq.push(packed);
                    }
                }
                _ => {} // Skip joints/weights/etc — items are static
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // 3. Read vertices and indices from all meshes, offsetting indices
    // ------------------------------------------------------------------
    struct SubsetData {
        indices: Vec<u32>,
        material_index: Option<usize>,
    }

    fn read_indices(
        primitive: &::gltf::Primitive,
        buffers: &[::gltf::buffer::Data],
        index_offset: u32,
    ) -> anyhow::Result<Vec<u32>> {
        let accessor = primitive
            .indices()
            .ok_or_else(|| anyhow::anyhow!("Primitive has no indices"))?;
        let view = accessor
            .view()
            .ok_or_else(|| anyhow::anyhow!("Index accessor has no buffer view"))?;
        let buf = &buffers[view.buffer().index()].0;
        let base_offset = accessor.offset() + view.offset();
        let mut indices = Vec::with_capacity(accessor.count());

        match accessor.data_type() {
            ::gltf::accessor::DataType::U16 => {
                let stride = view.stride().unwrap_or(2);
                for i in 0..accessor.count() {
                    let offset = base_offset + i * stride;
                    let mut reader = std::io::Cursor::new(&buf[offset..offset + 2]);
                    indices.push(u16::read_le(&mut reader)? as u32 + index_offset);
                }
            }
            ::gltf::accessor::DataType::U32 => {
                let stride = view.stride().unwrap_or(4);
                for i in 0..accessor.count() {
                    let offset = base_offset + i * stride;
                    let mut reader = std::io::Cursor::new(&buf[offset..offset + 4]);
                    indices.push(u32::read_le(&mut reader)? + index_offset);
                }
            }
            dt => return Err(anyhow::anyhow!("Unsupported index data type: {:?}", dt)),
        }
        Ok(indices)
    }

    let mut main_subsets: Vec<SubsetData> = vec![];

    for &mesh_idx in &main_mesh_indices {
        let mesh = doc
            .meshes()
            .nth(mesh_idx)
            .ok_or_else(|| anyhow::anyhow!("Mesh index {} not found", mesh_idx))?;
        // Track vertex offset before reading this mesh's vertices
        let vertex_offset = vertex_seq.len() as u32;

        // Read vertices from the first primitive (all primitives in a mesh share vertex data)
        if let Some(first_prim) = mesh.primitives().next() {
            read_prim_vertices(
                &first_prim,
                &buffers,
                &mut vertex_seq,
                &mut normal_seq,
                &mut texcoord_seq,
                &mut vercol_seq,
            )?;
        }

        // Read indices from all primitives, offsetting by accumulated vertex count
        for prim in mesh.primitives() {
            main_subsets.push(SubsetData {
                indices: read_indices(&prim, &buffers, vertex_offset)?,
                material_index: prim.material().index(),
            });
        }
    }

    let overlay_subsets: Vec<SubsetData> = if let Some(ov_idx) = overlay_mesh_idx {
        let ov_mesh = doc
            .meshes()
            .nth(ov_idx)
            .ok_or_else(|| anyhow::anyhow!("Overlay mesh index {} not found", ov_idx))?;
        let vertex_offset = vertex_seq.len() as u32;
        if let Some(first_prim) = ov_mesh.primitives().next() {
            read_prim_vertices(
                &first_prim,
                &buffers,
                &mut vertex_seq,
                &mut normal_seq,
                &mut texcoord_seq,
                &mut vercol_seq,
            )?;
        }
        let mut subs = vec![];
        for prim in ov_mesh.primitives() {
            subs.push(SubsetData {
                indices: read_indices(&prim, &buffers, vertex_offset)?,
                material_index: prim.material().index(),
            });
        }
        subs
    } else {
        vec![]
    };

    // When merging multiple meshes, some may have vertex colors and others may not.
    // If the count doesn't match the vertex count, discard vertex colors entirely
    // to avoid invalid glTF (all attributes must have the same count).
    if !vercol_seq.is_empty() && vercol_seq.len() != vertex_seq.len() {
        vercol_seq.clear();
    }

    // Apply scale factor to vertex positions
    if (scale_factor - 1.0).abs() > f32::EPSILON {
        for v in &mut vertex_seq {
            v.0.x *= scale_factor;
            v.0.y *= scale_factor;
            v.0.z *= scale_factor;
        }
    }

    let vertex_num = vertex_seq.len() as u32;

    // Merge: [main_subset_0, overlay_subset(s), main_subset_1, main_subset_2, ...]
    // Also track which PKO extras entry applies to each merged subset.
    enum ExtrasSource {
        Main(usize),    // index into main_mat_extras.pko_materials
        Overlay(usize), // index into overlay_mat_extras.pko_materials
    }
    let mut all_subsets: Vec<SubsetData> = vec![];
    let mut extras_mapping: Vec<ExtrasSource> = vec![];
    if !main_subsets.is_empty() {
        all_subsets.push(main_subsets.remove(0)); // subset 0
        extras_mapping.push(ExtrasSource::Main(0));
    }
    for (i, ov) in overlay_subsets.into_iter().enumerate() {
        all_subsets.push(ov);
        extras_mapping.push(ExtrasSource::Overlay(i));
    }
    for (i, ms) in main_subsets.into_iter().enumerate() {
        all_subsets.push(ms);
        extras_mapping.push(ExtrasSource::Main(i + 1));
    }

    // Build unified index_seq and subset_seq
    let mut index_seq: Vec<u32> = vec![];
    let mut subset_seq: Vec<CharacterMeshSubsetInfo> = vec![];
    for sd in &all_subsets {
        let start_index = index_seq.len() as u32;
        let tri_count = (sd.indices.len() / 3) as u32;
        // Compute vertex_num for this subset (number of unique vertices referenced)
        let min_idx = sd.indices.iter().copied().min().unwrap_or(0);
        let max_idx = sd.indices.iter().copied().max().unwrap_or(0);
        let subset_vert_count = if sd.indices.is_empty() {
            0
        } else {
            max_idx - min_idx + 1
        };
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
    for (subset_idx, sd) in all_subsets.iter().enumerate() {
        let mut mtl = CharMaterialTextureInfo::new();
        mtl.transp_type = MaterialTextureInfoTransparencyType::Filter;
        mtl.opacity = 1.0;

        // Try to get the PKO material extras for this subset
        let pko_mat: Option<&PkoMaterialInfo> =
            extras_mapping.get(subset_idx).and_then(|src| match src {
                ExtrasSource::Main(i) => main_mat_extras
                    .as_ref()
                    .and_then(|e| e.pko_materials.get(*i)),
                ExtrasSource::Overlay(i) => overlay_mat_extras
                    .as_ref()
                    .and_then(|e| e.pko_materials.get(*i)),
            });

        if let Some(mat_idx) = sd.material_index {
            if let Some(gltf_mat) = doc.materials().nth(mat_idx) {
                let roughness = gltf_mat.pbr_metallic_roughness();
                let base_color = roughness.base_color_factor();
                // If the source has an emissive texture we can't preserve in PKO format,
                // zero out the emissive factor to avoid white wash-out in preview.
                let emissive = if gltf_mat.emissive_texture().is_some() && pko_mat.is_none() {
                    [0.0_f32; 3]
                } else {
                    gltf_mat.emissive_factor()
                };

                // Apply PKO extras if available, otherwise use glTF/defaults
                let dif = pko_mat
                    .and_then(|p| p.dif.as_ref().map(|d| ColorValue4F::from_slice(d)))
                    .unwrap_or(ColorValue4F {
                        r: base_color[0],
                        g: base_color[1],
                        b: base_color[2],
                        a: base_color[3],
                    });
                let amb =
                    pko_mat
                        .map(|p| ColorValue4F::from_slice(&p.amb))
                        .unwrap_or(ColorValue4F {
                            r: 1.0,
                            g: 1.0,
                            b: 1.0,
                            a: 1.0,
                        });
                let spe = pko_mat
                    .and_then(|p| p.spe.as_ref().map(|s| Some(ColorValue4F::from_slice(s))))
                    .unwrap_or(Some(ColorValue4F {
                        r: 1.0,
                        g: 1.0,
                        b: 1.0,
                        a: 1.0,
                    }));
                let power = pko_mat.map(|p| p.power).unwrap_or(0.0);
                let emi_a = pko_mat.and_then(|p| p.emi_a).unwrap_or(0.0);

                mtl.material = CharMaterial {
                    dif,
                    amb,
                    spe,
                    emi: Some(ColorValue4F {
                        r: emissive[0],
                        g: emissive[1],
                        b: emissive[2],
                        a: emi_a,
                    }),
                    power,
                };

                // Apply PKO-specific material properties
                if let Some(p) = pko_mat {
                    mtl.opacity = p.opacity;
                    mtl.transp_type = p.transp_type;
                    mtl.rs_set = p.rs_set;
                }

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
                        let tex_name = img_source
                            .name()
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

                        // Write standard BMP (decode_pko_texture handles both plain and encoded)
                        std::fs::write(&bmp_path, &bmp_buf)?;
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

                    // Restore full TextureInfo fields from PKO extras if available
                    if let Some(p) = pko_mat {
                        if let Some(ref tex_infos) = p.tex_infos {
                            for (i, ti) in tex_infos.iter().enumerate().take(4) {
                                // For stage 0, preserve the file_name we just set from glTF
                                let saved_name = if i == 0 {
                                    Some(mtl.tex_seq[0].file_name)
                                } else {
                                    None
                                };
                                ti.apply_to(&mut mtl.tex_seq[i]);
                                // Restore glTF-derived file_name for stage 0 if extras didn't
                                // provide a name (the glTF texture name is the canonical one)
                                if i == 0 {
                                    if ti.file_name.is_none() {
                                        if let Some(name) = saved_name {
                                            mtl.tex_seq[0].file_name = name;
                                        }
                                    }
                                }
                            }
                        }
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
        mat_local: Option<[f32; 16]>,
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
            mat_array[0][0],
            mat_array[0][1],
            mat_array[0][2],
            mat_array[0][3],
            mat_array[1][0],
            mat_array[1][1],
            mat_array[1][2],
            mat_array[1][3],
            mat_array[2][0],
            mat_array[2][1],
            mat_array[2][2],
            mat_array[2][3],
            mat_array[3][0],
            mat_array[3][1],
            mat_array[3][2],
            mat_array[3][3],
        ));

        if let Ok(dummy) = serde_json::from_str::<DummyExtras>(extras_str) {
            if dummy.r#type == "dummy" {
                helper_type |= HELPER_TYPE_DUMMY;
                let mat_local = dummy
                    .mat_local
                    .map(|s| LwMatrix44::from_slice(&s))
                    .unwrap_or(LwMatrix44(Matrix4::identity()));
                dummy_seq.push(HelperDummyInfo {
                    id: dummy.id,
                    mat,
                    mat_local,
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
    let mut fvf = D3DFVF_XYZ | D3DFVF_NORMAL | D3DFVF_TEX1;
    if !vercol_seq.is_empty() {
        fvf |= D3DFVF_DIFFUSE;
    }
    let mut vertex_element_seq: Vec<D3DVertexElement9> = vec![];
    let mut offset: u16 = 0;

    // POSITION (float3)
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0,
        offset,
        _type: 2,
        method: 0,
        usage: 0,
        usage_index: 0,
    });
    offset += 12;

    // NORMAL (float3)
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0,
        offset,
        _type: 2,
        method: 0,
        usage: 3,
        usage_index: 0,
    });
    offset += 12;

    // DIFFUSE (D3DCOLOR = packed u32)
    if !vercol_seq.is_empty() {
        vertex_element_seq.push(D3DVertexElement9 {
            stream: 0,
            offset,
            _type: 4,
            method: 0,
            usage: 10,
            usage_index: 0,
        });
        offset += 4;
    }

    // TEXCOORD (float2)
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0,
        offset,
        _type: 1,
        method: 0,
        usage: 5,
        usage_index: 0,
    });

    // D3DDECL_END
    vertex_element_seq.push(D3DVertexElement9 {
        stream: 0xFF,
        offset: 0,
        _type: 17,
        method: 0,
        usage: 0,
        usage_index: 0,
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

    // mesh_size: header + vertex_elements + vertices + normals + colors + texcoords + indices + subsets
    let mesh_size = {
        let header_size = std::mem::size_of::<CharacterInfoMeshHeader>();
        let ve_size = vertex_element_seq.len() * std::mem::size_of::<D3DVertexElement9>();
        let vert_size = vertex_seq.len() * std::mem::size_of::<LwVector3>();
        let norm_size = normal_seq.len() * std::mem::size_of::<LwVector3>();
        let col_size = vercol_seq.len() * std::mem::size_of::<u32>();
        let tc_size = texcoord_seq.len() * std::mem::size_of::<LwVector2>();
        let idx_size = index_seq.len() * std::mem::size_of::<u32>();
        let sub_size = subset_seq.len() * std::mem::size_of::<CharacterMeshSubsetInfo>();
        (header_size + ve_size + vert_size + norm_size + col_size + tc_size + idx_size + sub_size)
            as u32
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
    // Apply PKO model header extras if available, otherwise use defaults
    let (
        model_id_val,
        model_type,
        model_mat_local,
        model_rcci,
        model_state_ctrl,
        mesh_rs_set,
        model_version,
    ) = if let Some(ref pko) = pko_model_extras {
        let h = &pko.pko_model;
        (
            h.id,
            h.obj_type,
            LwMatrix44::from_slice(&h.mat_local),
            h.rcci.clone(),
            StateCtrl {
                _state_seq: h.state_ctrl,
            },
            h.mesh_rs_set,
            pko.pko_version,
        )
    } else {
        (
            0u32,
            GeomObjType::Generic as u32,
            LwMatrix44(Matrix4::identity()),
            RenderCtrlCreateInfo {
                ctrl_id: LW_RENDERCTRL_VS_FIXEDFUNCTION,
                decl_id: 3,
                vs_id: LW_INVALID_INDEX,
                ps_id: LW_INVALID_INDEX,
            },
            StateCtrl {
                _state_seq: [1, 1, 0, 0, 0, 0, 0, 0],
            },
            [RenderStateAtom::new(); 8],
            EXP_OBJ_VERSION_1_0_0_5,
        )
    };

    let parent_id_val = pko_model_extras
        .as_ref()
        .and_then(|p| p.pko_model.parent_id)
        .unwrap_or(LW_INVALID_INDEX);
    // fvf is computed from actual imported data (position/normal/texcoord/color)
    let fvf_val = fvf;
    let pt_type_val = pko_model_extras
        .as_ref()
        .and_then(|p| p.pko_model.pt_type)
        .map(|v| enum_from_u32_or(v, D3DPrimitiveType::TriangleList))
        .unwrap_or(D3DPrimitiveType::TriangleList);

    let mesh_info = CharacterMeshInfo {
        header: CharacterInfoMeshHeader {
            fvf: fvf_val,
            pt_type: pt_type_val,
            vertex_num,
            index_num,
            subset_num: subset_seq.len() as u32,
            bone_index_num: 0,
            bone_infl_factor: 0,
            vertex_element_num: vertex_element_seq.len() as u32,
            rs_set: mesh_rs_set,
        },
        vertex_seq,
        normal_seq,
        texcoord_seq: [texcoord_seq, vec![], vec![], vec![]],
        vercol_seq,
        index_seq,
        bone_index_seq: vec![],
        blend_seq: vec![],
        subset_seq,
        vertex_element_seq,
    };

    let geom = CharacterGeometricModel {
        version: model_version,
        header: CharGeoModelInfoHeader {
            id: model_id_val,
            parent_id: parent_id_val,
            _type: model_type,
            mat_local: model_mat_local,
            rcci: model_rcci,
            state_ctrl: model_state_ctrl,
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
    writer.flush()?;

    Ok(ItemImportPaths {
        lgo_file: lgo_path,
        texture_files,
    })
}

/// Convert glTF image data to a DynamicImage.
fn image_from_gltf_data(img_data: &::gltf::image::Data) -> anyhow::Result<image::DynamicImage> {
    use image::{DynamicImage, ImageBuffer, Rgb, Rgba};

    match img_data.format {
        ::gltf::image::Format::R8G8B8 => {
            let img = ImageBuffer::<Rgb<u8>, _>::from_raw(
                img_data.width,
                img_data.height,
                img_data.pixels.clone(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create RGB image buffer"))?;
            Ok(DynamicImage::ImageRgb8(img))
        }
        ::gltf::image::Format::R8G8B8A8 => {
            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(
                img_data.width,
                img_data.height,
                img_data.pixels.clone(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create RGBA image buffer"))?;
            Ok(DynamicImage::ImageRgba8(img))
        }
        other => Err(anyhow::anyhow!(
            "Unsupported glTF image format: {:?}",
            other
        )),
    }
}

/// Result of splitting item primitives into main and overlay groups.
/// Also carries which original material (subset) indices map to each group
/// so we can attach the right PKO material extras.
struct SplitPrimitivesResult {
    main_primitives: Vec<gltf::mesh::Primitive>,
    overlay_primitives: Vec<gltf::mesh::Primitive>,
    /// Original subset indices for main primitives (e.g. [0, 2, 3, ...])
    main_material_indices: Vec<usize>,
    /// Original subset indices for overlay primitives (e.g. [1])
    overlay_material_indices: Vec<usize>,
}

/// Build glTF primitives for an item mesh, split into main primitives and glow overlay.
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
    has_overlay: bool,
) -> SplitPrimitivesResult {
    // Shared vertex data (positions, normals, UVs, colors) — created once, referenced by all primitives
    let pos_idx = mesh_info.get_vertex_position_accessor(fields, false);
    let norm_idx = mesh_info.get_vertex_normal_accessor(fields, false);
    let tc_idx = if !mesh_info.texcoord_seq[0].is_empty() {
        Some(mesh_info.get_vertex_texcoord_accessor(fields, 0))
    } else {
        None
    };
    let col_idx = if !mesh_info.vercol_seq.is_empty() {
        Some(mesh_info.get_vertex_color_accessor(fields))
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
            (
                Checked::Valid(::gltf::Semantic::Positions),
                Index::new(pos_idx as u32),
            ),
            (
                Checked::Valid(::gltf::Semantic::Normals),
                Index::new(norm_idx as u32),
            ),
        ]);
        if let Some(tc) = tc_idx {
            attrs.insert(
                Checked::Valid(::gltf::Semantic::TexCoords(0)),
                Index::new(tc as u32),
            );
        }
        if let Some(col) = col_idx {
            attrs.insert(
                Checked::Valid(::gltf::Semantic::Colors(0)),
                Index::new(col as u32),
            );
        }
        attrs
    };

    if mesh_info.subset_seq.is_empty() {
        // No subsets — single primitive with all indices and first material
        let idx_acc = mesh_info.get_vertex_index_accessor(fields);
        let mat_idx = build_single_material(project_dir, materials_vec.first(), fields);
        return SplitPrimitivesResult {
            main_primitives: vec![gltf::mesh::Primitive {
                attributes: build_attributes(),
                indices: Some(Index::new(idx_acc as u32)),
                material: Some(Index::new(mat_idx as u32)),
                mode: Checked::Valid(mode),
                targets: None,
                extensions: None,
                extras: None,
            }],
            overlay_primitives: vec![],
            main_material_indices: vec![0],
            overlay_material_indices: vec![],
        };
    }

    let mut main_prims = Vec::new();
    let mut overlay_prims = Vec::new();
    let mut main_mat_indices = Vec::new();
    let mut overlay_mat_indices = Vec::new();

    for (si, subset) in mesh_info.subset_seq.iter().enumerate() {
        let start = subset.start_index as usize;
        let count = (subset.primitive_num * 3) as usize;
        let end = (start + count).min(mesh_info.index_seq.len());
        let subset_indices = &mesh_info.index_seq[start..end];

        let idx_acc = create_index_accessor(subset_indices, si, fields);
        let is_glow_overlay = has_overlay && si == 1;

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
            overlay_mat_indices.push(si);
        } else {
            main_prims.push(prim);
            main_mat_indices.push(si);
        }
    }

    SplitPrimitivesResult {
        main_primitives: main_prims,
        overlay_primitives: overlay_prims,
        main_material_indices: main_mat_indices,
        overlay_material_indices: overlay_mat_indices,
    }
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
                            if img.write_to(&mut cursor, image::ImageFormat::Png).is_ok() {
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
                                    wrap_s: Checked::Valid(gltf::texture::WrappingMode::Repeat),
                                    wrap_t: Checked::Valid(gltf::texture::WrappingMode::Repeat),
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
    use crate::character::model::LW_RENDERCTRL_VS_VERTEXBLEND;

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

    #[test]
    fn pko_extras_serde_round_trip() {
        // Build PkoModelExtras with non-default values
        let model_extras = PkoModelExtras {
            pko_version: EXP_OBJ_VERSION_1_0_0_5,
            pko_model: PkoModelHeaderExtras {
                id: 42,
                obj_type: GeomObjType::BB as u32,
                mat_local: [
                    1.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 4.0, 5.0, 6.0, 1.0,
                ],
                rcci: RenderCtrlCreateInfo {
                    ctrl_id: LW_RENDERCTRL_VS_VERTEXBLEND,
                    decl_id: 12,
                    vs_id: 2,
                    ps_id: LW_INVALID_INDEX,
                },
                state_ctrl: [1, 1, 0, 1, 0, 0, 0, 0],
                mesh_rs_set: {
                    let mut rs = [RenderStateAtom::new(); 8];
                    rs[0] = RenderStateAtom {
                        state: 27,
                        value0: 1,
                        value1: 1,
                    };
                    rs[1] = RenderStateAtom {
                        state: 15,
                        value0: 129,
                        value1: 129,
                    };
                    rs
                },
                parent_id: Some(7),
                fvf: Some(0x112),
                pt_type: Some(4), // TriangleList
            },
        };

        let json = serde_json::to_string(&model_extras).unwrap();
        let parsed: PkoModelExtras = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.pko_version, EXP_OBJ_VERSION_1_0_0_5);
        assert_eq!(parsed.pko_model.id, 42);
        assert_eq!(parsed.pko_model.obj_type, GeomObjType::BB as u32);
        assert_eq!(parsed.pko_model.mat_local[4 * 3], 4.0); // translation x
        assert_eq!(parsed.pko_model.rcci.ctrl_id, LW_RENDERCTRL_VS_VERTEXBLEND);
        assert_eq!(parsed.pko_model.state_ctrl[3], 1);
        assert_eq!(parsed.pko_model.mesh_rs_set[0].state, 27);
        assert_eq!(parsed.pko_model.mesh_rs_set[1].value0, 129);
        assert_eq!(parsed.pko_model.parent_id, Some(7));
        assert_eq!(parsed.pko_model.fvf, Some(0x112));
        assert_eq!(parsed.pko_model.pt_type, Some(4));

        // Verify backward compat: old JSON without new fields deserializes with None defaults
        let old_json = r#"{"pko_version":5,"pko_model":{"id":1,"type":0,"mat_local":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],"rcci":{"ctrl_id":0,"decl_id":3,"vs_id":4294967295,"ps_id":4294967295},"state_ctrl":[1,1,0,0,0,0,0,0],"mesh_rs_set":[{"state":0,"value0":0,"value1":0},{"state":0,"value0":0,"value1":0},{"state":0,"value0":0,"value1":0},{"state":0,"value0":0,"value1":0},{"state":0,"value0":0,"value1":0},{"state":0,"value0":0,"value1":0},{"state":0,"value0":0,"value1":0},{"state":0,"value0":0,"value1":0}]}}"#;
        let old_parsed: PkoModelExtras = serde_json::from_str(old_json).unwrap();
        assert_eq!(old_parsed.pko_model.parent_id, None);
        assert_eq!(old_parsed.pko_model.fvf, None);
        assert_eq!(old_parsed.pko_model.pt_type, None);

        // Build PkoMaterialExtras with non-default values including new fields
        let mat_extras = PkoMaterialExtras {
            pko_materials: vec![PkoMaterialInfo {
                opacity: 0.7,
                transp_type: MaterialTextureInfoTransparencyType::Additive,
                amb: [0.5, 0.6, 0.7, 1.0],
                spe: Some([0.1, 0.2, 0.3, 1.0]),
                power: 25.0,
                rs_set: {
                    let mut rs = [RenderStateAtom::new(); 8];
                    rs[0] = RenderStateAtom {
                        state: 19,
                        value0: 2,
                        value1: 6,
                    };
                    rs
                },
                dif: Some([0.8, 0.3, 0.1, 1.0]),
                emi_a: Some(0.5),
                tex_infos: Some(vec![PkoTextureStageInfo {
                    stage: 0,
                    level: 1,
                    usage: 0,
                    d3d_format: 21,
                    d3d_pool: 1,
                    byte_alignment_flag: 0,
                    tex_type: 0,
                    width: 256,
                    height: 256,
                    colorkey_type: 0,
                    colorkey: 0,
                    data: 0,
                    tss_set: [RenderStateAtom {
                        state: 7,
                        value0: 3,
                        value1: 3,
                    }; 8],
                    file_name: Some("texture.bmp".to_string()),
                }]),
            }],
        };

        let json = serde_json::to_string(&mat_extras).unwrap();
        let parsed: PkoMaterialExtras = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.pko_materials.len(), 1);
        let m = &parsed.pko_materials[0];
        assert!((m.opacity - 0.7).abs() < f32::EPSILON);
        assert_eq!(m.transp_type, MaterialTextureInfoTransparencyType::Additive);
        assert!((m.amb[0] - 0.5).abs() < f32::EPSILON);
        assert!((m.spe.unwrap()[0] - 0.1).abs() < f32::EPSILON);
        assert!((m.power - 25.0).abs() < f32::EPSILON);
        assert_eq!(m.rs_set[0].state, 19);
        assert!((m.dif.unwrap()[0] - 0.8).abs() < f32::EPSILON);
        assert!((m.emi_a.unwrap() - 0.5).abs() < f32::EPSILON);
        let ti = &m.tex_infos.as_ref().unwrap()[0];
        assert_eq!(ti.d3d_format, 21);
        assert_eq!(ti.width, 256);
        assert_eq!(ti.tss_set[0].state, 7);
        assert_eq!(ti.file_name.as_deref(), Some("texture.bmp"));
    }

    #[test]
    fn backward_compat_import_no_extras() {
        // Construct a minimal glTF with no PKO extras.
        // This tests that import falls back to defaults without panicking.
        // We build a tiny triangle, no textures, no extras.
        use ::gltf::json as gjson;
        use ::gltf::json::accessor::{ComponentType, GenericComponentType};
        use ::gltf::json::validation::{Checked, USize64};

        // 3 vertices: a simple triangle
        let positions: Vec<f32> = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let normals: Vec<f32> = vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let texcoords: Vec<f32> = vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let indices: Vec<u16> = vec![0, 1, 2];

        let pos_bytes: Vec<u8> = positions.iter().flat_map(|f| f.to_le_bytes()).collect();
        let norm_bytes: Vec<u8> = normals.iter().flat_map(|f| f.to_le_bytes()).collect();
        let tc_bytes: Vec<u8> = texcoords.iter().flat_map(|f| f.to_le_bytes()).collect();
        let idx_bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();

        let mut combined = Vec::new();
        combined.extend_from_slice(&pos_bytes);
        combined.extend_from_slice(&norm_bytes);
        combined.extend_from_slice(&tc_bytes);
        combined.extend_from_slice(&idx_bytes);

        let b64 = base64::prelude::BASE64_STANDARD.encode(&combined);

        let root = gjson::Root {
            asset: gjson::Asset {
                version: "2.0".to_string(),
                ..Default::default()
            },
            buffers: vec![gjson::Buffer {
                byte_length: USize64(combined.len() as u64),
                uri: Some(format!("data:application/octet-stream;base64,{}", b64)),
                name: None,
                extensions: None,
                extras: None,
            }],
            buffer_views: vec![
                gjson::buffer::View {
                    buffer: Index::new(0),
                    byte_length: USize64(pos_bytes.len() as u64),
                    byte_offset: Some(USize64(0)),
                    byte_stride: None,
                    target: Some(Checked::Valid(gjson::buffer::Target::ArrayBuffer)),
                    name: None,
                    extensions: None,
                    extras: None,
                },
                gjson::buffer::View {
                    buffer: Index::new(0),
                    byte_length: USize64(norm_bytes.len() as u64),
                    byte_offset: Some(USize64(pos_bytes.len() as u64)),
                    byte_stride: None,
                    target: Some(Checked::Valid(gjson::buffer::Target::ArrayBuffer)),
                    name: None,
                    extensions: None,
                    extras: None,
                },
                gjson::buffer::View {
                    buffer: Index::new(0),
                    byte_length: USize64(tc_bytes.len() as u64),
                    byte_offset: Some(USize64((pos_bytes.len() + norm_bytes.len()) as u64)),
                    byte_stride: None,
                    target: Some(Checked::Valid(gjson::buffer::Target::ArrayBuffer)),
                    name: None,
                    extensions: None,
                    extras: None,
                },
                gjson::buffer::View {
                    buffer: Index::new(0),
                    byte_length: USize64(idx_bytes.len() as u64),
                    byte_offset: Some(USize64(
                        (pos_bytes.len() + norm_bytes.len() + tc_bytes.len()) as u64,
                    )),
                    byte_stride: None,
                    target: Some(Checked::Valid(gjson::buffer::Target::ElementArrayBuffer)),
                    name: None,
                    extensions: None,
                    extras: None,
                },
            ],
            accessors: vec![
                gjson::Accessor {
                    buffer_view: Some(Index::new(0)),
                    byte_offset: Some(USize64(0)),
                    component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
                    count: USize64(3),
                    type_: Checked::Valid(gjson::accessor::Type::Vec3),
                    min: Some(serde_json::json!([0.0, 0.0, 0.0])),
                    max: Some(serde_json::json!([1.0, 1.0, 0.0])),
                    name: None,
                    normalized: false,
                    sparse: None,
                    extensions: None,
                    extras: None,
                },
                gjson::Accessor {
                    buffer_view: Some(Index::new(1)),
                    byte_offset: Some(USize64(0)),
                    component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
                    count: USize64(3),
                    type_: Checked::Valid(gjson::accessor::Type::Vec3),
                    min: None,
                    max: None,
                    name: None,
                    normalized: false,
                    sparse: None,
                    extensions: None,
                    extras: None,
                },
                gjson::Accessor {
                    buffer_view: Some(Index::new(2)),
                    byte_offset: Some(USize64(0)),
                    component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
                    count: USize64(3),
                    type_: Checked::Valid(gjson::accessor::Type::Vec2),
                    min: None,
                    max: None,
                    name: None,
                    normalized: false,
                    sparse: None,
                    extensions: None,
                    extras: None,
                },
                gjson::Accessor {
                    buffer_view: Some(Index::new(3)),
                    byte_offset: Some(USize64(0)),
                    component_type: Checked::Valid(GenericComponentType(ComponentType::U16)),
                    count: USize64(3),
                    type_: Checked::Valid(gjson::accessor::Type::Scalar),
                    min: None,
                    max: None,
                    name: None,
                    normalized: false,
                    sparse: None,
                    extensions: None,
                    extras: None,
                },
            ],
            meshes: vec![gjson::Mesh {
                name: Some("test_mesh".to_string()),
                primitives: vec![gjson::mesh::Primitive {
                    attributes: {
                        let mut m = BTreeMap::new();
                        m.insert(Checked::Valid(::gltf::Semantic::Positions), Index::new(0));
                        m.insert(Checked::Valid(::gltf::Semantic::Normals), Index::new(1));
                        m.insert(
                            Checked::Valid(::gltf::Semantic::TexCoords(0)),
                            Index::new(2),
                        );
                        m
                    },
                    indices: Some(Index::new(3)),
                    material: None,
                    mode: Checked::Valid(gjson::mesh::Mode::Triangles),
                    targets: None,
                    extensions: None,
                    extras: None,
                }],
                weights: None,
                extensions: None,
                extras: None, // No PKO extras
            }],
            nodes: vec![gjson::Node {
                mesh: Some(Index::new(0)),
                name: Some("Item_test".to_string()),
                extras: None, // No PKO model extras
                ..Default::default()
            }],
            scenes: vec![gjson::Scene {
                nodes: vec![Index::new(0)],
                name: None,
                extensions: None,
                extras: None,
            }],
            scene: Some(Index::new(0)),
            ..Default::default()
        };

        let gltf_json = serde_json::to_string(&root).unwrap();

        // Write to a temp file
        let tmp_dir = tempfile::tempdir().unwrap();
        let gltf_path = tmp_dir.path().join("test.gltf");
        std::fs::write(&gltf_path, &gltf_json).unwrap();

        let output_dir = tmp_dir.path().join("output");
        std::fs::create_dir_all(&output_dir).unwrap();

        let result = import_item_from_gltf(&gltf_path, "test_item", &output_dir, 1.0);
        assert!(
            result.is_ok(),
            "Import should succeed without PKO extras: {:?}",
            result.err()
        );

        // Verify the LGO file was written
        let paths = result.unwrap();
        assert!(
            paths.lgo_file.exists(),
            "LGO file should exist at {:?}",
            paths.lgo_file
        );

        // Verify file is non-empty (actual binary correctness is validated by other tests;
        // this test just ensures no-extras import doesn't panic and uses defaults)
        let file_size = std::fs::metadata(&paths.lgo_file).unwrap().len();
        assert!(file_size > 0, "LGO file should be non-empty");
    }

    #[test]
    #[ignore]
    fn real_item_round_trip() {
        // Only runs when game client is available
        let lgo_path = PathBuf::from("../top-client/model/item/01010027.lgo");
        if !lgo_path.exists() {
            eprintln!("Skipping real_item_round_trip: {:?} not found", lgo_path);
            return;
        }

        let original = CharacterGeometricModel::from_file(lgo_path.clone()).unwrap();
        let orig_header = &original.header;
        let orig_materials = original.material_seq.as_ref().unwrap();
        let orig_mesh = original.mesh_info.as_ref().unwrap();

        // Create a temporary Item to call get_gltf_json
        let item = Item {
            id: 1010027,
            name: "Test Sword".to_string(),
            icon_name: String::new(),
            model_ground: "01010027".to_string(),
            model_lance: "0".to_string(),
            model_carsise: "0".to_string(),
            model_phyllis: "0".to_string(),
            model_ami: "0".to_string(),
            item_type: 1,
            display_effect: String::new(),
            bind_effect: String::new(),
            bind_effect_2: String::new(),
            description: String::new(),
        };

        let project_dir = PathBuf::from("../top-client");
        let gltf_json = item.get_gltf_json(&project_dir, "01010027").unwrap();

        // Write glTF to temp file and re-import
        let tmp_dir = tempfile::tempdir().unwrap();
        let gltf_path = tmp_dir.path().join("roundtrip.gltf");
        std::fs::write(&gltf_path, &gltf_json).unwrap();

        let output_dir = tmp_dir.path().join("output");
        std::fs::create_dir_all(&output_dir).unwrap();

        let result = import_item_from_gltf(&gltf_path, "01010027", &output_dir, 1.0).unwrap();

        let reimported = CharacterGeometricModel::from_file(result.lgo_file).unwrap();

        // Compare model header fields
        assert_eq!(reimported.header.id, orig_header.id, "id mismatch");
        assert_eq!(reimported.header._type, orig_header._type, "type mismatch");
        assert_eq!(
            reimported.header.parent_id, orig_header.parent_id,
            "parent_id mismatch"
        );
        assert_eq!(
            reimported.header.rcci.ctrl_id, orig_header.rcci.ctrl_id,
            "rcci.ctrl_id mismatch"
        );
        assert_eq!(
            reimported.header.rcci.decl_id, orig_header.rcci.decl_id,
            "rcci.decl_id mismatch"
        );
        assert_eq!(
            reimported.header.rcci.vs_id, orig_header.rcci.vs_id,
            "rcci.vs_id mismatch"
        );
        assert_eq!(
            reimported.header.rcci.ps_id, orig_header.rcci.ps_id,
            "rcci.ps_id mismatch"
        );
        assert_eq!(
            reimported.header.state_ctrl._state_seq, orig_header.state_ctrl._state_seq,
            "state_ctrl mismatch"
        );
        assert_eq!(
            reimported.header.mat_local.to_slice(),
            orig_header.mat_local.to_slice(),
            "mat_local mismatch"
        );

        // Compare mesh header fields
        let reimp_mesh = reimported.mesh_info.as_ref().unwrap();
        assert_eq!(
            reimp_mesh.header.fvf, orig_mesh.header.fvf,
            "mesh fvf mismatch"
        );
        assert_eq!(
            reimp_mesh.header.pt_type, orig_mesh.header.pt_type,
            "mesh pt_type mismatch"
        );
        for i in 0..8 {
            assert_eq!(
                reimp_mesh.header.rs_set[i].state, orig_mesh.header.rs_set[i].state,
                "mesh rs_set[{}].state mismatch",
                i
            );
        }

        // Compare material fields
        let reimp_materials = reimported.material_seq.as_ref().unwrap();
        assert_eq!(
            reimp_materials.len(),
            orig_materials.len(),
            "material count mismatch"
        );
        for (i, (reimp, orig)) in reimp_materials
            .iter()
            .zip(orig_materials.iter())
            .enumerate()
        {
            assert!(
                (reimp.opacity - orig.opacity).abs() < f32::EPSILON,
                "material[{}].opacity mismatch: {} vs {}",
                i,
                reimp.opacity,
                orig.opacity
            );
            assert_eq!(
                reimp.transp_type, orig.transp_type,
                "material[{}].transp_type mismatch",
                i
            );
            // Compare dif color
            let reimp_dif = &reimp.material.dif;
            let orig_dif = &orig.material.dif;
            assert!(
                (reimp_dif.r - orig_dif.r).abs() < f32::EPSILON,
                "material[{}].dif.r mismatch: {} vs {}",
                i,
                reimp_dif.r,
                orig_dif.r
            );
            assert!(
                (reimp_dif.g - orig_dif.g).abs() < f32::EPSILON,
                "material[{}].dif.g mismatch",
                i
            );
            assert!(
                (reimp_dif.b - orig_dif.b).abs() < f32::EPSILON,
                "material[{}].dif.b mismatch",
                i
            );
            assert!(
                (reimp_dif.a - orig_dif.a).abs() < f32::EPSILON,
                "material[{}].dif.a mismatch",
                i
            );
            // Compare amb color
            assert!(
                (reimp.material.amb.r - orig.material.amb.r).abs() < f32::EPSILON,
                "material[{}].amb.r mismatch",
                i
            );
            // Compare emi.a (both are Option<ColorValue4F>)
            let reimp_emi_a = reimp.material.emi.as_ref().map(|e| e.a).unwrap_or(0.0);
            let orig_emi_a = orig.material.emi.as_ref().map(|e| e.a).unwrap_or(0.0);
            assert!(
                (reimp_emi_a - orig_emi_a).abs() < f32::EPSILON,
                "material[{}].emi.a mismatch: {} vs {}",
                i,
                reimp_emi_a,
                orig_emi_a
            );
            assert!(
                (reimp.material.power - orig.material.power).abs() < f32::EPSILON,
                "material[{}].power mismatch",
                i
            );
            for j in 0..8 {
                assert_eq!(
                    reimp.rs_set[j].state, orig.rs_set[j].state,
                    "material[{}].rs_set[{}].state mismatch",
                    i, j
                );
                assert_eq!(
                    reimp.rs_set[j].value0, orig.rs_set[j].value0,
                    "material[{}].rs_set[{}].value0 mismatch",
                    i, j
                );
            }
            // Compare TextureInfo fields for each tex_seq stage
            for s in 0..4 {
                let reimp_ti = &reimp.tex_seq[s];
                let orig_ti = &orig.tex_seq[s];
                assert_eq!(
                    reimp_ti.stage, orig_ti.stage,
                    "material[{}].tex_seq[{}].stage mismatch",
                    i, s
                );
                assert_eq!(
                    reimp_ti.d3d_format as u32, orig_ti.d3d_format as u32,
                    "material[{}].tex_seq[{}].d3d_format mismatch",
                    i, s
                );
                assert_eq!(
                    reimp_ti.d3d_pool as u32, orig_ti.d3d_pool as u32,
                    "material[{}].tex_seq[{}].d3d_pool mismatch",
                    i, s
                );
                assert_eq!(
                    reimp_ti.width, orig_ti.width,
                    "material[{}].tex_seq[{}].width mismatch",
                    i, s
                );
                assert_eq!(
                    reimp_ti.height, orig_ti.height,
                    "material[{}].tex_seq[{}].height mismatch",
                    i, s
                );
                for t in 0..8 {
                    assert_eq!(
                        reimp_ti.tss_set[t].state, orig_ti.tss_set[t].state,
                        "material[{}].tex_seq[{}].tss_set[{}].state mismatch",
                        i, s, t
                    );
                }
            }
        }

        // Compare vertex colors
        assert_eq!(
            reimp_mesh.vercol_seq.len(),
            orig_mesh.vercol_seq.len(),
            "vercol_seq length mismatch"
        );
        for (i, (reimp_col, orig_col)) in reimp_mesh
            .vercol_seq
            .iter()
            .zip(orig_mesh.vercol_seq.iter())
            .enumerate()
        {
            assert_eq!(
                reimp_col, orig_col,
                "vercol_seq[{}] mismatch: 0x{:08X} vs 0x{:08X}",
                i, reimp_col, orig_col
            );
        }

        eprintln!("real_item_round_trip: all round-trip fields match!");
    }
}
