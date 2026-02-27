Write access is blocked in this session, so I couldn’t apply edits directly (`Operation not permitted` on file writes).  
I still followed the prompt and prepared the exact Rust patch for:

- [lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs)
- [scene_model.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs)

```diff
diff --git a/src-tauri/src/map/lmo.rs b/src-tauri/src/map/lmo.rs
index 0000000..0000000 100644
--- a/src-tauri/src/map/lmo.rs
+++ b/src-tauri/src/map/lmo.rs
@@ -57,6 +57,10 @@ const D3DCMP_GREATER: u32 = 5;
 /// Transparency type enum matching lwMtlTexInfoTransparencyTypeEnum.
 pub const TRANSP_FILTER: u32 = 0;
 pub const TRANSP_ADDITIVE: u32 = 1;
+pub const TRANSP_ADDITIVE1: u32 = 2;
+pub const TRANSP_ADDITIVE2: u32 = 3;
+pub const TRANSP_ADDITIVE3: u32 = 4;
+pub const TRANSP_SUBTRACTIVE: u32 = 5;

 #[derive(Debug, Clone, Copy, Default)]
 struct MaterialRenderState {
diff --git a/src-tauri/src/map/scene_model.rs b/src-tauri/src/map/scene_model.rs
index 0000000..0000000 100644
--- a/src-tauri/src/map/scene_model.rs
+++ b/src-tauri/src/map/scene_model.rs
@@ -316,6 +316,35 @@ fn load_texture_as_data_uri(path: &Path) -> Option<String> {
     ))
 }
 
+// D3DBLEND values used for parity warnings against PKO's transp_type defaults.
+const D3DBLEND_ZERO: u32 = 1;
+const D3DBLEND_ONE: u32 = 2;
+const D3DBLEND_SRCCOLOR: u32 = 3;
+const D3DBLEND_INVSRCCOLOR: u32 = 4;
+const D3DBLEND_SRCALPHA: u32 = 5;
+const D3DBLEND_DESTALPHA: u32 = 7;
+
+fn canonicalize_transp_type(transp_type: u32) -> u32 {
+    if transp_type >= 6 {
+        lmo::TRANSP_ADDITIVE
+    } else {
+        transp_type
+    }
+}
+
+fn default_blend_for_transp_type(transp_type: u32) -> Option<(u32, u32)> {
+    match canonicalize_transp_type(transp_type) {
+        lmo::TRANSP_FILTER => None,
+        lmo::TRANSP_ADDITIVE => Some((D3DBLEND_ONE, D3DBLEND_ONE)),
+        lmo::TRANSP_ADDITIVE1 => Some((D3DBLEND_SRCCOLOR, D3DBLEND_ONE)),
+        lmo::TRANSP_ADDITIVE2 => Some((D3DBLEND_SRCCOLOR, D3DBLEND_INVSRCCOLOR)),
+        lmo::TRANSP_ADDITIVE3 => Some((D3DBLEND_SRCALPHA, D3DBLEND_DESTALPHA)),
+        lmo::TRANSP_SUBTRACTIVE => Some((D3DBLEND_ZERO, D3DBLEND_INVSRCCOLOR)),
+        _ => Some((D3DBLEND_ONE, D3DBLEND_ONE)),
+    }
+}
+
 fn build_lmo_material(
     builder: &mut GltfBuilder,
     mat: &lmo::LmoMaterial,
@@ -323,7 +352,33 @@ fn build_lmo_material(
     project_dir: &Path,
     load_textures: bool,
 ) {
-    let is_additive = mat.transp_type == lmo::TRANSP_ADDITIVE;
+    let effective_transp = canonicalize_transp_type(mat.transp_type);
+    let default_blend = default_blend_for_transp_type(effective_transp);
+
+    if let Some((default_src, default_dst)) = default_blend {
+        if let Some(src_blend) = mat.src_blend {
+            if src_blend != default_src {
+                eprintln!(
+                    "WARN: material '{}' has src_blend={} but transp_type {} (effective {}) defaults to {}",
+                    name, src_blend, mat.transp_type, effective_transp, default_src
+                );
+            }
+        }
+
+        if let Some(dest_blend) = mat.dest_blend {
+            if dest_blend != default_dst {
+                eprintln!(
+                    "WARN: material '{}' has dest_blend={} but transp_type {} (effective {}) defaults to {}",
+                    name, dest_blend, mat.transp_type, effective_transp, default_dst
+                );
+            }
+        }
+    }
 
     let base_color = [
         mat.diffuse[0].clamp(0.0, 1.0),
@@ -332,12 +387,11 @@ fn build_lmo_material(
         mat.opacity.clamp(0.0, 1.0),
     ];
 
-    // Additive materials: keep Opaque alpha mode — the Unity shader handles blending.
-    // Non-additive: use existing alpha test / opacity logic.
-    let alpha_mode = if is_additive {
-        Checked::Valid(gltf_json::material::AlphaMode::Opaque)
-    } else if mat.alpha_test_enabled {
+    // Preserve cutout semantics whenever alpha-test is enabled, including additive types.
+    let alpha_mode = if mat.alpha_test_enabled {
         Checked::Valid(gltf_json::material::AlphaMode::Mask)
+    } else if effective_transp == lmo::TRANSP_FILTER && mat.opacity < 0.99 {
+        Checked::Valid(gltf_json::material::AlphaMode::Blend)
     } else if mat.opacity < 0.99 {
         Checked::Valid(gltf_json::material::AlphaMode::Blend)
     } else {
@@ -349,7 +403,7 @@ fn build_lmo_material(
     // The stored alpha_ref in the LMO file is effectively ignored — 129 is the
     // universal threshold for opaque materials (opacity=1.0).
     // Use 129/255 ≈ 0.506 to match the engine's actual behavior.
-    let alpha_cutoff = if !is_additive && mat.alpha_test_enabled {
+    let alpha_cutoff = if mat.alpha_test_enabled {
         let cutoff = if mat.opacity < 0.99 {
             // Opacity-scaled: v = (opacity * 255) - 1, capped at 129
             let v = ((mat.opacity * 255.0) - 1.0).clamp(0.0, 129.0);
@@ -363,11 +417,15 @@ fn build_lmo_material(
         None
     };
 
-    // Material name suffix for blend mode signaling to Unity
-    let material_name = if is_additive {
-        format!("{}__PKO_BLEND_ADD", name)
+    // Encode PKO render-state metadata for Unity material replacement.
+    let material_name = if effective_transp != lmo::TRANSP_FILTER || mat.alpha_test_enabled {
+        let alpha_ref = if mat.alpha_test_enabled {
+            mat.alpha_ref as u32
+        } else {
+            0
+        };
+        let opacity_byte = (mat.opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
+        format!("{}__PKO_T{}_A{}_O{}", name, effective_transp, alpha_ref, opacity_byte)
     } else {
         name.to_string()
     };
@@ -1557,6 +1615,90 @@ mod tests {
         let cutoff = gltf_mat
             .alpha_cutoff
             .expect("alpha cutoff should be set for alpha-test materials")
             .0;
         assert!((cutoff - (129.0 / 255.0)).abs() < 1e-6);
     }
+
+    #[test]
+    fn default_blend_for_transp_type_matches_engine_switch() {
+        assert_eq!(default_blend_for_transp_type(0), None);
+        assert_eq!(
+            default_blend_for_transp_type(1),
+            Some((D3DBLEND_ONE, D3DBLEND_ONE))
+        );
+        assert_eq!(
+            default_blend_for_transp_type(2),
+            Some((D3DBLEND_SRCCOLOR, D3DBLEND_ONE))
+        );
+        assert_eq!(
+            default_blend_for_transp_type(3),
+            Some((D3DBLEND_SRCCOLOR, D3DBLEND_INVSRCCOLOR))
+        );
+        assert_eq!(
+            default_blend_for_transp_type(4),
+            Some((D3DBLEND_SRCALPHA, D3DBLEND_DESTALPHA))
+        );
+        assert_eq!(
+            default_blend_for_transp_type(5),
+            Some((D3DBLEND_ZERO, D3DBLEND_INVSRCCOLOR))
+        );
+        assert_eq!(
+            default_blend_for_transp_type(6),
+            Some((D3DBLEND_ONE, D3DBLEND_ONE))
+        );
+        assert_eq!(
+            default_blend_for_transp_type(7),
+            Some((D3DBLEND_ONE, D3DBLEND_ONE))
+        );
+        assert_eq!(
+            default_blend_for_transp_type(8),
+            Some((D3DBLEND_ONE, D3DBLEND_ONE))
+        );
+    }
+
+    #[test]
+    fn transp_types_6_to_8_canonicalize_to_type_1() {
+        for transp in 6..=8 {
+            assert_eq!(canonicalize_transp_type(transp), lmo::TRANSP_ADDITIVE);
+        }
+    }
+
+    #[test]
+    fn build_material_additive_alpha_test_uses_mask_and_suffix() {
+        let mat = lmo::LmoMaterial {
+            diffuse: [0.5, 0.6, 0.7, 1.0],
+            ambient: [0.1, 0.1, 0.1, 1.0],
+            emissive: [0.0, 0.0, 0.0, 0.0],
+            opacity: 1.0,
+            transp_type: lmo::TRANSP_ADDITIVE,
+            alpha_test_enabled: true,
+            alpha_ref: 129,
+            src_blend: None,
+            dest_blend: None,
+            tex_filename: None,
+        };
+        let mut builder = GltfBuilder::new();
+        let tmp = std::env::temp_dir();
+        build_lmo_material(&mut builder, &mat, "test", &tmp, false);
+        let gltf_mat = &builder.materials[0];
+
+        assert_eq!(
+            gltf_mat.alpha_mode,
+            Checked::Valid(gltf_json::material::AlphaMode::Mask)
+        );
+        assert_eq!(gltf_mat.name.as_deref(), Some("test__PKO_T1_A129_O255"));
+    }
+
+    #[test]
+    fn build_material_transp_type_3_has_structured_suffix() {
+        let mat = lmo::LmoMaterial {
+            diffuse: [0.5, 0.6, 0.7, 1.0],
+            ambient: [0.1, 0.1, 0.1, 1.0],
+            emissive: [0.0, 0.0, 0.0, 0.0],
+            opacity: 1.0,
+            transp_type: lmo::TRANSP_ADDITIVE2,
+            alpha_test_enabled: false,
+            alpha_ref: 0,
+            src_blend: None,
+            dest_blend: None,
+            tex_filename: None,
+        };
+        let mut builder = GltfBuilder::new();
+        let tmp = std::env::temp_dir();
+        build_lmo_material(&mut builder, &mat, "test", &tmp, false);
+        let gltf_mat = &builder.materials[0];
+        assert_eq!(gltf_mat.name.as_deref(), Some("test__PKO_T3_A0_O255"));
+    }
```

Unity phase files from your prompt do exist, but outside this repo at:

- [/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader)
- [/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs)

I couldn’t patch those either due the same write restriction.

I also couldn’t run `cargo test`/`cargo clippy` in this session because build/test needs write access for artifacts.  

1. If you rerun with write-enabled sandbox, I’ll apply this patch directly and run the verification commands end-to-end.
