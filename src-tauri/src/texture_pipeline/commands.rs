use std::path::Path;

use image::GenericImageView;
use serde::{Deserialize, Serialize};

use super::resizer;

#[derive(Debug, Serialize, Deserialize)]
pub struct TextureConversionPreview {
    pub original_width: u32,
    pub original_height: u32,
    pub final_width: u32,
    pub final_height: u32,
    pub alpha_stripped: bool,
    pub was_resized: bool,
}

/// Preview what a texture conversion would produce without writing files.
#[tauri::command]
pub async fn preview_texture_conversion(
    file_path: String,
) -> Result<TextureConversionPreview, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let img = image::open(path).map_err(|e| format!("Failed to open image: {}", e))?;
    let original_width = img.width();
    let original_height = img.height();
    let has_alpha = img.color().has_alpha();

    // Calculate what POT dimensions would be
    let mut final_width = resizer::next_power_of_two(original_width);
    let mut final_height = resizer::next_power_of_two(original_height);

    // Enforce max 2048
    let max_dim = 2048u32;
    if final_width > max_dim || final_height > max_dim {
        let scale = max_dim as f32 / final_width.max(final_height) as f32;
        final_width = resizer::prev_power_of_two(((final_width as f32 * scale) as u32).max(1)).max(1);
        final_height = resizer::prev_power_of_two(((final_height as f32 * scale) as u32).max(1)).max(1);
    }

    let was_resized = final_width != original_width || final_height != original_height;

    Ok(TextureConversionPreview {
        original_width,
        original_height,
        final_width,
        final_height,
        alpha_stripped: has_alpha,
        was_resized,
    })
}
