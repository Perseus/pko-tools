use std::path::Path;

use super::analysis::{self, MeshAnalysisReport};
use super::transform::{self, ScaleAnalysis};

#[tauri::command]
pub async fn analyze_mesh(file_path: String) -> Result<MeshAnalysisReport, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "gltf" | "glb" => {
            analysis::analyze_gltf_file(path).map_err(|e| format!("Failed to analyze glTF: {}", e))
        }
        "lgo" => {
            analysis::analyze_lgo_file(path).map_err(|e| format!("Failed to analyze LGO: {}", e))
        }
        _ => Err(format!(
            "Unsupported file format: .{}. Expected .gltf, .glb, or .lgo",
            ext
        )),
    }
}

#[tauri::command]
pub async fn analyze_mesh_scale(file_path: String) -> Result<ScaleAnalysis, String> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    transform::analyze_gltf_scale(path).map_err(|e| format!("Failed to analyze scale: {}", e))
}
