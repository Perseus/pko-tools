use std::path::Path;

use cgmath::Vector3;
use serde::{Deserialize, Serialize};

use crate::math::LwVector3;

/// PKO characters are roughly 2.0 units tall.
pub const PKO_STANDARD_HEIGHT: f32 = 2.0;

/// Result of scale analysis for an external model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaleAnalysis {
    /// Height of the model (extent along Y axis).
    pub model_height: f32,
    /// Width of the model (extent along X axis).
    pub model_width: f32,
    /// Depth of the model (extent along Z axis).
    pub model_depth: f32,
    /// Suggested uniform scale factor to match PKO standard height.
    pub suggested_scale: f32,
    /// The axis-aligned bounding box minimum.
    pub aabb_min: [f32; 3],
    /// The axis-aligned bounding box maximum.
    pub aabb_max: [f32; 3],
}

/// Analyze the scale of a set of vertices and suggest a scale factor
/// to match PKO's standard character height (~2.0 units).
pub fn analyze_scale(vertices: &[LwVector3]) -> ScaleAnalysis {
    if vertices.is_empty() {
        return ScaleAnalysis {
            model_height: 0.0,
            model_width: 0.0,
            model_depth: 0.0,
            suggested_scale: 1.0,
            aabb_min: [0.0; 3],
            aabb_max: [0.0; 3],
        };
    }

    let mut min = vertices[0].0;
    let mut max = vertices[0].0;

    for v in vertices.iter() {
        if v.0.x < min.x { min.x = v.0.x; }
        if v.0.y < min.y { min.y = v.0.y; }
        if v.0.z < min.z { min.z = v.0.z; }
        if v.0.x > max.x { max.x = v.0.x; }
        if v.0.y > max.y { max.y = v.0.y; }
        if v.0.z > max.z { max.z = v.0.z; }
    }

    let model_height = max.y - min.y;
    let model_width = max.x - min.x;
    let model_depth = max.z - min.z;

    let suggested_scale = if model_height > f32::EPSILON {
        PKO_STANDARD_HEIGHT / model_height
    } else {
        1.0
    };

    ScaleAnalysis {
        model_height,
        model_width,
        model_depth,
        suggested_scale,
        aabb_min: [min.x, min.y, min.z],
        aabb_max: [max.x, max.y, max.z],
    }
}

/// Analyze a glTF file's scale by reading all vertex positions.
pub fn analyze_gltf_scale(file_path: &Path) -> anyhow::Result<ScaleAnalysis> {
    let (doc, buffers, _images) = ::gltf::import(file_path)?;

    let mut all_vertices: Vec<LwVector3> = vec![];

    for mesh in doc.meshes() {
        for primitive in mesh.primitives() {
            if let Some(accessor) = primitive.get(&::gltf::Semantic::Positions) {
                let view = accessor
                    .view()
                    .ok_or_else(|| anyhow::anyhow!("Position accessor has no buffer view"))?;
                let buf = &buffers[view.buffer().index()].0;
                let offset = accessor.offset() + view.offset();
                let stride = view.stride().unwrap_or(12); // 3 * f32

                for i in 0..accessor.count() {
                    let base = offset + i * stride;
                    if base + 12 <= buf.len() {
                        let x = f32::from_le_bytes([buf[base], buf[base + 1], buf[base + 2], buf[base + 3]]);
                        let y = f32::from_le_bytes([buf[base + 4], buf[base + 5], buf[base + 6], buf[base + 7]]);
                        let z = f32::from_le_bytes([buf[base + 8], buf[base + 9], buf[base + 10], buf[base + 11]]);
                        all_vertices.push(LwVector3(Vector3::new(x, y, z)));
                    }
                }
            }
        }
    }

    Ok(analyze_scale(&all_vertices))
}

/// Apply a uniform scale factor to a set of vertices in place.
pub fn apply_scale(vertices: &mut [LwVector3], scale: f32) {
    for v in vertices.iter_mut() {
        v.0.x *= scale;
        v.0.y *= scale;
        v.0.z *= scale;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_analysis_empty() {
        let result = analyze_scale(&[]);
        assert_eq!(result.suggested_scale, 1.0);
        assert_eq!(result.model_height, 0.0);
    }

    #[test]
    fn scale_analysis_unit_model() {
        let vertices = vec![
            LwVector3(Vector3::new(0.0, 0.0, 0.0)),
            LwVector3(Vector3::new(1.0, 2.0, 1.0)),
        ];
        let result = analyze_scale(&vertices);
        assert!((result.model_height - 2.0).abs() < 0.001);
        // 2.0 / 2.0 = 1.0
        assert!((result.suggested_scale - 1.0).abs() < 0.001);
    }

    #[test]
    fn scale_analysis_large_model() {
        // 200-unit-tall model (common in some 3D tools)
        let vertices = vec![
            LwVector3(Vector3::new(-1.0, 0.0, -1.0)),
            LwVector3(Vector3::new(1.0, 200.0, 1.0)),
        ];
        let result = analyze_scale(&vertices);
        assert!((result.model_height - 200.0).abs() < 0.001);
        // 2.0 / 200.0 = 0.01
        assert!((result.suggested_scale - 0.01).abs() < 0.001);
    }

    #[test]
    fn scale_analysis_small_model() {
        // 0.02-unit-tall model (centimeter scale)
        let vertices = vec![
            LwVector3(Vector3::new(0.0, 0.0, 0.0)),
            LwVector3(Vector3::new(0.01, 0.02, 0.01)),
        ];
        let result = analyze_scale(&vertices);
        assert!((result.model_height - 0.02).abs() < 0.001);
        // 2.0 / 0.02 = 100.0
        assert!((result.suggested_scale - 100.0).abs() < 0.1);
    }

    #[test]
    fn apply_scale_works() {
        let mut vertices = vec![
            LwVector3(Vector3::new(1.0, 2.0, 3.0)),
            LwVector3(Vector3::new(4.0, 5.0, 6.0)),
        ];
        apply_scale(&mut vertices, 0.5);
        assert!((vertices[0].0.x - 0.5).abs() < 0.001);
        assert!((vertices[0].0.y - 1.0).abs() < 0.001);
        assert!((vertices[0].0.z - 1.5).abs() < 0.001);
        assert!((vertices[1].0.x - 2.0).abs() < 0.001);
    }
}
