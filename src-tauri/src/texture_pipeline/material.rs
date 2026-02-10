use crate::character::texture::{
    CharMaterial, ColorValue4F, MaterialTextureInfoTransparencyType,
};

/// Convert PBR metallic-roughness material parameters to PKO's D3D fixed-function material.
///
/// Approximations:
/// - `base_color_factor` → `CharMaterial.dif` (diffuse)
/// - `emissive_factor` → `CharMaterial.emi` (emissive)
/// - `metallic * base_color` → `CharMaterial.spe` (specular, approximation)
/// - `(1 - roughness) * 128` → `CharMaterial.power` (shininess)
/// - `alpha_mode` → `MaterialTextureInfoTransparencyType`
pub fn pbr_to_d3d_material(
    base_color_factor: [f32; 4],
    emissive_factor: [f32; 3],
    metallic_factor: f32,
    roughness_factor: f32,
    alpha_mode: &str,
) -> (CharMaterial, MaterialTextureInfoTransparencyType) {
    let dif = ColorValue4F {
        r: base_color_factor[0],
        g: base_color_factor[1],
        b: base_color_factor[2],
        a: base_color_factor[3],
    };

    let amb = ColorValue4F {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };

    // Specular: approximate from metallic * base_color
    let spe = Some(ColorValue4F {
        r: metallic_factor * base_color_factor[0],
        g: metallic_factor * base_color_factor[1],
        b: metallic_factor * base_color_factor[2],
        a: 1.0,
    });

    let emi = Some(ColorValue4F {
        r: emissive_factor[0],
        g: emissive_factor[1],
        b: emissive_factor[2],
        a: 0.0,
    });

    // Shininess: high smoothness (low roughness) → high power
    let power = (1.0 - roughness_factor) * 128.0;

    let transp_type = match alpha_mode {
        "BLEND" => MaterialTextureInfoTransparencyType::Additive,
        "MASK" => MaterialTextureInfoTransparencyType::Filter,
        _ => MaterialTextureInfoTransparencyType::Filter,
    };

    let material = CharMaterial {
        dif,
        amb,
        spe,
        emi,
        power,
    };

    (material, transp_type)
}

/// Extract PBR parameters from a gltf::Material.
pub fn extract_pbr_params(
    material: &::gltf::Material,
) -> ([f32; 4], [f32; 3], f32, f32, String) {
    let pbr = material.pbr_metallic_roughness();
    let base_color = pbr.base_color_factor();
    let emissive = material.emissive_factor();
    let metallic = pbr.metallic_factor();
    let roughness = pbr.roughness_factor();

    let alpha_mode = match material.alpha_mode() {
        ::gltf::material::AlphaMode::Opaque => "OPAQUE",
        ::gltf::material::AlphaMode::Mask => "MASK",
        ::gltf::material::AlphaMode::Blend => "BLEND",
    };

    (base_color, emissive, metallic, roughness, alpha_mode.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_default_material() {
        let (mat, transp) = pbr_to_d3d_material(
            [1.0, 1.0, 1.0, 1.0],
            [0.0, 0.0, 0.0],
            0.0,
            1.0,
            "OPAQUE",
        );
        assert!((mat.dif.r - 1.0).abs() < 0.001);
        assert!((mat.power - 0.0).abs() < 0.001); // roughness=1 → power=0
        assert_eq!(transp, MaterialTextureInfoTransparencyType::Filter);
    }

    #[test]
    fn metallic_shiny_material() {
        let (mat, _transp) = pbr_to_d3d_material(
            [0.8, 0.2, 0.1, 1.0],
            [0.0, 0.0, 0.0],
            1.0,
            0.0,
            "OPAQUE",
        );
        // metallic=1, roughness=0 → high specular, high power
        let spe = mat.spe.unwrap();
        assert!((spe.r - 0.8).abs() < 0.001);
        assert!((spe.g - 0.2).abs() < 0.001);
        assert!((mat.power - 128.0).abs() < 0.001);
    }

    #[test]
    fn emissive_material() {
        let (mat, _) = pbr_to_d3d_material(
            [1.0, 1.0, 1.0, 1.0],
            [1.0, 0.5, 0.0],
            0.0,
            0.5,
            "OPAQUE",
        );
        let emi = mat.emi.unwrap();
        assert!((emi.r - 1.0).abs() < 0.001);
        assert!((emi.g - 0.5).abs() < 0.001);
        assert!((emi.b - 0.0).abs() < 0.001);
    }

    #[test]
    fn blend_alpha_mode() {
        let (_, transp) = pbr_to_d3d_material(
            [1.0, 1.0, 1.0, 0.5],
            [0.0, 0.0, 0.0],
            0.0,
            1.0,
            "BLEND",
        );
        assert_eq!(transp, MaterialTextureInfoTransparencyType::Additive);
    }
}
