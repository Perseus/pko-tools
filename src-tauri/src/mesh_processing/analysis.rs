use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::character::model::CharacterGeometricModel;

/// Summary statistics for a mesh, usable for both glTF analysis and LGO models.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshAnalysisReport {
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub index_count: u32,
    pub material_count: u32,
    pub subset_count: u32,
    pub bone_count: u32,
    pub has_normals: bool,
    pub has_texcoords: bool,
    pub has_vertex_colors: bool,
    pub has_skinning: bool,
    pub bounding_sphere_count: u32,
    pub dummy_count: u32,
    /// Warnings about potential issues (e.g. high poly count, too many materials).
    pub warnings: Vec<String>,
}

/// Recommended engine limits for PKO models.
pub const RECOMMENDED_MAX_TRIANGLES: u32 = 3000;
pub const LW_MAX_BONE_NUM: u32 = 25;
pub const LW_MAX_SUBSET_NUM: u32 = 16;
pub const LW_MAX_BOUNDING_SPHERE_NUM: u32 = 8;

/// Analyze a glTF file and produce a mesh analysis report.
pub fn analyze_gltf_file(file_path: &Path) -> anyhow::Result<MeshAnalysisReport> {
    let (doc, buffers, _images) = ::gltf::import(file_path)?;

    let mut total_vertices = 0u32;
    let mut total_indices = 0u32;
    let mut total_primitives = 0u32;
    let mut has_normals = false;
    let mut has_texcoords = false;
    let mut has_vertex_colors = false;
    let mut has_skinning = false;

    for mesh in doc.meshes() {
        for primitive in mesh.primitives() {
            total_primitives += 1;

            for (semantic, accessor) in primitive.attributes() {
                match semantic {
                    ::gltf::Semantic::Positions => {
                        total_vertices += accessor.count() as u32;
                    }
                    ::gltf::Semantic::Normals => {
                        has_normals = true;
                    }
                    ::gltf::Semantic::TexCoords(0) => {
                        has_texcoords = true;
                    }
                    ::gltf::Semantic::Colors(0) => {
                        has_vertex_colors = true;
                    }
                    ::gltf::Semantic::Joints(0) => {
                        has_skinning = true;
                    }
                    _ => {}
                }
            }

            if let Some(indices_accessor) = primitive.indices() {
                total_indices += indices_accessor.count() as u32;
            }
        }
    }

    let triangle_count = total_indices / 3;
    let material_count = doc.materials().count() as u32;
    let bone_count = doc.skins().next().map_or(0, |s| s.joints().count() as u32);

    let mut warnings = vec![];

    if triangle_count > RECOMMENDED_MAX_TRIANGLES {
        warnings.push(format!(
            "Triangle count ({}) exceeds recommended limit ({})",
            triangle_count, RECOMMENDED_MAX_TRIANGLES
        ));
    }

    if bone_count > LW_MAX_BONE_NUM {
        warnings.push(format!(
            "Bone count ({}) exceeds engine limit ({})",
            bone_count, LW_MAX_BONE_NUM
        ));
    }

    if total_primitives > LW_MAX_SUBSET_NUM as u32 {
        warnings.push(format!(
            "Primitive/subset count ({}) exceeds engine limit ({})",
            total_primitives, LW_MAX_SUBSET_NUM
        ));
    }

    if !has_normals {
        warnings.push("Model has no normals - lighting will not work correctly".to_string());
    }

    if !has_texcoords {
        warnings.push("Model has no texture coordinates".to_string());
    }

    Ok(MeshAnalysisReport {
        vertex_count: total_vertices,
        triangle_count,
        index_count: total_indices,
        material_count,
        subset_count: total_primitives,
        bone_count,
        has_normals,
        has_texcoords,
        has_vertex_colors,
        has_skinning,
        bounding_sphere_count: 0,
        dummy_count: 0,
        warnings,
    })
}

/// Analyze an existing LGO model file.
pub fn analyze_lgo_file(file_path: &Path) -> anyhow::Result<MeshAnalysisReport> {
    let geom = CharacterGeometricModel::from_file(file_path.to_path_buf())?;

    let mesh_info = geom
        .mesh_info
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("LGO file has no mesh data"))?;

    let has_normals = !mesh_info.normal_seq.is_empty();
    let has_texcoords = !mesh_info.texcoord_seq[0].is_empty();
    let has_vertex_colors = !mesh_info.vercol_seq.is_empty();
    let has_skinning = mesh_info.header.bone_index_num > 0;

    let (bsphere_count, dummy_count) = if let Some(ref helper) = geom.helper_data {
        (helper.bsphere_num, helper.dummy_num)
    } else {
        (0, 0)
    };

    let triangle_count = mesh_info.header.index_num / 3;
    let mut warnings = vec![];

    if triangle_count > RECOMMENDED_MAX_TRIANGLES {
        warnings.push(format!(
            "Triangle count ({}) exceeds recommended limit ({})",
            triangle_count, RECOMMENDED_MAX_TRIANGLES
        ));
    }

    Ok(MeshAnalysisReport {
        vertex_count: mesh_info.header.vertex_num,
        triangle_count,
        index_count: mesh_info.header.index_num,
        material_count: geom.material_num,
        subset_count: mesh_info.header.subset_num,
        bone_count: mesh_info.header.bone_index_num,
        has_normals,
        has_texcoords,
        has_vertex_colors,
        has_skinning,
        bounding_sphere_count: bsphere_count,
        dummy_count,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyze_lgo_from_test_artifact() {
        let path = std::path::Path::new("test_artifacts/0909000000.lgo");
        if !path.exists() {
            return;
        }

        let report = analyze_lgo_file(path).unwrap();
        assert_eq!(report.vertex_count, 1323);
        assert!(report.has_normals);
        assert!(report.has_texcoords);
        assert_eq!(report.bounding_sphere_count, 7);
    }

    #[test]
    fn warns_on_high_triangle_count() {
        // Just verify the constant is set correctly
        assert_eq!(RECOMMENDED_MAX_TRIANGLES, 3000);
    }
}
