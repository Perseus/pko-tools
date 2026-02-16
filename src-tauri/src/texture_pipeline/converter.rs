use std::path::Path;

use image::{DynamicImage, GenericImageView, ImageFormat, Rgb, RgbImage};

use super::resizer;

/// Options for texture conversion.
#[derive(Debug, Clone)]
pub struct TextureConvertOptions {
    /// Whether to strip alpha channel (default: true for R8G8B8 output).
    pub strip_alpha: bool,
    /// Whether to enforce power-of-two dimensions.
    pub force_pot: bool,
    /// Maximum texture dimension (width or height).
    pub max_dimension: u32,
}

impl Default for TextureConvertOptions {
    fn default() -> Self {
        Self {
            strip_alpha: true,
            force_pot: true,
            max_dimension: 2048,
        }
    }
}

/// Result of a texture conversion.
#[derive(Debug)]
pub struct ConvertedTexture {
    /// The converted image (RGB, no alpha).
    pub image: DynamicImage,
    /// Original dimensions before conversion.
    pub original_width: u32,
    pub original_height: u32,
    /// Final dimensions after conversion.
    pub final_width: u32,
    pub final_height: u32,
    /// Whether alpha was stripped.
    pub alpha_stripped: bool,
    /// Whether the image was resized.
    pub was_resized: bool,
}

/// Convert a glTF image data blob to a BMP-compatible format.
///
/// Handles any input format (R8G8B8, R8G8B8A8, R16G16B16, etc.)
/// and converts to RGB8 BMP suitable for PKO.
pub fn convert_gltf_image_to_bmp(
    image_data: &gltf::image::Data,
    output_path: &Path,
    options: &TextureConvertOptions,
) -> anyhow::Result<ConvertedTexture> {
    let dyn_img = gltf_image_to_dynamic(image_data)?;
    convert_dynamic_image_to_bmp(&dyn_img, output_path, options)
}

/// Convert any DynamicImage to a PKO-compatible BMP file.
pub fn convert_dynamic_image_to_bmp(
    img: &DynamicImage,
    output_path: &Path,
    options: &TextureConvertOptions,
) -> anyhow::Result<ConvertedTexture> {
    let original_width = img.width();
    let original_height = img.height();
    let had_alpha = img.color().has_alpha();

    // Step 1: Convert to RGB (strip alpha if present)
    let mut rgb_img: DynamicImage = if options.strip_alpha {
        DynamicImage::ImageRgb8(img.to_rgb8())
    } else {
        img.clone()
    };

    let mut was_resized = false;

    // Step 2: Enforce power-of-two dimensions
    if options.force_pot {
        let (w, h) = (rgb_img.width(), rgb_img.height());
        let pot_w = resizer::next_power_of_two(w);
        let pot_h = resizer::next_power_of_two(h);
        if pot_w != w || pot_h != h {
            rgb_img = resizer::resize_to(&rgb_img, pot_w, pot_h);
            was_resized = true;
        }
    }

    // Step 3: Enforce max dimension
    let (w, h) = (rgb_img.width(), rgb_img.height());
    if w > options.max_dimension || h > options.max_dimension {
        let scale = (options.max_dimension as f32) / (w.max(h) as f32);
        let new_w = ((w as f32 * scale) as u32).max(1);
        let new_h = ((h as f32 * scale) as u32).max(1);
        let pot_w = if options.force_pot {
            resizer::prev_power_of_two(new_w).max(1)
        } else {
            new_w
        };
        let pot_h = if options.force_pot {
            resizer::prev_power_of_two(new_h).max(1)
        } else {
            new_h
        };
        rgb_img = resizer::resize_to(&rgb_img, pot_w, pot_h);
        was_resized = true;
    }

    let final_width = rgb_img.width();
    let final_height = rgb_img.height();

    // Step 4: Save as BMP
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    rgb_img.save_with_format(output_path, ImageFormat::Bmp)?;

    Ok(ConvertedTexture {
        image: rgb_img,
        original_width,
        original_height,
        final_width,
        final_height,
        alpha_stripped: had_alpha && options.strip_alpha,
        was_resized,
    })
}

/// Convert gltf::image::Data to a DynamicImage.
pub fn gltf_image_to_dynamic(image_data: &gltf::image::Data) -> anyhow::Result<DynamicImage> {
    let w = image_data.width;
    let h = image_data.height;
    let pixels = &image_data.pixels;

    match image_data.format {
        gltf::image::Format::R8G8B8 => {
            let img = image::ImageBuffer::<Rgb<u8>, _>::from_raw(w, h, pixels.clone())
                .ok_or_else(|| anyhow::anyhow!("Failed to create RGB8 image buffer"))?;
            Ok(DynamicImage::ImageRgb8(img))
        }
        gltf::image::Format::R8G8B8A8 => {
            let img = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(w, h, pixels.clone())
                .ok_or_else(|| anyhow::anyhow!("Failed to create RGBA8 image buffer"))?;
            Ok(DynamicImage::ImageRgba8(img))
        }
        gltf::image::Format::R16G16B16 => {
            let img = image::ImageBuffer::<image::Rgb<u16>, _>::from_raw(
                w,
                h,
                bytemuck::cast_slice(pixels).to_vec(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create RGB16 image buffer"))?;
            Ok(DynamicImage::ImageRgb16(img))
        }
        gltf::image::Format::R16G16B16A16 => {
            let img = image::ImageBuffer::<image::Rgba<u16>, _>::from_raw(
                w,
                h,
                bytemuck::cast_slice(pixels).to_vec(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create RGBA16 image buffer"))?;
            Ok(DynamicImage::ImageRgba16(img))
        }
        gltf::image::Format::R8 => {
            let img = image::ImageBuffer::<image::Luma<u8>, _>::from_raw(w, h, pixels.clone())
                .ok_or_else(|| anyhow::anyhow!("Failed to create L8 image buffer"))?;
            Ok(DynamicImage::ImageLuma8(img))
        }
        gltf::image::Format::R8G8 => {
            let img = image::ImageBuffer::<image::LumaA<u8>, _>::from_raw(w, h, pixels.clone())
                .ok_or_else(|| anyhow::anyhow!("Failed to create LA8 image buffer"))?;
            Ok(DynamicImage::ImageLumaA8(img))
        }
        gltf::image::Format::R16 => {
            let img = image::ImageBuffer::<image::Luma<u16>, _>::from_raw(
                w,
                h,
                bytemuck::cast_slice(pixels).to_vec(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create L16 image buffer"))?;
            Ok(DynamicImage::ImageLuma16(img))
        }
        gltf::image::Format::R16G16 => {
            let img = image::ImageBuffer::<image::LumaA<u16>, _>::from_raw(
                w,
                h,
                bytemuck::cast_slice(pixels).to_vec(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create LA16 image buffer"))?;
            Ok(DynamicImage::ImageLumaA16(img))
        }
        gltf::image::Format::R32G32B32FLOAT => {
            let img = image::ImageBuffer::<image::Rgb<f32>, _>::from_raw(
                w,
                h,
                bytemuck::cast_slice(pixels).to_vec(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create RGB32F image buffer"))?;
            Ok(DynamicImage::ImageRgb32F(img))
        }
        gltf::image::Format::R32G32B32A32FLOAT => {
            let img = image::ImageBuffer::<image::Rgba<f32>, _>::from_raw(
                w,
                h,
                bytemuck::cast_slice(pixels).to_vec(),
            )
            .ok_or_else(|| anyhow::anyhow!("Failed to create RGBA32F image buffer"))?;
            Ok(DynamicImage::ImageRgba32F(img))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn convert_rgb8_identity() {
        let img = DynamicImage::ImageRgb8(RgbImage::new(64, 64));
        let tmp = TempDir::new().unwrap();
        let out = tmp.path().join("test.bmp");

        let result =
            convert_dynamic_image_to_bmp(&img, &out, &TextureConvertOptions::default()).unwrap();
        assert_eq!(result.original_width, 64);
        assert_eq!(result.final_width, 64);
        assert!(!result.alpha_stripped);
        assert!(!result.was_resized);
        assert!(out.exists());
    }

    #[test]
    fn convert_rgba8_strips_alpha() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::new(128, 128));
        let tmp = TempDir::new().unwrap();
        let out = tmp.path().join("test.bmp");

        let result =
            convert_dynamic_image_to_bmp(&img, &out, &TextureConvertOptions::default()).unwrap();
        assert!(result.alpha_stripped);
        assert_eq!(result.final_width, 128);
    }

    #[test]
    fn convert_npot_to_pot() {
        let img = DynamicImage::ImageRgb8(RgbImage::new(300, 500));
        let tmp = TempDir::new().unwrap();
        let out = tmp.path().join("test.bmp");

        let result =
            convert_dynamic_image_to_bmp(&img, &out, &TextureConvertOptions::default()).unwrap();
        assert!(result.was_resized);
        assert_eq!(result.final_width, 512);
        assert_eq!(result.final_height, 512);
    }

    #[test]
    fn convert_oversized_capped() {
        let img = DynamicImage::ImageRgb8(RgbImage::new(4096, 4096));
        let tmp = TempDir::new().unwrap();
        let out = tmp.path().join("test.bmp");

        let result =
            convert_dynamic_image_to_bmp(&img, &out, &TextureConvertOptions::default()).unwrap();
        assert!(result.was_resized);
        assert!(result.final_width <= 2048);
        assert!(result.final_height <= 2048);
    }
}
