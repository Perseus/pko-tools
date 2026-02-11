use std::io::{Cursor, Read as IoRead};
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use gltf::json as gltf;
use gltf::{
    validation::{Checked, USize64},
    accessor::{ComponentType, GenericComponentType},
};
use image::RgbImage;
use serde_json::value::RawValue;

use super::{MapEntry, MapMetadata};
use crate::map::scene_model::LoadedSceneModels;
use crate::map::scene_obj::{parse_obj_file, ParsedObjFile};

// ============================================================================
// Map file constants
// ============================================================================

const CUR_VERSION_NO: i32 = 780627; // MP_MAP_FLAG(780624) + 3

// ============================================================================
// Parsed structures
// ============================================================================

#[derive(Debug)]
pub struct MapHeader {
    pub n_map_flag: i32,
    pub n_width: i32,
    pub n_height: i32,
    pub n_section_width: i32,
    pub n_section_height: i32,
}

#[derive(Debug, Clone)]
pub struct MapTile {
    pub dw_tile_info: u32,
    pub bt_tile_info: u8,
    pub s_color: i16,
    pub c_height: i8,
    pub s_region: i16,
    pub bt_island: u8,
    pub bt_block: [u8; 4],
}

#[derive(Debug)]
pub struct MapSection {
    pub tiles: Vec<MapTile>,
}

#[derive(Debug)]
pub struct ParsedMap {
    pub header: MapHeader,
    pub section_cnt_x: i32,
    pub section_cnt_y: i32,
    pub section_offsets: Vec<u32>,
    pub sections: Vec<Option<MapSection>>,
}

// ============================================================================
// Byte reading helpers
// ============================================================================

fn read_i32(cursor: &mut Cursor<&[u8]>) -> Result<i32> {
    let mut buf = [0u8; 4];
    cursor.read_exact(&mut buf)?;
    Ok(i32::from_le_bytes(buf))
}

fn read_u32(cursor: &mut Cursor<&[u8]>) -> Result<u32> {
    let mut buf = [0u8; 4];
    cursor.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_i16(cursor: &mut Cursor<&[u8]>) -> Result<i16> {
    let mut buf = [0u8; 2];
    cursor.read_exact(&mut buf)?;
    Ok(i16::from_le_bytes(buf))
}

fn read_u8(cursor: &mut Cursor<&[u8]>) -> Result<u8> {
    let mut buf = [0u8; 1];
    cursor.read_exact(&mut buf)?;
    Ok(buf[0])
}

fn read_i8(cursor: &mut Cursor<&[u8]>) -> Result<i8> {
    let mut buf = [0u8; 1];
    cursor.read_exact(&mut buf)?;
    Ok(buf[0] as i8)
}

// ============================================================================
// Color conversion
// ============================================================================

/// Convert RGB565 (stored as i16) to (R, G, B) floats in 0..1.
///
/// Matches the client's LW_RGB565TODWORD macro:
///   R = (rgb & 0xf800) >> 8   (5 bits → top of byte)
///   G = (rgb & 0x07e0) >> 3   (6 bits → top of byte)
///   B = (rgb & 0x001f) << 3   (5 bits → top of byte)
pub fn rgb565_to_float(color: i16) -> (f32, f32, f32) {
    let c = color as u16;
    let r = ((c & 0xf800) >> 8) as f32 / 255.0;
    let g = ((c & 0x07e0) >> 3) as f32 / 255.0;
    let b = ((c & 0x001f) << 3) as f32 / 255.0;
    (r, g, b)
}

// ============================================================================
// Map parser
// ============================================================================

pub fn parse_map(data: &[u8]) -> Result<ParsedMap> {
    let mut cursor = Cursor::new(data);

    // Read header (20 bytes)
    let header = MapHeader {
        n_map_flag: read_i32(&mut cursor)?,
        n_width: read_i32(&mut cursor)?,
        n_height: read_i32(&mut cursor)?,
        n_section_width: read_i32(&mut cursor)?,
        n_section_height: read_i32(&mut cursor)?,
    };

    // Validate version
    if header.n_map_flag != CUR_VERSION_NO {
        return Err(anyhow!(
            "Unsupported map version: {}. Expected {}",
            header.n_map_flag,
            CUR_VERSION_NO
        ));
    }

    let section_cnt_x = header.n_width / header.n_section_width;
    let section_cnt_y = header.n_height / header.n_section_height;
    let section_cnt = (section_cnt_x * section_cnt_y) as usize;

    // Read section offsets
    let mut section_offsets = Vec::with_capacity(section_cnt);
    for _ in 0..section_cnt {
        section_offsets.push(read_u32(&mut cursor)?);
    }

    // Track the data start position (after header + offset table)
    let _data_start = cursor.position();

    // Read each section's tile data
    let tiles_per_section = (header.n_section_width * header.n_section_height) as usize;
    let mut sections = Vec::with_capacity(section_cnt);

    for offset in &section_offsets {
        if *offset == 0 {
            sections.push(None);
            continue;
        }

        // Offsets are absolute file positions; the data after the offset table
        // was read into memory starting at data_start, so we need to subtract
        // data_start to get the memory offset.
        // Actually, from the client source, offsets are stored as absolute file
        // positions. We have the full file data, so we seek to the absolute offset.
        cursor.set_position(*offset as u64);

        let mut tiles = Vec::with_capacity(tiles_per_section);
        for _ in 0..tiles_per_section {
            let tile = MapTile {
                dw_tile_info: read_u32(&mut cursor)?,
                bt_tile_info: read_u8(&mut cursor)?,
                s_color: read_i16(&mut cursor)?,
                c_height: read_i8(&mut cursor)?,
                s_region: read_i16(&mut cursor)?,
                bt_island: read_u8(&mut cursor)?,
                bt_block: {
                    let mut b = [0u8; 4];
                    cursor.read_exact(&mut b)?;
                    b
                },
            };
            tiles.push(tile);
        }

        sections.push(Some(MapSection { tiles }));
    }

    Ok(ParsedMap {
        header,
        section_cnt_x,
        section_cnt_y,
        section_offsets,
        sections,
    })
}

/// Scan `project_dir/map/` for `.map` files and build a list of available maps.
pub fn scan_maps(project_dir: &Path) -> Result<Vec<MapEntry>> {
    let map_dir = project_dir.join("map");
    if !map_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();

    for entry in std::fs::read_dir(&map_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("map") {
            continue;
        }

        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        // Quick-read just the header to get dimensions
        let data = std::fs::read(&path)?;
        if data.len() < 20 {
            continue;
        }

        let mut cursor = Cursor::new(data.as_slice());
        let flag = read_i32(&mut cursor)?;
        if flag != CUR_VERSION_NO {
            continue;
        }
        let width = read_i32(&mut cursor)?;
        let height = read_i32(&mut cursor)?;

        let obj_path = map_dir.join(format!("{}.obj", file_name));
        let rbo_path = map_dir.join(format!("{}.rbo", file_name));

        let display_name = file_name
            .chars()
            .enumerate()
            .map(|(i, c)| if i == 0 { c.to_ascii_uppercase() } else { c })
            .collect::<String>();

        entries.push(MapEntry {
            name: file_name,
            display_name,
            map_file: format!("map/{}.map", entry.path().file_stem().unwrap().to_str().unwrap()),
            has_obj: obj_path.exists(),
            has_rbo: rbo_path.exists(),
            width,
            height,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

// ============================================================================
// glTF terrain generation
// ============================================================================

/// Get the tile at absolute tile coordinates (tx, ty), returning None if the
/// section is empty or coords are out of bounds.
pub(crate) fn get_tile<'a>(map: &'a ParsedMap, tx: i32, ty: i32) -> Option<&'a MapTile> {
    if tx < 0 || ty < 0 || tx >= map.header.n_width || ty >= map.header.n_height {
        return None;
    }
    let sx = tx / map.header.n_section_width;
    let sy = ty / map.header.n_section_height;
    let section_idx = (sy * map.section_cnt_x + sx) as usize;
    let section = map.sections.get(section_idx)?.as_ref()?;
    let lx = (tx % map.header.n_section_width) as usize;
    let ly = (ty % map.header.n_section_height) as usize;
    let tile_idx = ly * map.header.n_section_width as usize + lx;
    section.tiles.get(tile_idx)
}

/// Convert tile height byte to glTF Y-coordinate.
/// Client code: `pTile->fHeight = (float)(tile.cHeight * 10) / 100.0f`
///
/// The root node has a uniform scale of MAP_VISUAL_SCALE (5.0) applied to
/// all axes.  X/Z need this scale (1 tile → 5 world-units).  But the
/// original engine does NOT scale heights by the world-scale factor — fHeight
/// is already in world units.  So we pre-divide by MAP_VISUAL_SCALE here so
/// that after the uniform 5× scale the vertex Y equals the original fHeight.
///
/// Result after Unity import: vertex Y × 5 = (c_height × 0.1 / 5) × 5
///                                         = c_height × 0.1  (original game height)
fn tile_height(tile: &MapTile) -> f32 {
    (tile.c_height as f32 * 10.0) / 100.0 / 5.0
}

/// Build a glTF JSON string representing the terrain mesh.
///
/// Coordinate system: Y-up (glTF standard). Tile (vx, vy) with height h
/// maps to position (vx, h, vy).
pub fn build_terrain_gltf(
    parsed_map: &ParsedMap,
    objects: Option<&ParsedObjFile>,
    atlas: Option<&RgbImage>,
    scene_models: Option<&LoadedSceneModels>,
) -> Result<String> {
    let w = parsed_map.header.n_width;
    let h = parsed_map.header.n_height;

    // Step 1: Build vertex grid of (w+1) * (h+1) vertices.
    // Each vertex at (vx, vy) uses the tile at (vx, vy) for height/color.
    let vw = (w + 1) as usize;
    let vh = (h + 1) as usize;
    let vertex_count = vw * vh;

    let mut positions: Vec<f32> = Vec::with_capacity(vertex_count * 3);
    let mut colors: Vec<f32> = Vec::with_capacity(vertex_count * 4);
    let mut heights: Vec<f32> = Vec::with_capacity(vertex_count);

    for vy in 0..vh {
        for vx in 0..vw {
            // Tile coords: clamp to valid range
            let tx = (vx as i32).min(w - 1);
            let ty = (vy as i32).min(h - 1);

            let (height, r, g, b) = match get_tile(parsed_map, tx, ty) {
                Some(tile) => {
                    let (cr, cg, cb) = rgb565_to_float(tile.s_color);
                    (tile_height(tile), cr, cg, cb)
                }
                None => (0.0, 0.5, 0.5, 0.5),
            };

            // Position: X = vx, Y = height, Z = vy (Y-up, glTF standard)
            positions.push(vx as f32);
            positions.push(height);
            positions.push(vy as f32);

            colors.push(r);
            colors.push(g);
            colors.push(b);
            colors.push(1.0);

            heights.push(height);
        }
    }

    // Build UV coordinates if atlas is provided.
    // Each vertex (vx, vy) maps to UV (vx / w, vy / h). The atlas has multiple
    // pixels per tile, so a quad spanning tile (tx, ty) correctly covers that
    // tile's pixel block in the atlas.
    let uvs: Option<Vec<f32>> = atlas.map(|_| {
        let mut uv = Vec::with_capacity(vertex_count * 2);
        let fw = w as f32;
        let fh = h as f32;
        for vy in 0..vh {
            for vx in 0..vw {
                uv.push(vx as f32 / fw);
                uv.push(vy as f32 / fh);
            }
        }
        uv
    });

    // Step 2: Build triangle indices for non-empty tiles.
    // Each tile at (tx, ty) → 2 triangles using corner vertices.
    let mut indices: Vec<u32> = Vec::new();

    for ty in 0..h {
        for tx in 0..w {
            // Check if this tile has data (section is non-empty)
            if get_tile(parsed_map, tx, ty).is_none() {
                continue;
            }

            let v00 = (ty as u32) * (vw as u32) + (tx as u32);
            let v10 = v00 + 1;
            let v01 = v00 + vw as u32;
            let v11 = v01 + 1;

            // Triangle 1: v00, v01, v10
            indices.push(v00);
            indices.push(v01);
            indices.push(v10);

            // Triangle 2: v10, v01, v11
            indices.push(v10);
            indices.push(v01);
            indices.push(v11);
        }
    }

    if indices.is_empty() {
        return Err(anyhow!("Map has no visible terrain tiles"));
    }

    // Step 3: Compute per-vertex normals by averaging adjacent face normals.
    let mut normals = vec![[0.0f32; 3]; vertex_count];

    for tri in indices.chunks(3) {
        let i0 = tri[0] as usize;
        let i1 = tri[1] as usize;
        let i2 = tri[2] as usize;

        let p0 = [
            positions[i0 * 3],
            positions[i0 * 3 + 1],
            positions[i0 * 3 + 2],
        ];
        let p1 = [
            positions[i1 * 3],
            positions[i1 * 3 + 1],
            positions[i1 * 3 + 2],
        ];
        let p2 = [
            positions[i2 * 3],
            positions[i2 * 3 + 1],
            positions[i2 * 3 + 2],
        ];

        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];

        let n = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
        ];

        for &idx in &[i0, i1, i2] {
            normals[idx][0] += n[0];
            normals[idx][1] += n[1];
            normals[idx][2] += n[2];
        }
    }

    // Normalize
    for n in &mut normals {
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        if len > 1e-8 {
            n[0] /= len;
            n[1] /= len;
            n[2] /= len;
        } else {
            *n = [0.0, 1.0, 0.0]; // default up (Y-up)
        }
    }

    // Step 4: Build binary buffers and glTF JSON.
    let mut buffers = vec![];
    let mut buffer_views = vec![];
    let mut accessors = vec![];

    // Compute position bounds
    let mut pos_min = [f32::MAX; 3];
    let mut pos_max = [f32::MIN; 3];
    for i in 0..vertex_count {
        for c in 0..3 {
            let v = positions[i * 3 + c];
            if v < pos_min[c] {
                pos_min[c] = v;
            }
            if v > pos_max[c] {
                pos_max[c] = v;
            }
        }
    }

    // Helper to add a buffer + view + accessor
    let mut add_vec3_accessor =
        |data: &[f32], name: &str, min: Option<[f32; 3]>, max: Option<[f32; 3]>| -> usize {
            let buf_idx = buffers.len();
            let bv_idx = buffer_views.len();
            let acc_idx = accessors.len();

            let bytes: Vec<u8> = data.iter().flat_map(|f| f.to_le_bytes()).collect();

            buffers.push(gltf::Buffer {
                byte_length: USize64(bytes.len() as u64),
                extensions: None,
                extras: None,
                name: Some(format!("{}_buffer", name)),
                uri: Some(format!(
                    "data:application/octet-stream;base64,{}",
                    BASE64_STANDARD.encode(&bytes)
                )),
            });

            buffer_views.push(gltf::buffer::View {
                buffer: gltf::Index::new(buf_idx as u32),
                byte_length: USize64(bytes.len() as u64),
                byte_offset: Some(USize64(0)),
                target: Some(Checked::Valid(gltf::buffer::Target::ArrayBuffer)),
                byte_stride: None,
                extensions: None,
                extras: None,
                name: Some(format!("{}_view", name)),
            });

            accessors.push(gltf::Accessor {
                buffer_view: Some(gltf::Index::new(bv_idx as u32)),
                byte_offset: Some(USize64(0)),
                component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
                count: USize64((data.len() / 3) as u64),
                extensions: None,
                extras: None,
                max: max.map(|m| serde_json::to_value(m).unwrap()),
                min: min.map(|m| serde_json::to_value(m).unwrap()),
                name: Some(format!("{}_accessor", name)),
                normalized: false,
                sparse: None,
                type_: Checked::Valid(gltf::accessor::Type::Vec3),
            });

            acc_idx
        };

    // Position accessor
    let pos_acc = add_vec3_accessor(&positions, "position", Some(pos_min), Some(pos_max));

    // Normal accessor
    let normal_data: Vec<f32> = normals.iter().flat_map(|n| n.iter().copied()).collect();
    let norm_acc = add_vec3_accessor(&normal_data, "normal", None, None);

    // Color accessor (VEC4)
    let col_buf_idx = buffers.len();
    let col_bv_idx = buffer_views.len();
    let col_acc_idx = accessors.len();

    let col_bytes: Vec<u8> = colors.iter().flat_map(|f| f.to_le_bytes()).collect();

    buffers.push(gltf::Buffer {
        byte_length: USize64(col_bytes.len() as u64),
        extensions: None,
        extras: None,
        name: Some("color_buffer".to_string()),
        uri: Some(format!(
            "data:application/octet-stream;base64,{}",
            BASE64_STANDARD.encode(&col_bytes)
        )),
    });

    buffer_views.push(gltf::buffer::View {
        buffer: gltf::Index::new(col_buf_idx as u32),
        byte_length: USize64(col_bytes.len() as u64),
        byte_offset: Some(USize64(0)),
        target: Some(Checked::Valid(gltf::buffer::Target::ArrayBuffer)),
        byte_stride: None,
        extensions: None,
        extras: None,
        name: Some("color_view".to_string()),
    });

    accessors.push(gltf::Accessor {
        buffer_view: Some(gltf::Index::new(col_bv_idx as u32)),
        byte_offset: Some(USize64(0)),
        component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
        count: USize64(vertex_count as u64),
        extensions: None,
        extras: None,
        max: None,
        min: None,
        name: Some("color_accessor".to_string()),
        normalized: false,
        sparse: None,
        type_: Checked::Valid(gltf::accessor::Type::Vec4),
    });

    // Index accessor
    let idx_buf_idx = buffers.len();
    let idx_bv_idx = buffer_views.len();
    let idx_acc_idx = accessors.len();

    let idx_bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();

    buffers.push(gltf::Buffer {
        byte_length: USize64(idx_bytes.len() as u64),
        extensions: None,
        extras: None,
        name: Some("index_buffer".to_string()),
        uri: Some(format!(
            "data:application/octet-stream;base64,{}",
            BASE64_STANDARD.encode(&idx_bytes)
        )),
    });

    buffer_views.push(gltf::buffer::View {
        buffer: gltf::Index::new(idx_buf_idx as u32),
        byte_length: USize64(idx_bytes.len() as u64),
        byte_offset: Some(USize64(0)),
        target: Some(Checked::Valid(
            gltf::buffer::Target::ElementArrayBuffer,
        )),
        byte_stride: None,
        extensions: None,
        extras: None,
        name: Some("index_view".to_string()),
    });

    accessors.push(gltf::Accessor {
        buffer_view: Some(gltf::Index::new(idx_bv_idx as u32)),
        byte_offset: Some(USize64(0)),
        component_type: Checked::Valid(GenericComponentType(ComponentType::U32)),
        count: USize64(indices.len() as u64),
        extensions: None,
        extras: None,
        max: None,
        min: None,
        name: Some("index_accessor".to_string()),
        normalized: false,
        sparse: None,
        type_: Checked::Valid(gltf::accessor::Type::Scalar),
    });

    // UV accessor (if atlas provided)
    let uv_acc_idx = if let Some(uv_data) = &uvs {
        let uv_buf_idx = buffers.len();
        let uv_bv_idx = buffer_views.len();
        let uv_acc = accessors.len();

        let uv_bytes: Vec<u8> = uv_data.iter().flat_map(|f| f.to_le_bytes()).collect();

        buffers.push(gltf::Buffer {
            byte_length: USize64(uv_bytes.len() as u64),
            extensions: None,
            extras: None,
            name: Some("uv_buffer".to_string()),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&uv_bytes)
            )),
        });

        buffer_views.push(gltf::buffer::View {
            buffer: gltf::Index::new(uv_buf_idx as u32),
            byte_length: USize64(uv_bytes.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(Checked::Valid(gltf::buffer::Target::ArrayBuffer)),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some("uv_view".to_string()),
        });

        accessors.push(gltf::Accessor {
            buffer_view: Some(gltf::Index::new(uv_bv_idx as u32)),
            byte_offset: Some(USize64(0)),
            component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
            count: USize64(vertex_count as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some("uv_accessor".to_string()),
            normalized: false,
            sparse: None,
            type_: Checked::Valid(gltf::accessor::Type::Vec2),
        });

        Some(uv_acc)
    } else {
        None
    };

    // Build attributes
    let mut attributes = std::collections::BTreeMap::new();
    attributes.insert(
        Checked::Valid(gltf::mesh::Semantic::Positions),
        gltf::Index::new(pos_acc as u32),
    );
    attributes.insert(
        Checked::Valid(gltf::mesh::Semantic::Normals),
        gltf::Index::new(norm_acc as u32),
    );
    attributes.insert(
        Checked::Valid(gltf::mesh::Semantic::Colors(0)),
        gltf::Index::new(col_acc_idx as u32),
    );
    if let Some(uv_acc) = uv_acc_idx {
        attributes.insert(
            Checked::Valid(gltf::mesh::Semantic::TexCoords(0)),
            gltf::Index::new(uv_acc as u32),
        );
    }

    // Build texture resources if atlas provided
    let mut images = vec![];
    let mut textures = vec![];
    let mut samplers = vec![];

    let base_color_texture = if let Some(atlas_img) = atlas {
        // Encode atlas as JPEG — much smaller than PNG for terrain textures,
        // allowing higher resolution atlases within reasonable file sizes.
        let mut jpg_buf = std::io::Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg_buf, 85);
        atlas_img
            .write_with_encoder(encoder)
            .map_err(|e| anyhow!("Failed to encode atlas JPEG: {}", e))?;
        let jpg_bytes = jpg_buf.into_inner();

        images.push(gltf::Image {
            buffer_view: None,
            mime_type: Some(gltf::image::MimeType("image/jpeg".to_string())),
            uri: Some(format!(
                "data:image/jpeg;base64,{}",
                BASE64_STANDARD.encode(&jpg_bytes)
            )),
            name: Some("terrain_atlas".to_string()),
            extensions: None,
            extras: None,
        });

        // Linear sampler for smooth terrain texture blending
        samplers.push(gltf::texture::Sampler {
            mag_filter: Some(Checked::Valid(gltf::texture::MagFilter::Linear)),
            min_filter: Some(Checked::Valid(gltf::texture::MinFilter::Linear)),
            wrap_s: Checked::Valid(gltf::texture::WrappingMode::ClampToEdge),
            wrap_t: Checked::Valid(gltf::texture::WrappingMode::ClampToEdge),
            name: Some("terrain_sampler".to_string()),
            extensions: None,
            extras: None,
        });

        textures.push(gltf::Texture {
            sampler: Some(gltf::Index::new(0)),
            source: gltf::Index::new(0),
            name: Some("terrain_texture".to_string()),
            extensions: None,
            extras: None,
        });

        Some(gltf::texture::Info {
            index: gltf::Index::new(0),
            tex_coord: 0,
            extensions: None,
            extras: None,
        })
    } else {
        None
    };

    let material = gltf::Material {
        alpha_cutoff: None,
        alpha_mode: Checked::Valid(gltf::material::AlphaMode::Opaque),
        double_sided: true,
        pbr_metallic_roughness: gltf::material::PbrMetallicRoughness {
            base_color_factor: gltf::material::PbrBaseColorFactor([1.0, 1.0, 1.0, 1.0]),
            base_color_texture: base_color_texture,
            metallic_factor: gltf::material::StrengthFactor(0.0),
            roughness_factor: gltf::material::StrengthFactor(1.0),
            metallic_roughness_texture: None,
            extensions: None,
            extras: None,
        },
        normal_texture: None,
        occlusion_texture: None,
        emissive_texture: None,
        emissive_factor: gltf::material::EmissiveFactor([0.0, 0.0, 0.0]),
        extensions: None,
        extras: None,
        name: Some("terrain_material".to_string()),
    };

    let primitive = gltf::mesh::Primitive {
        attributes,
        indices: Some(gltf::Index::new(idx_acc_idx as u32)),
        material: Some(gltf::Index::new(0)),
        mode: Checked::Valid(gltf::mesh::Mode::Triangles),
        targets: None,
        extensions: None,
        extras: None,
    };

    let mesh = gltf::Mesh {
        name: Some("terrain".to_string()),
        primitives: vec![primitive],
        weights: None,
        extensions: None,
        extras: None,
    };

    // Build nodes — all children of a uniformly-scaled root node.
    // tile_height() pre-divides Y by this factor so that after the uniform
    // scale, vertex heights match the original game's fHeight values.
    const MAP_VISUAL_SCALE: f32 = 5.0;

    let mut nodes = vec![];
    let mut child_indices = vec![];

    // Terrain mesh node (index 0)
    nodes.push(gltf::Node {
        mesh: Some(gltf::Index::new(0)),
        name: Some("terrain_mesh".to_string()),
        ..Default::default()
    });
    child_indices.push(gltf::Index::new(0));

    // Merge scene model resources into the glTF arrays.
    // We need to offset mesh/material/accessor/buffer/buffer_view indices.
    let terrain_mesh_count = 1u32; // terrain mesh at index 0
    let terrain_material_count = 1u32; // terrain material at index 0
    let terrain_accessor_count = accessors.len() as u32;
    let terrain_buffer_count = buffers.len() as u32;
    let terrain_buffer_view_count = buffer_views.len() as u32;

    let mut scene_mesh_offset = terrain_mesh_count;
    let mut merged_meshes: Vec<gltf::Mesh> = vec![];
    let mut merged_materials: Vec<gltf::Material> = vec![];

    if let Some(sm) = scene_models {
        // Reindex and merge scene model buffers, views, accessors, materials, meshes
        let acc_offset = terrain_accessor_count;
        let buf_offset = terrain_buffer_count;
        let bv_offset = terrain_buffer_view_count;
        let mat_offset = terrain_material_count;

        // Buffers — just append
        for buf in &sm.buffers {
            buffers.push(buf.clone());
        }

        // Buffer views — offset buffer index
        for bv in &sm.buffer_views {
            let mut new_bv = bv.clone();
            new_bv.buffer = gltf::Index::new(bv.buffer.value() as u32 + buf_offset);
            buffer_views.push(new_bv);
        }

        // Accessors — offset buffer_view index
        for acc in &sm.accessors {
            let mut new_acc = acc.clone();
            if let Some(bv_idx) = acc.buffer_view {
                new_acc.buffer_view = Some(gltf::Index::new(bv_idx.value() as u32 + bv_offset));
            }
            accessors.push(new_acc);
        }

        // Images, samplers, textures — offset indices and append
        let img_offset = images.len() as u32;
        let sampler_offset = samplers.len() as u32;
        let tex_offset = textures.len() as u32;

        for img in &sm.images {
            images.push(img.clone());
        }
        for s in &sm.samplers {
            samplers.push(s.clone());
        }
        for t in &sm.textures {
            let mut new_tex = t.clone();
            new_tex.source = gltf::Index::new(t.source.value() as u32 + img_offset);
            if let Some(s_idx) = t.sampler {
                new_tex.sampler = Some(gltf::Index::new(s_idx.value() as u32 + sampler_offset));
            }
            textures.push(new_tex);
        }

        // Materials — offset texture indices and append
        for mat in &sm.materials {
            let mut new_mat = mat.clone();
            if let Some(ref mut tex_info) = new_mat.pbr_metallic_roughness.base_color_texture {
                tex_info.index = gltf::Index::new(tex_info.index.value() as u32 + tex_offset);
            }
            merged_materials.push(new_mat);
        }

        // Meshes — offset accessor indices in primitives and material indices
        for m in &sm.meshes {
            let mut new_mesh = m.clone();
            for prim in &mut new_mesh.primitives {
                // Offset accessor indices in attributes
                let mut new_attrs = std::collections::BTreeMap::new();
                for (sem, idx) in &prim.attributes {
                    new_attrs.insert(
                        sem.clone(),
                        gltf::Index::new(idx.value() as u32 + acc_offset),
                    );
                }
                prim.attributes = new_attrs;

                // Offset index accessor
                if let Some(idx) = prim.indices {
                    prim.indices = Some(gltf::Index::new(idx.value() as u32 + acc_offset));
                }

                // Offset material
                if let Some(mat_idx) = prim.material {
                    prim.material = Some(gltf::Index::new(mat_idx.value() as u32 + mat_offset));
                }
            }
            merged_meshes.push(new_mesh);
        }

        scene_mesh_offset = terrain_mesh_count;
    }

    // Scene object marker nodes (with optional mesh references for buildings)
    if let Some(obj_file) = objects {
        for (i, obj) in obj_file.objects.iter().enumerate() {
            let node_idx = nodes.len() as u32;
            let extras_json = serde_json::to_string(&serde_json::json!({
                "objectType": obj.obj_type,
                "objectId": obj.obj_id,
                "yawAngle": obj.yaw_angle,
                "scale": obj.scale,
            }))?;

            // Look up terrain height at the object's XZ position
            let terrain_h = get_tile(parsed_map, obj.world_x as i32, obj.world_y as i32)
                .map(|t| tile_height(t))
                .unwrap_or(0.0);

            // Check if we have a loaded mesh for this type-0 object
            let mesh_ref = if obj.obj_type == 0 {
                scene_models
                    .and_then(|sm| sm.model_mesh_map.get(&(obj.obj_id as u32)))
                    .map(|&local_idx| gltf::Index::new(scene_mesh_offset + local_idx as u32))
            } else {
                None
            };

            // Compute yaw rotation quaternion around Y axis
            let rotation = if obj.yaw_angle != 0 {
                let angle_rad = (obj.yaw_angle as f32).to_radians();
                let half = angle_rad / 2.0;
                // Quaternion: [x, y, z, w] for rotation around Y
                Some([0.0, half.sin(), 0.0, half.cos()])
            } else {
                None
            };

            nodes.push(gltf::Node {
                name: Some(format!("obj_{}_{}", obj.obj_type, i)),
                mesh: mesh_ref,
                // Y-up: X = world_x, Y = terrain_height + height_offset, Z = world_y
                // world_z divided by 5.0 to match tile_height's pre-division
                translation: Some([obj.world_x, terrain_h + obj.world_z / 5.0, obj.world_y]),
                rotation: rotation.map(|r| gltf::scene::UnitQuaternion(r)),
                extras: Some(RawValue::from_string(extras_json)?),
                ..Default::default()
            });
            child_indices.push(gltf::Index::new(node_idx));
        }
    }

    // Root node applies uniform scale to all children.
    // Heights are pre-divided by MAP_VISUAL_SCALE so that after the uniform
    // scale, vertical positions match the original game's unscaled fHeight.
    let root_node_idx = nodes.len() as u32;
    nodes.push(gltf::Node {
        name: Some("map_root".to_string()),
        children: Some(child_indices),
        scale: Some([MAP_VISUAL_SCALE, MAP_VISUAL_SCALE, MAP_VISUAL_SCALE]),
        ..Default::default()
    });

    let scene = gltf::Scene {
        nodes: vec![gltf::Index::new(root_node_idx)],
        name: Some("MapScene".to_string()),
        extensions: None,
        extras: None,
    };

    // Combine terrain mesh with scene model meshes
    let mut all_meshes = vec![mesh];
    all_meshes.extend(merged_meshes);

    let mut all_materials = vec![material];
    all_materials.extend(merged_materials);

    let root = gltf::Root {
        asset: gltf::Asset {
            version: "2.0".to_string(),
            generator: Some("pko-tools".to_string()),
            ..Default::default()
        },
        nodes,
        scenes: vec![scene],
        scene: Some(gltf::Index::new(0)),
        accessors,
        buffers,
        buffer_views,
        meshes: all_meshes,
        materials: all_materials,
        images,
        textures,
        samplers,
        ..Default::default()
    };

    let gltf_json = serde_json::to_string(&root)?;
    Ok(gltf_json)
}

/// Export terrain as glTF file to disk (separate .gltf + .bin).
pub fn export_terrain_gltf(
    project_dir: &Path,
    map_name: &str,
    output_dir: &Path,
) -> Result<super::MapExportResult> {
    let map_path = project_dir.join("map").join(format!("{}.map", map_name));
    let map_data = std::fs::read(&map_path)
        .with_context(|| format!("Failed to read map file: {}", map_path.display()))?;
    let parsed_map = parse_map(&map_data)?;

    // Try to load .obj file
    let obj_path = project_dir.join("map").join(format!("{}.obj", map_name));
    let objects = if obj_path.exists() {
        let obj_data = std::fs::read(&obj_path)?;
        parse_obj_file(&obj_data).ok()
    } else {
        None
    };

    // Try to bake terrain texture atlas (graceful fallback if missing)
    let atlas = super::texture::try_bake_atlas(project_dir, &parsed_map);

    // Try to load scene models for buildings
    let scene_models = if let Some(ref obj_file) = objects {
        let obj_info = super::scene_obj_info::load_scene_obj_info(project_dir).unwrap_or_default();
        super::scene_model::load_scene_models(project_dir, &obj_info, &obj_file.objects).ok()
    } else {
        None
    };

    // Build the glTF (embedded data URIs)
    let gltf_json = build_terrain_gltf(
        &parsed_map,
        objects.as_ref(),
        atlas.as_ref(),
        scene_models.as_ref(),
    )?;

    std::fs::create_dir_all(output_dir)?;
    let gltf_path = output_dir.join(format!("{}.gltf", map_name));
    std::fs::write(&gltf_path, gltf_json.as_bytes())?;

    Ok(super::MapExportResult {
        gltf_path: gltf_path.to_string_lossy().to_string(),
        bin_path: String::new(), // embedded in data URIs
        map_name: map_name.to_string(),
    })
}

/// Build glTF JSON for the in-app viewer (returns the JSON string directly).
pub fn build_map_viewer_gltf(project_dir: &Path, map_name: &str) -> Result<String> {
    let map_path = project_dir.join("map").join(format!("{}.map", map_name));
    let map_data = std::fs::read(&map_path)
        .with_context(|| format!("Failed to read map file: {}", map_path.display()))?;
    let parsed_map = parse_map(&map_data)?;

    // Try to load .obj file
    let obj_path = project_dir.join("map").join(format!("{}.obj", map_name));
    let objects = if obj_path.exists() {
        let obj_data = std::fs::read(&obj_path)?;
        parse_obj_file(&obj_data).ok()
    } else {
        None
    };

    // Try to bake terrain texture atlas (graceful fallback if missing)
    let atlas = super::texture::try_bake_atlas(project_dir, &parsed_map);

    // Skip building models for now — loading hundreds of LMO files is too slow for the viewer
    let scene_models: Option<super::scene_model::LoadedSceneModels> = None;

    build_terrain_gltf(
        &parsed_map,
        objects.as_ref(),
        atlas.as_ref(),
        scene_models.as_ref(),
    )
}

/// Export a map as three separate pieces for Unity (or similar engines):
/// 1. Terrain-only glTF (no buildings embedded)
/// 2. Individual building glTFs (one per unique building type, with textures + animations)
/// 3. Placement manifest JSON (tells the engine where to instantiate each building)
pub fn export_map_for_unity(
    project_dir: &Path,
    map_name: &str,
    output_dir: &Path,
) -> Result<super::MapForUnityExportResult> {
    use std::collections::HashSet;

    // 1. Parse .map file
    let map_path = project_dir.join("map").join(format!("{}.map", map_name));
    let map_data = std::fs::read(&map_path)
        .with_context(|| format!("Failed to read map file: {}", map_path.display()))?;
    let parsed_map = parse_map(&map_data)?;

    // 2. Parse .obj file (scene objects)
    let obj_path = project_dir.join("map").join(format!("{}.obj", map_name));
    let objects = if obj_path.exists() {
        let obj_data = std::fs::read(&obj_path)?;
        Some(parse_obj_file(&obj_data)?)
    } else {
        None
    };

    // 3. Load sceneobjinfo for obj_id → filename mapping
    let obj_info = super::scene_obj_info::load_scene_obj_info(project_dir).unwrap_or_default();

    // 4. Bake terrain texture atlas
    let atlas = super::texture::try_bake_atlas(project_dir, &parsed_map);

    // 5. Build terrain-only glTF (no buildings)
    let terrain_gltf_json = build_terrain_gltf(&parsed_map, None, atlas.as_ref(), None)?;

    // 6. Write terrain glTF
    std::fs::create_dir_all(output_dir)?;
    let terrain_gltf_path = output_dir.join("terrain.gltf");
    std::fs::write(&terrain_gltf_path, terrain_gltf_json.as_bytes())?;

    // 7. Collect unique building obj_ids (type=0 only)
    let unique_obj_ids: HashSet<u16> = objects
        .as_ref()
        .map(|obj_file| {
            obj_file
                .objects
                .iter()
                .filter(|o| o.obj_type == 0)
                .map(|o| o.obj_id)
                .collect()
        })
        .unwrap_or_default();

    // 8. Export each unique building as its own glTF
    let buildings_dir = output_dir.join("buildings");
    std::fs::create_dir_all(&buildings_dir)?;

    let mut building_entries = Vec::new();

    for &obj_id in &unique_obj_ids {
        let info = match obj_info.get(&(obj_id as u32)) {
            Some(info) => info,
            None => continue, // Unknown obj_id, skip
        };

        let lmo_path = match super::scene_model::find_lmo_path(project_dir, &info.filename) {
            Some(p) => p,
            None => continue, // LMO not found, skip
        };

        let gltf_json = match super::scene_model::build_gltf_from_lmo(&lmo_path, project_dir) {
            Ok(json) => json,
            Err(_) => continue, // Failed to convert, skip
        };

        let stem = info
            .filename
            .strip_suffix(".lmo")
            .or_else(|| info.filename.strip_suffix(".LMO"))
            .unwrap_or(&info.filename);
        let gltf_filename = format!("{}.gltf", stem);
        let gltf_path = buildings_dir.join(&gltf_filename);
        std::fs::write(&gltf_path, gltf_json.as_bytes())?;

        building_entries.push(super::BuildingExportEntry {
            obj_id: obj_id as u32,
            filename: info.filename.clone(),
            gltf_path: gltf_path.to_string_lossy().to_string(),
        });
    }

    // 9. Build placement manifest JSON
    let mut placements = Vec::new();
    let mut buildings_map = serde_json::Map::new();

    // Build the buildings lookup in manifest
    for entry in &building_entries {
        let stem = entry
            .filename
            .strip_suffix(".lmo")
            .or_else(|| entry.filename.strip_suffix(".LMO"))
            .unwrap_or(&entry.filename);

        buildings_map.insert(
            entry.obj_id.to_string(),
            serde_json::json!({
                "gltf": format!("buildings/{}.gltf", stem),
                "filename": entry.filename,
            }),
        );
    }

    // Build placements array
    if let Some(ref obj_file) = objects {
        for obj in &obj_file.objects {
            if obj.obj_type != 0 {
                continue;
            }

            // Look up terrain height at the object's position.
            // tile_height() already pre-divides by 5.0 for the uniform root scale.
            // obj.world_z is in original game units, so divide it by 5.0 too.
            // After the MapImporter multiplies by world_scale (5.0):
            //   Y_final = (terrain_h + world_z/5) * 5 = original_fHeight + world_z
            let terrain_h = get_tile(&parsed_map, obj.world_x as i32, obj.world_y as i32)
                .map(|t| tile_height(t))
                .unwrap_or(0.0);

            placements.push(serde_json::json!({
                "obj_id": obj.obj_id,
                "position": [obj.world_x, terrain_h + obj.world_z / 5.0, obj.world_y],
                "rotation_y_degrees": obj.yaw_angle,
                "scale": obj.scale,
            }));
        }
    }

    // 10. Build collision grid (2x tile resolution) and region grid
    let w = parsed_map.header.n_width;
    let h = parsed_map.header.n_height;
    let col_w = (w * 2) as usize;
    let col_h = (h * 2) as usize;

    // Collision: 1 byte per sub-block, row-major (Y outer, X inner)
    // Each tile (tx, ty) has 4 sub-blocks in a 2x2 grid:
    //   bt_block[0] → (tx*2,   ty*2)     top-left
    //   bt_block[1] → (tx*2+1, ty*2)     top-right
    //   bt_block[2] → (tx*2,   ty*2+1)   bottom-left
    //   bt_block[3] → (tx*2+1, ty*2+1)   bottom-right
    let mut collision_data = vec![0u8; col_w * col_h];

    // Region: i16 per tile, little-endian, row-major
    let mut region_data = vec![0u8; (w as usize) * (h as usize) * 2];

    for ty in 0..h {
        for tx in 0..w {
            if let Some(tile) = get_tile(&parsed_map, tx, ty) {
                // Collision sub-blocks
                let cx = (tx * 2) as usize;
                let cy = (ty * 2) as usize;
                collision_data[cy * col_w + cx] = tile.bt_block[0];
                collision_data[cy * col_w + cx + 1] = tile.bt_block[1];
                collision_data[(cy + 1) * col_w + cx] = tile.bt_block[2];
                collision_data[(cy + 1) * col_w + cx + 1] = tile.bt_block[3];

                // Region
                let region_idx = ((ty as usize) * (w as usize) + (tx as usize)) * 2;
                region_data[region_idx..region_idx + 2]
                    .copy_from_slice(&tile.s_region.to_le_bytes());
            }
        }
    }

    let collision_b64 = BASE64_STANDARD.encode(&collision_data);
    let region_b64 = BASE64_STANDARD.encode(&region_data);

    let manifest = serde_json::json!({
        "map_name": map_name,
        "coordinate_system": "y_up",
        "world_scale": 5.0,
        "terrain_gltf": "terrain.gltf",
        "map_width_tiles": w,
        "map_height_tiles": h,
        "section_width": parsed_map.header.n_section_width,
        "section_height": parsed_map.header.n_section_height,
        "buildings": buildings_map,
        "placements": placements,
        "collision_grid": {
            "width": col_w,
            "height": col_h,
            "tile_size": 0.5,
            "description": "1 byte per sub-block at 2x tile resolution. 0=walkable, nonzero=blocked. Row-major order (Y outer, X inner). World position of sub-block (sx, sy) = (sx * tile_size * world_scale, sy * tile_size * world_scale).",
            "data": collision_b64,
        },
        "region_grid": {
            "width": w,
            "height": h,
            "tile_size": 1.0,
            "description": "i16 little-endian per tile. Zone/region ID for gameplay rules. Row-major order (Y outer, X inner).",
            "data": region_b64,
        },
    });

    let manifest_path = output_dir.join("manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    std::fs::write(&manifest_path, manifest_json.as_bytes())?;

    Ok(super::MapForUnityExportResult {
        output_dir: output_dir.to_string_lossy().to_string(),
        terrain_gltf_path: terrain_gltf_path.to_string_lossy().to_string(),
        building_gltf_paths: building_entries,
        manifest_path: manifest_path.to_string_lossy().to_string(),
        total_buildings_exported: unique_obj_ids.len() as u32,
        total_placements: placements.len() as u32,
    })
}

/// Get metadata for a map without building the full glTF.
pub fn get_metadata(project_dir: &Path, map_name: &str) -> Result<MapMetadata> {
    let map_path = project_dir.join("map").join(format!("{}.map", map_name));
    let map_data = std::fs::read(&map_path)
        .with_context(|| format!("Failed to read map file: {}", map_path.display()))?;
    let parsed_map = parse_map(&map_data)?;

    let total_sections = parsed_map.section_offsets.len() as u32;
    let non_empty = parsed_map.section_offsets.iter().filter(|&&o| o != 0).count() as u32;
    let total_tiles = non_empty
        * (parsed_map.header.n_section_width * parsed_map.header.n_section_height) as u32;

    // Count objects if .obj file exists
    let obj_path = project_dir.join("map").join(format!("{}.obj", map_name));
    let object_count = if obj_path.exists() {
        let obj_data = std::fs::read(&obj_path)?;
        parse_obj_file(&obj_data)
            .map(|o| o.objects.len() as u32)
            .unwrap_or(0)
    } else {
        0
    };

    Ok(MapMetadata {
        name: map_name.to_string(),
        width: parsed_map.header.n_width,
        height: parsed_map.header.n_height,
        section_width: parsed_map.header.n_section_width,
        section_height: parsed_map.header.n_section_height,
        total_sections,
        non_empty_sections: non_empty,
        total_tiles,
        object_count,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb565_white() {
        let (r, g, b) = rgb565_to_float(-1i16); // 0xFFFF
        assert!(r > 0.95);
        assert!(g > 0.95);
        assert!(b > 0.95);
    }

    #[test]
    fn rgb565_black() {
        let (r, g, b) = rgb565_to_float(0);
        assert!(r < 0.01);
        assert!(g < 0.01);
        assert!(b < 0.01);
    }

    #[test]
    fn rgb565_red() {
        // Pure red in RGB565: 0xF800
        let (r, g, b) = rgb565_to_float(0xF800u16 as i16);
        assert!(r > 0.9, "r={}", r);
        assert!(g < 0.05, "g={}", g);
        assert!(b < 0.05, "b={}", b);
    }

    #[test]
    fn rgb565_green() {
        // Pure green in RGB565: 0x07E0
        let (r, g, b) = rgb565_to_float(0x07E0u16 as i16);
        assert!(r < 0.05, "r={}", r);
        assert!(g > 0.9, "g={}", g);
        assert!(b < 0.05, "b={}", b);
    }

    #[test]
    fn rgb565_blue() {
        // Pure blue in RGB565: 0x001F
        let (r, g, b) = rgb565_to_float(0x001Fu16 as i16);
        assert!(r < 0.05, "r={}", r);
        assert!(g < 0.05, "g={}", g);
        assert!(b > 0.9, "b={}", b);
    }

    #[test]
    fn tile_height_conversion() {
        let tile = MapTile {
            dw_tile_info: 0,
            bt_tile_info: 0,
            s_color: 0,
            c_height: 10,
            s_region: 0,
            bt_island: 0,
            bt_block: [0; 4],
        };
        let h = tile_height(&tile);
        // cHeight=10 → raw 1.0 / 5.0 = 0.2 (pre-divided for uniform 5× root scale)
        assert!((h - 0.2).abs() < 0.01, "height={}", h);

        let tile2 = MapTile {
            c_height: -5,
            ..tile
        };
        let h2 = tile_height(&tile2);
        // cHeight=-5 → raw -0.5 / 5.0 = -0.1
        assert!((h2 - (-0.1)).abs() < 0.01, "height={}", h2);
    }

    #[test]
    fn parse_real_map() {
        let map_path = std::path::Path::new("../top-client/map/garner.map");
        if !map_path.exists() {
            return;
        }

        let data = std::fs::read(map_path).unwrap();
        let parsed = parse_map(&data).unwrap();

        assert!(parsed.header.n_width > 0);
        assert!(parsed.header.n_height > 0);
        assert!(parsed.header.n_section_width > 0);
        assert!(parsed.header.n_section_height > 0);

        let non_empty = parsed.sections.iter().filter(|s| s.is_some()).count();
        assert!(non_empty > 0, "should have at least one non-empty section");

        eprintln!(
            "Map: {}x{}, sections: {}x{} ({}x{}), non-empty: {}",
            parsed.header.n_width,
            parsed.header.n_height,
            parsed.section_cnt_x,
            parsed.section_cnt_y,
            parsed.header.n_section_width,
            parsed.header.n_section_height,
            non_empty
        );
    }

    #[test]
    fn build_gltf_from_real_map() {
        let map_path = std::path::Path::new("../top-client/map/garner.map");
        if !map_path.exists() {
            return;
        }

        let data = std::fs::read(map_path).unwrap();
        let parsed = parse_map(&data).unwrap();

        let gltf_json = build_terrain_gltf(&parsed, None, None, None).unwrap();
        assert!(gltf_json.contains("\"asset\""));
        assert!(gltf_json.contains("terrain_mesh"));

        eprintln!("glTF JSON length: {} bytes", gltf_json.len());
    }
}
