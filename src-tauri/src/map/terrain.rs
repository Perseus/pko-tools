use std::io::{Cursor, Read as IoRead};
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use gltf::json as gltf;
use gltf::{
    accessor::{ComponentType, GenericComponentType},
    validation::{Checked, USize64},
};
use image::RgbImage;
use serde_json::value::RawValue;

use super::{MapEntry, MapMetadata};
use crate::effect::model::EffFile;
use crate::map::scene_model::LoadedSceneModels;
use crate::map::scene_obj::{parse_obj_file, ParsedObjFile};

// ============================================================================
// Map file constants
// ============================================================================

const CUR_VERSION_NO: i32 = 780627; // MP_MAP_FLAG(780624) + 3

// Original PKO terrain/sea defaults (Engine/sdk/include/MPMap.h)
pub(crate) const UNDERWATER_HEIGHT: f32 = -2.0;
pub(crate) const UNDERWATER_TEXNO: u8 = 22;

// PKO native unit scale exported to glTF scene (1 PKO unit = 1 glTF/Unity unit)
pub(crate) const MAP_VISUAL_SCALE: f32 = 1.0;

/// If serialized effect_definitions exceeds this size, export as sidecar file.
const SIDECAR_THRESHOLD: usize = 5 * 1024 * 1024; // 5MB

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
            map_file: format!(
                "map/{}.map",
                entry.path().file_stem().unwrap().to_str().unwrap()
            ),
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

/// Convert tile height byte to glTF Y coordinate.
/// Client code: `pTile->fHeight = (float)(tile.cHeight * 10) / 100.0f`
/// Export uses PKO native units (no extra visual scale), so Y equals fHeight.
fn tile_height(tile: &MapTile) -> f32 {
    (tile.c_height as f32 * 10.0) / 100.0 / MAP_VISUAL_SCALE
}

/// Resolve the terrain tile used for a render vertex.
///
/// PKO vertex ownership semantics are strict: vertex (vx, vy) samples
/// `GetTile(vx, vy)` directly. If that tile is out-of-range or section-missing,
/// the render path falls back to default underwater tile values.
fn get_render_vertex_tile<'a>(map: &'a ParsedMap, vx: i32, vy: i32) -> Option<&'a MapTile> {
    get_tile(map, vx, vy)
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
    // Each vertex at (vx, vy) samples tile owner (vx, vy) directly.
    // Missing/out-of-range owner tiles use default underwater fallback.
    let vw = (w + 1) as usize;
    let vh = (h + 1) as usize;
    let vertex_count = vw * vh;

    let mut positions: Vec<f32> = Vec::with_capacity(vertex_count * 3);
    let mut colors: Vec<f32> = Vec::with_capacity(vertex_count * 4);
    let mut heights: Vec<f32> = Vec::with_capacity(vertex_count);

    for vy in 0..vh {
        for vx in 0..vw {
            // Tile coords: strict owner semantics (no clamping)
            let tx = vx as i32;
            let ty = vy as i32;

            let (height, r, g, b) = match get_render_vertex_tile(parsed_map, tx, ty) {
                Some(tile) => {
                    let (cr, cg, cb) = rgb565_to_float(tile.s_color);
                    (tile_height(tile), cr, cg, cb)
                }
                // Match original client default tile for missing sections:
                // UNDERWATER_HEIGHT (-2.0) with white vertex color.
                None => (UNDERWATER_HEIGHT / MAP_VISUAL_SCALE, 1.0, 1.0, 1.0),
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

    // Step 2: Build triangle indices for map tiles that exist in section data.
    // Missing sections still participate in owner sampling defaults, but we do
    // not emit visible terrain triangles for them in exported geometry.
    // Each tile at (tx, ty) → 2 triangles using corner vertices.
    let mut indices: Vec<u32> = Vec::new();

    for ty in 0..h {
        for tx in 0..w {
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
        target: Some(Checked::Valid(gltf::buffer::Target::ElementArrayBuffer)),
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

    // Build nodes — all children of a scaled root node for visual sizing.
    // The game uses 1 tile = 1 world unit, but a uniform scale makes the
    // terrain feel more proportional when viewed in the 3D viewer.

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
                .unwrap_or(UNDERWATER_HEIGHT / MAP_VISUAL_SCALE);

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
                translation: Some([obj.world_x, terrain_h + obj.world_z, obj.world_y]),
                rotation: rotation.map(|r| gltf::scene::UnitQuaternion(r)),
                extras: Some(RawValue::from_string(extras_json)?),
                ..Default::default()
            });
            child_indices.push(gltf::Index::new(node_idx));
        }
    }

    // Root node keeps children in PKO native units (no extra visual scale)
    let root_node_idx = nodes.len() as u32;
    nodes.push(gltf::Node {
        name: Some("map_root".to_string()),
        children: Some(child_indices),
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

// ============================================================================
// Grid builders for manifest v2
// ============================================================================

/// Decode btBlock byte to object height using the original engine formula.
/// From MPTile.h `_getObjHeight`: bits 0-5 = magnitude (0-63),
/// bit 6 = sign (1 = negative), bit 7 = collision flag (ignored for height).
/// Returns height in original engine world units (range ±3.15).
pub fn decode_obj_height(bt_block_byte: u8) -> f32 {
    let magnitude = (bt_block_byte & 0x3F) as f32; // bits 0-5
    let signed = (bt_block_byte & 0x40) != 0; // bit 6
    let height = magnitude * 5.0 / 100.0;
    if signed {
        -height
    } else {
        height
    }
}

/// Build collision grid from tile bt_block[4] data at 2x tile resolution.
/// Returns (grid_bytes, width, height) where width=n_width*2, height=n_height*2.
/// Each byte is 1 (blocked) or 0 (walkable), extracted from bit 7 of btBlock.
fn build_collision_grid(map: &ParsedMap) -> (Vec<u8>, i32, i32) {
    let w = map.header.n_width * 2;
    let h = map.header.n_height * 2;
    let mut grid = vec![0u8; (w * h) as usize];

    for ty in 0..map.header.n_height {
        for tx in 0..map.header.n_width {
            if let Some(tile) = get_tile(map, tx, ty) {
                for sub_y in 0..2i32 {
                    for sub_x in 0..2i32 {
                        let cx = tx * 2 + sub_x;
                        let cy = ty * 2 + sub_y;
                        let idx = (cy * w + cx) as usize;
                        let block_idx = (sub_y * 2 + sub_x) as usize;
                        // Only store collision flag (bit 7). Previously stored
                        // the raw byte, which caused walkable cells with height
                        // data (bits 0-6) to be incorrectly treated as blocked.
                        grid[idx] = if tile.bt_block[block_idx] & 0x80 != 0 {
                            1
                        } else {
                            0
                        };
                    }
                }
            }
        }
    }

    (grid, w, h)
}

/// Build object height grid from tile btBlock[4] data at 2x tile resolution.
/// Each cell is an i16 in little-endian encoding representing height in
/// millimeters (height * 1000). This gives sub-millimeter precision for the
/// ±3.15 range while keeping the grid compact (2 bytes per cell).
/// Returns (grid_bytes, width, height).
fn build_obj_height_grid(map: &ParsedMap) -> (Vec<u8>, i32, i32) {
    let w = map.header.n_width * 2;
    let h = map.header.n_height * 2;
    // Pre-allocate as i16 array, then convert to bytes
    let mut grid_i16 = vec![0i16; (w * h) as usize];

    for ty in 0..map.header.n_height {
        for tx in 0..map.header.n_width {
            if let Some(tile) = get_tile(map, tx, ty) {
                for sub_y in 0..2i32 {
                    for sub_x in 0..2i32 {
                        let cx = tx * 2 + sub_x;
                        let cy = ty * 2 + sub_y;
                        let idx = (cy * w + cx) as usize;
                        let block_idx = (sub_y * 2 + sub_x) as usize;
                        let height = decode_obj_height(tile.bt_block[block_idx]);
                        grid_i16[idx] = (height * 1000.0).round() as i16;
                    }
                }
            } else {
                // Missing tile → UNDERWATER_HEIGHT for all 4 sub-tiles
                let uw = (UNDERWATER_HEIGHT * 1000.0).round() as i16;
                for sub_y in 0..2i32 {
                    for sub_x in 0..2i32 {
                        let cx = tx * 2 + sub_x;
                        let cy = ty * 2 + sub_y;
                        let idx = (cy * w + cx) as usize;
                        grid_i16[idx] = uw;
                    }
                }
            }
        }
    }

    // Convert i16 array to LE bytes
    let mut grid = Vec::with_capacity((w * h * 2) as usize);
    for val in &grid_i16 {
        grid.extend_from_slice(&val.to_le_bytes());
    }

    (grid, w, h)
}

/// Build region grid (sRegion i16 per tile). Returns raw i16 LE bytes.
fn build_region_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut data = Vec::with_capacity((w * h * 2) as usize);

    for ty in 0..h {
        for tx in 0..w {
            let region = get_tile(map, tx, ty).map(|t| t.s_region).unwrap_or(0);
            data.extend_from_slice(&region.to_le_bytes());
        }
    }

    data
}

/// Build area grid (btIsland u8 per tile).
fn build_area_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut grid = vec![0u8; (w * h) as usize];

    for ty in 0..h {
        for tx in 0..w {
            let island = get_tile(map, tx, ty).map(|t| t.bt_island).unwrap_or(0);
            grid[(ty * w + tx) as usize] = island;
        }
    }

    grid
}

/// Build tile texture grid (bt_tile_info per tile → u8).
/// This is the base layer (Layer 0) texture ID — the primary terrain texture
/// for each tile. Used by SeaRenderer for underwater tile detection (ID 22).
/// Missing sections use 0 sentinel.
fn build_tile_texture_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut grid = vec![0u8; (w * h) as usize];

    for ty in 0..h {
        for tx in 0..w {
            let tex_id = get_tile(map, tx, ty).map(|t| t.bt_tile_info).unwrap_or(0);
            grid[(ty * w + tx) as usize] = tex_id;
        }
    }

    grid
}

/// Build tile color grid (sColor i16 per tile). Returns raw i16 LE bytes.
fn build_tile_color_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut data = Vec::with_capacity((w * h * 2) as usize);

    for ty in 0..h {
        for tx in 0..w {
            let color = get_tile(map, tx, ty).map(|t| t.s_color).unwrap_or(0);
            data.extend_from_slice(&color.to_le_bytes());
        }
    }

    data
}

/// Find and load an .eff file from the project directory.
/// sceneffectinfo stores filenames with .par extension; actual files use .eff.
fn load_effect_file(project_dir: &Path, eff_filename: &str) -> Option<EffFile> {
    // Strip extension and try .eff
    let base = eff_filename
        .strip_suffix(".par")
        .or_else(|| eff_filename.strip_suffix(".PAR"))
        .or_else(|| eff_filename.strip_suffix(".eff"))
        .or_else(|| eff_filename.strip_suffix(".EFF"))
        .unwrap_or(eff_filename);

    let eff_path = project_dir.join("effect").join(format!("{}.eff", base));
    if eff_path.exists() {
        if let Ok(bytes) = std::fs::read(&eff_path) {
            return EffFile::from_bytes(&bytes).ok();
        }
    }

    // Try case-insensitive search in effect directory
    let effect_dir = project_dir.join("effect");
    if effect_dir.exists() {
        let target = format!("{}.eff", base).to_lowercase();
        if let Ok(entries) = std::fs::read_dir(&effect_dir) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().to_lowercase() == target {
                    if let Ok(bytes) = std::fs::read(entry.path()) {
                        return EffFile::from_bytes(&bytes).ok();
                    }
                }
            }
        }
    }

    None
}

/// Copy water textures from BMP to PNG format.
/// Copies ocean_h.01.bmp through ocean_h.30.bmp from the project's water texture directory.
fn copy_water_textures(project_dir: &Path, output_dir: &Path) -> Vec<String> {
    let water_dir = project_dir.join("texture/terrain/water");
    if !water_dir.exists() {
        return Vec::new();
    }

    let out_water_dir = output_dir.join("water");
    let _ = std::fs::create_dir_all(&out_water_dir);

    let mut copied = Vec::new();
    for i in 1..=30 {
        let bmp_name = format!("ocean_h.{:02}.bmp", i);
        let bmp_path = water_dir.join(&bmp_name);

        if !bmp_path.exists() {
            // Try case-insensitive
            let target = bmp_name.to_lowercase();
            let found = std::fs::read_dir(&water_dir).ok().and_then(|entries| {
                entries
                    .flatten()
                    .find(|e| e.file_name().to_string_lossy().to_lowercase() == target)
                    .map(|e| e.path())
            });

            if let Some(found_path) = found {
                if let Ok(img) = image::open(&found_path) {
                    let png_name = format!("ocean_h_{:02}.png", i);
                    let png_path = out_water_dir.join(&png_name);
                    if img.save(&png_path).is_ok() {
                        copied.push(format!("water/{}", png_name));
                    }
                }
            }
            continue;
        }

        if let Ok(img) = image::open(&bmp_path) {
            let png_name = format!("ocean_h_{:02}.png", i);
            let png_path = out_water_dir.join(&png_name);
            if img.save(&png_path).is_ok() {
                copied.push(format!("water/{}", png_name));
            }
        }
    }

    copied
}

/// Export a map as three separate pieces for Unity (or similar engines):
/// 1. Terrain-only glTF (no buildings embedded)
/// 2. Individual building glTFs (one per unique building type, with textures + animations)
/// 3. Manifest v2 JSON (grids, placements, effects, areas, environment)
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

    // 3b. Load AreaSet.bin for per-area definitions
    let area_defs = super::area_set::load_area_set(project_dir).unwrap_or_default();

    // 3c. Load mapinfo.bin for spawn point and per-map settings
    let map_infos = super::mapinfo::load_mapinfo(project_dir).unwrap_or_default();
    let this_map_info = super::mapinfo::find_map_info(&map_infos, map_name);

    // 3d. Load sceneffectinfo for effect_id → .eff filename mapping
    let effect_info =
        crate::item::sceneffect::load_scene_effect_info(project_dir).unwrap_or_default();

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

    // Build placements array (buildings, type=0) and effect placements (type=1)
    let mut effect_placements = Vec::new();
    let mut unique_eff_ids: HashSet<u16> = HashSet::new();
    let valid_building_ids: HashSet<u16> =
        building_entries.iter().map(|e| e.obj_id as u16).collect();

    if let Some(ref obj_file) = objects {
        for obj in &obj_file.objects {
            if obj.obj_type == 0 && !valid_building_ids.contains(&obj.obj_id) {
                continue;
            }

            // Look up terrain height at the object's position
            let terrain_h = get_tile(&parsed_map, obj.world_x as i32, obj.world_y as i32)
                .map(|t| tile_height(t))
                .unwrap_or(UNDERWATER_HEIGHT / MAP_VISUAL_SCALE);

            // Position in Y-up glTF space
            let position = [obj.world_x, terrain_h + obj.world_z, obj.world_y];

            if obj.obj_type == 0 {
                // Building placement
                placements.push(serde_json::json!({
                    "obj_id": obj.obj_id,
                    "position": position,
                    "rotation_y_degrees": obj.yaw_angle,
                    "scale": obj.scale,
                }));
            } else if obj.obj_type == 1 {
                // Effect placement
                effect_placements.push(serde_json::json!({
                    "eff_id": obj.obj_id,
                    "position": position,
                    "rotation_y_degrees": obj.yaw_angle,
                    "scale": obj.scale,
                }));
                unique_eff_ids.insert(obj.obj_id);
            }
        }
    }

    // 10. Build grids
    let (collision_bytes, coll_w, coll_h) = build_collision_grid(&parsed_map);
    let (obj_height_bytes, obj_h_w, obj_h_h) = build_obj_height_grid(&parsed_map);
    let region_bytes = build_region_grid(&parsed_map);
    let area_bytes = build_area_grid(&parsed_map);
    let tile_tex_bytes = build_tile_texture_grid(&parsed_map);
    let tile_color_bytes = build_tile_color_grid(&parsed_map);

    // Write grids as binary sidecar files (avoids 372MB base64-in-JSON for large maps)
    let grids_dir = output_dir.join("grids");
    std::fs::create_dir_all(&grids_dir)?;

    std::fs::write(grids_dir.join("collision.bin"), &collision_bytes)?;
    std::fs::write(grids_dir.join("obj_height.bin"), &obj_height_bytes)?;
    std::fs::write(grids_dir.join("region.bin"), &region_bytes)?;
    std::fs::write(grids_dir.join("area.bin"), &area_bytes)?;
    std::fs::write(grids_dir.join("tile_texture.bin"), &tile_tex_bytes)?;
    std::fs::write(grids_dir.join("tile_color.bin"), &tile_color_bytes)?;

    // 11. Build effect definitions from .eff files
    // Canonical schema: each effect's EffFile fields are flattened to the top level
    // alongside "filename", matching the plan's manifest v2 spec.
    let mut effect_definitions = serde_json::Map::new();
    let mut missing_effect_ids: Vec<u16> = Vec::new();
    for &eff_id in &unique_eff_ids {
        if let Some(eff_info) = effect_info.get(&(eff_id as u32)) {
            if let Some(eff_file) = load_effect_file(project_dir, &eff_info.filename) {
                if let Ok(serde_json::Value::Object(mut eff_obj)) = serde_json::to_value(&eff_file)
                {
                    // Flatten: merge filename into the EffFile object at the top level
                    eff_obj.insert("filename".to_string(), serde_json::json!(eff_info.filename));
                    effect_definitions
                        .insert(eff_id.to_string(), serde_json::Value::Object(eff_obj));
                } else {
                    eprintln!(
                        "Warning: effect {} ({}) failed to serialize",
                        eff_id, eff_info.filename
                    );
                    missing_effect_ids.push(eff_id);
                }
            } else {
                eprintln!(
                    "Warning: effect {} ({}) .eff file not found or failed to parse",
                    eff_id, eff_info.filename
                );
                missing_effect_ids.push(eff_id);
            }
        } else {
            eprintln!("Warning: effect {} not found in sceneffectinfo", eff_id);
            missing_effect_ids.push(eff_id);
        }
    }

    // 11b. Check effect_definitions size — if >5MB, export as sidecar file
    let eff_defs_json_value = serde_json::Value::Object(effect_definitions.clone());
    let eff_defs_size = serde_json::to_string(&eff_defs_json_value)
        .map(|s| s.len())
        .unwrap_or(0);
    // Defined at module scope as SIDECAR_THRESHOLD

    let use_sidecar = eff_defs_size > SIDECAR_THRESHOLD;

    if use_sidecar {
        let sidecar_path = output_dir.join("effect_definitions.json");
        let sidecar_json = serde_json::to_string_pretty(&eff_defs_json_value)?;
        std::fs::write(&sidecar_path, sidecar_json.as_bytes())?;
    }

    // 12. Build areas dict from AreaSet.bin
    let areas_json = super::area_set::areas_to_json(&area_defs);

    // 13. Build spawn point and environment from mapinfo.bin
    let spawn_point = this_map_info.map(|info| {
        serde_json::json!({
            "tile_x": info.init_x,
            "tile_y": info.init_y,
        })
    });

    // Default environment settings (from original PKO engine)
    let light_direction = this_map_info
        .map(|info| info.light_dir)
        .unwrap_or([-1.0, -1.0, -1.0]);
    let light_color = this_map_info
        .map(|info| {
            [
                info.light_color[0] as f32 / 255.0,
                info.light_color[1] as f32 / 255.0,
                info.light_color[2] as f32 / 255.0,
            ]
        })
        .unwrap_or([0.6, 0.6, 0.6]);

    // 14. Copy water textures
    let water_textures = copy_water_textures(project_dir, output_dir);

    // 14b. Export individual terrain textures for runtime blending (Phase E)
    let terrain_textures =
        super::texture::export_terrain_textures(project_dir, &parsed_map, output_dir)
            .unwrap_or_default();

    // 14c. Export alpha mask atlas (Phase E)
    let alpha_atlas_path =
        super::texture::export_alpha_atlas(project_dir, output_dir).unwrap_or(None);

    // 14d. Build tile layer grid (Phase E) — 7 bytes per tile
    let tile_layer_bytes = super::texture::build_tile_layer_grid(&parsed_map);
    std::fs::write(grids_dir.join("tile_layer.bin"), &tile_layer_bytes)?;

    // 15. Build manifest v2 JSON
    // Build manifest as a Map so we can conditionally include/omit keys
    let mut manifest_map = serde_json::Map::new();
    manifest_map.insert("version".into(), serde_json::json!(2));
    manifest_map.insert("map_name".into(), serde_json::json!(map_name));
    manifest_map.insert("coordinate_system".into(), serde_json::json!("y_up"));
    manifest_map.insert("world_scale".into(), serde_json::json!(MAP_VISUAL_SCALE));
    manifest_map.insert(
        "unit_scale_contract".into(),
        serde_json::json!("pko_1unit_to_unity_1unit_v1"),
    );

    // Map dimensions
    manifest_map.insert(
        "map_width_tiles".into(),
        serde_json::json!(parsed_map.header.n_width),
    );
    manifest_map.insert(
        "map_height_tiles".into(),
        serde_json::json!(parsed_map.header.n_height),
    );
    manifest_map.insert(
        "section_width".into(),
        serde_json::json!(parsed_map.header.n_section_width),
    );
    manifest_map.insert(
        "section_height".into(),
        serde_json::json!(parsed_map.header.n_section_height),
    );

    // Terrain
    manifest_map.insert("terrain_gltf".into(), serde_json::json!("terrain.gltf"));

    // Grids (binary sidecar files)
    manifest_map.insert(
        "collision_grid".into(),
        serde_json::json!({
            "width": coll_w, "height": coll_h, "tile_size": 0.5,
            "file": "grids/collision.bin",
        }),
    );
    manifest_map.insert(
        "obj_height_grid".into(),
        serde_json::json!({
            "width": obj_h_w, "height": obj_h_h, "tile_size": 0.5,
            "encoding": "i16_le_millimeters",
            "file": "grids/obj_height.bin",
        }),
    );
    manifest_map.insert(
        "region_grid".into(),
        serde_json::json!({
            "width": parsed_map.header.n_width, "height": parsed_map.header.n_height,
            "file": "grids/region.bin",
        }),
    );
    manifest_map.insert(
        "area_grid".into(),
        serde_json::json!({
            "width": parsed_map.header.n_width, "height": parsed_map.header.n_height,
            "file": "grids/area.bin",
        }),
    );
    manifest_map.insert(
        "tile_texture_grid".into(),
        serde_json::json!({
            "width": parsed_map.header.n_width, "height": parsed_map.header.n_height,
            "file": "grids/tile_texture.bin",
        }),
    );
    manifest_map.insert(
        "tile_color_grid".into(),
        serde_json::json!({
            "width": parsed_map.header.n_width, "height": parsed_map.header.n_height,
            "file": "grids/tile_color.bin",
        }),
    );

    // Buildings
    manifest_map.insert("buildings".into(), serde_json::Value::Object(buildings_map));
    manifest_map.insert("placements".into(), serde_json::json!(placements));

    // Effects — conditionally inline or sidecar (never both)
    manifest_map.insert(
        "effect_placements".into(),
        serde_json::json!(effect_placements),
    );
    if use_sidecar {
        manifest_map.insert(
            "effect_definitions_file".into(),
            serde_json::json!("effect_definitions.json"),
        );
    } else {
        manifest_map.insert("effect_definitions".into(), eff_defs_json_value);
    }
    if !missing_effect_ids.is_empty() {
        let mut sorted_missing = missing_effect_ids.clone();
        sorted_missing.sort_unstable();
        manifest_map.insert(
            "missing_effect_ids".into(),
            serde_json::json!(sorted_missing),
        );
    }

    // Areas (from AreaSet.bin, keyed by btIsland value)
    manifest_map.insert("areas".into(), areas_json);

    // Map settings
    manifest_map.insert("spawn_point".into(), serde_json::json!(spawn_point));
    manifest_map.insert("light_direction".into(), serde_json::json!(light_direction));
    manifest_map.insert("light_color".into(), serde_json::json!(light_color));
    manifest_map.insert("ambient".into(), serde_json::json!([0.4, 0.4, 0.4]));
    manifest_map.insert("background_color".into(), serde_json::json!([10, 10, 125]));

    // Water textures (paths relative to output dir)
    manifest_map.insert("water_textures".into(), serde_json::json!(water_textures));

    // Terrain blending data (Phase E)
    if !terrain_textures.is_empty() {
        // terrain_textures dict: tex_id (string) → relative path
        let tex_map: serde_json::Map<String, serde_json::Value> = terrain_textures
            .iter()
            .map(|(id, path)| (id.to_string(), serde_json::json!(path)))
            .collect();
        manifest_map.insert(
            "terrain_textures".into(),
            serde_json::Value::Object(tex_map),
        );
    }
    if let Some(ref alpha_path) = alpha_atlas_path {
        manifest_map.insert("alpha_atlas".into(), serde_json::json!(alpha_path));
    }
    manifest_map.insert(
        "tile_layer_grid".into(),
        serde_json::json!({
            "width": parsed_map.header.n_width,
            "height": parsed_map.header.n_height,
            "bytes_per_tile": 7,
            "file": "grids/tile_layer.bin",
        }),
    );

    let manifest = serde_json::Value::Object(manifest_map);

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
        total_effect_placements: effect_placements.len() as u32,
        total_effect_definitions: effect_definitions.len() as u32,
    })
}

/// Get metadata for a map without building the full glTF.
pub fn get_metadata(project_dir: &Path, map_name: &str) -> Result<MapMetadata> {
    let map_path = project_dir.join("map").join(format!("{}.map", map_name));
    let map_data = std::fs::read(&map_path)
        .with_context(|| format!("Failed to read map file: {}", map_path.display()))?;
    let parsed_map = parse_map(&map_data)?;

    let total_sections = parsed_map.section_offsets.len() as u32;
    let non_empty = parsed_map
        .section_offsets
        .iter()
        .filter(|&&o| o != 0)
        .count() as u32;
    let total_tiles =
        non_empty * (parsed_map.header.n_section_width * parsed_map.header.n_section_height) as u32;

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
// Batch export
// ============================================================================

/// Result of a batch export operation.
#[derive(Debug, serde::Serialize)]
pub struct BatchExportResult {
    pub total_maps: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub results: Vec<BatchExportMapResult>,
}

/// Result for a single map in a batch export.
#[derive(Debug, serde::Serialize)]
pub struct BatchExportMapResult {
    pub map_name: String,
    pub success: bool,
    pub error: Option<String>,
    pub buildings_exported: u32,
    pub placements: u32,
    pub effect_placements: u32,
}

/// Export all maps found in the project directory.
/// Each map gets its own subdirectory under `output_base_dir`.
/// Maps that fail are logged and skipped — the batch continues.
pub fn batch_export_for_unity(
    project_dir: &Path,
    output_base_dir: &Path,
) -> Result<BatchExportResult> {
    let maps = scan_maps(project_dir)?;
    let total = maps.len();
    let mut results = Vec::with_capacity(total);
    let mut succeeded = 0usize;
    let mut failed = 0usize;

    for map_entry in &maps {
        let map_name = &map_entry.name;
        let output_dir = output_base_dir.join(map_name);

        match export_map_for_unity(project_dir, map_name, &output_dir) {
            Ok(result) => {
                results.push(BatchExportMapResult {
                    map_name: map_name.clone(),
                    success: true,
                    error: None,
                    buildings_exported: result.total_buildings_exported,
                    placements: result.total_placements,
                    effect_placements: result.total_effect_placements,
                });
                succeeded += 1;
            }
            Err(e) => {
                eprintln!("Failed to export map '{}': {}", map_name, e);
                results.push(BatchExportMapResult {
                    map_name: map_name.clone(),
                    success: false,
                    error: Some(e.to_string()),
                    buildings_exported: 0,
                    placements: 0,
                    effect_placements: 0,
                });
                failed += 1;
            }
        }
    }

    Ok(BatchExportResult {
        total_maps: total,
        succeeded,
        failed,
        results,
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
        // cHeight=10 → fHeight = 1.0 in PKO native units.
        assert!((h - 1.0).abs() < 0.01, "height={}", h);

        let tile2 = MapTile {
            c_height: -5,
            ..tile
        };
        let h2 = tile_height(&tile2);
        // cHeight=-5 → fHeight = -0.5 in PKO native units.
        assert!((h2 - (-0.5)).abs() < 0.01, "height={}", h2);
    }

    fn make_tile(c_height: i8) -> MapTile {
        MapTile {
            dw_tile_info: 0,
            bt_tile_info: 0,
            s_color: 0,
            c_height,
            s_region: 0,
            bt_island: 0,
            bt_block: [0; 4],
        }
    }

    #[test]
    fn render_vertex_tile_uses_strict_owner_semantics() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 2,
            section_cnt_y: 1,
            section_offsets: vec![0, 0],
            sections: vec![
                Some(MapSection {
                    tiles: vec![make_tile(10)],
                }),
                None,
            ],
        };

        // Vertex owner (1,0) maps to missing section tile and must not
        // borrow adjacent visible tile(0,0).
        assert!(get_render_vertex_tile(&parsed, 1, 0).is_none());
    }

    #[test]
    fn render_vertex_tile_none_when_owner_out_of_bounds() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![make_tile(10)],
            })],
        };

        assert!(get_render_vertex_tile(&parsed, 1, 0).is_none());
        assert!(get_render_vertex_tile(&parsed, 0, 1).is_none());
    }

    #[test]
    fn build_gltf_uses_underwater_default_for_edge_owner_vertices() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![make_tile(10)],
            })],
        };

        let gltf_json = build_terrain_gltf(&parsed, None, None, None).expect("gltf build");
        let root: serde_json::Value = serde_json::from_str(&gltf_json).expect("json parse");

        let pos_acc_idx = root["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
            .as_u64()
            .expect("position accessor") as usize;
        let accessor = &root["accessors"][pos_acc_idx];
        let bv_idx = accessor["bufferView"].as_u64().expect("buffer view") as usize;
        let count = accessor["count"].as_u64().expect("count") as usize;

        let bv = &root["bufferViews"][bv_idx];
        let buf_idx = bv["buffer"].as_u64().expect("buffer") as usize;
        let bv_off = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
        let acc_off = accessor["byteOffset"].as_u64().unwrap_or(0) as usize;
        let base_off = bv_off + acc_off;

        let uri = root["buffers"][buf_idx]["uri"]
            .as_str()
            .expect("buffer uri");
        let payload = uri
            .strip_prefix("data:application/octet-stream;base64,")
            .expect("embedded data uri");
        let bytes = BASE64_STANDARD.decode(payload).expect("base64 decode");

        let mut y_values = Vec::with_capacity(count);
        for i in 0..count {
            let off = base_off + i * 12;
            let y = f32::from_le_bytes(bytes[off + 4..off + 8].try_into().expect("y bytes"));
            y_values.push(y);
        }

        // Vertex order for 1x1 grid: (0,0), (1,0), (0,1), (1,1)
        // Owner tile semantics => only (0,0) samples real tile; others are
        // out-of-range owners and therefore default underwater.
        let expected = [
            1.0f32,
            UNDERWATER_HEIGHT / MAP_VISUAL_SCALE,
            UNDERWATER_HEIGHT / MAP_VISUAL_SCALE,
            UNDERWATER_HEIGHT / MAP_VISUAL_SCALE,
        ];
        for (actual, exp) in y_values.iter().zip(expected.iter()) {
            assert!(
                (actual - exp).abs() < 0.0001,
                "expected {exp}, got {actual}"
            );
        }
    }

    #[test]
    fn build_gltf_skips_missing_section_tiles() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 2,
            section_cnt_y: 1,
            section_offsets: vec![0, 0],
            sections: vec![
                Some(MapSection {
                    tiles: vec![make_tile(10)],
                }),
                None,
            ],
        };

        let gltf_json = build_terrain_gltf(&parsed, None, None, None).expect("gltf build");
        let root: serde_json::Value = serde_json::from_str(&gltf_json).expect("json parse");
        let idx_acc_idx = root["meshes"][0]["primitives"][0]["indices"]
            .as_u64()
            .expect("indices accessor") as usize;
        let index_count = root["accessors"][idx_acc_idx]["count"]
            .as_u64()
            .expect("index count") as usize;

        // Width=2, height=1 with one missing tile => 1 rendered tile.
        // 1 tile => 2 triangles => 6 indices.
        assert_eq!(index_count, 6);
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
    fn sidecar_threshold_inline_when_small() {
        // Small effect_definitions should be inlined
        let mut defs = serde_json::Map::new();
        defs.insert(
            "1".into(),
            serde_json::json!({"filename": "test.eff", "subEffects": []}),
        );
        let eff_value = serde_json::Value::Object(defs);
        let size = serde_json::to_string(&eff_value).unwrap().len();
        assert!(
            size < super::SIDECAR_THRESHOLD,
            "test data should be below 5MB"
        );

        // Simulate manifest assembly with use_sidecar=false
        let mut manifest_map = serde_json::Map::new();
        manifest_map.insert("effect_definitions".into(), eff_value);
        // effect_definitions_file should NOT be present
        assert!(manifest_map.contains_key("effect_definitions"));
        assert!(!manifest_map.contains_key("effect_definitions_file"));
    }

    #[test]
    fn sidecar_threshold_file_when_large() {
        // Simulate sidecar mode: effect_definitions_file present, effect_definitions absent
        let mut manifest_map = serde_json::Map::new();
        // In sidecar mode, only effect_definitions_file is inserted
        manifest_map.insert(
            "effect_definitions_file".into(),
            serde_json::json!("effect_definitions.json"),
        );
        assert!(!manifest_map.contains_key("effect_definitions"));
        assert!(manifest_map.contains_key("effect_definitions_file"));
        assert_eq!(
            manifest_map["effect_definitions_file"],
            "effect_definitions.json"
        );
    }

    #[test]
    fn missing_effect_ids_omitted_when_empty() {
        // missing_effect_ids should not appear in manifest when empty
        let missing: Vec<u16> = vec![];
        let mut manifest_map = serde_json::Map::new();
        if !missing.is_empty() {
            manifest_map.insert("missing_effect_ids".into(), serde_json::json!(missing));
        }
        assert!(
            !manifest_map.contains_key("missing_effect_ids"),
            "empty missing_effect_ids should be omitted"
        );
    }

    #[test]
    fn missing_effect_ids_present_when_nonempty() {
        let missing: Vec<u16> = vec![5, 12];
        let mut manifest_map = serde_json::Map::new();
        if !missing.is_empty() {
            manifest_map.insert("missing_effect_ids".into(), serde_json::json!(missing));
        }
        assert!(manifest_map.contains_key("missing_effect_ids"));
        let arr = manifest_map["missing_effect_ids"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0], 5);
        assert_eq!(arr[1], 12);
    }

    #[test]
    fn effect_definition_schema_is_flat() {
        // Verify that effect definitions use flat schema (EffFile fields + filename at same level)
        // not nested { "filename": ..., "data": <EffFile> }
        let eff = crate::effect::model::EffFile {
            version: 1,
            idx_tech: 0,
            use_path: false,
            path_name: String::new(),
            use_sound: false,
            sound_name: String::new(),
            rotating: false,
            rota_vec: [0.0; 3],
            rota_vel: 0.0,
            eff_num: 0,
            sub_effects: vec![],
        };

        // Replicate the flatten logic from export_map_for_unity
        if let serde_json::Value::Object(mut eff_obj) = serde_json::to_value(&eff).unwrap() {
            eff_obj.insert("filename".to_string(), serde_json::json!("test.eff"));

            // "filename" is at top level alongside EffFile fields
            assert!(eff_obj.contains_key("filename"));
            assert!(eff_obj.contains_key("subEffects")); // camelCase from serde rename
            assert!(eff_obj.contains_key("idxTech"));
            // "data" key must NOT exist (flat, not nested)
            assert!(
                !eff_obj.contains_key("data"),
                "effect definition should be flat, not nested under 'data'"
            );
        } else {
            panic!("EffFile should serialize to a JSON object");
        }
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

    #[test]
    fn decode_obj_height_formula() {
        // Zero byte = zero height
        assert_eq!(super::decode_obj_height(0x00), 0.0);

        // Magnitude 1, positive: 1 * 5 / 100 = 0.05
        assert!((super::decode_obj_height(0x01) - 0.05).abs() < 0.001);

        // Magnitude 63 (max), positive: 63 * 5 / 100 = 3.15
        assert!((super::decode_obj_height(0x3F) - 3.15).abs() < 0.001);

        // Magnitude 1, negative (bit 6 set): -0.05
        assert!((super::decode_obj_height(0x41) - (-0.05)).abs() < 0.001);

        // Magnitude 63, negative: -3.15
        assert!((super::decode_obj_height(0x7F) - (-3.15)).abs() < 0.001);

        // Collision bit (bit 7) should not affect height
        // 0x80 = collision only, no height = 0.0
        assert_eq!(super::decode_obj_height(0x80), 0.0);

        // 0x81 = collision + magnitude 1 positive = 0.05
        assert!((super::decode_obj_height(0x81) - 0.05).abs() < 0.001);

        // 0xC1 = collision + magnitude 1 negative = -0.05
        assert!((super::decode_obj_height(0xC1) - (-0.05)).abs() < 0.001);
    }

    #[test]
    fn collision_grid_stores_only_collision_flag() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![MapTile {
                    dw_tile_info: 0,
                    bt_tile_info: 0,
                    s_color: 0,
                    c_height: -5,
                    s_region: 0,
                    bt_island: 0,
                    // sub-tile 0: walkable with height (0x49 = positive height, no collision)
                    // sub-tile 1: blocked (0x80 = collision flag only)
                    // sub-tile 2: walkable zero (0x00)
                    // sub-tile 3: blocked with height (0xC9 = collision + negative height)
                    bt_block: [0x49, 0x80, 0x00, 0xC9],
                }],
            })],
        };

        let (grid, w, h) = build_collision_grid(&parsed);
        assert_eq!(w, 2);
        assert_eq!(h, 2);
        assert_eq!(grid.len(), 4);
        // sub-tile 0 (0,0): 0x49 → bit 7 clear → walkable (0)
        assert_eq!(grid[0], 0, "0x49 should be walkable");
        // sub-tile 1 (1,0): 0x80 → bit 7 set → blocked (1)
        assert_eq!(grid[1], 1, "0x80 should be blocked");
        // sub-tile 2 (0,1): 0x00 → walkable (0)
        assert_eq!(grid[2], 0, "0x00 should be walkable");
        // sub-tile 3 (1,1): 0xC9 → bit 7 set → blocked (1)
        assert_eq!(grid[3], 1, "0xC9 should be blocked");
    }

    #[test]
    fn obj_height_grid_encodes_i16_millimeters() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![MapTile {
                    dw_tile_info: 0,
                    bt_tile_info: 0,
                    s_color: 0,
                    c_height: 0,
                    s_region: 0,
                    bt_island: 0,
                    // 0x09 = magnitude 9, positive: 9*5/100 = 0.45 → 450 millis
                    // 0x00 = 0.0 → 0 millis
                    // 0x41 = magnitude 1, negative: -0.05 → -50 millis
                    // 0x3F = magnitude 63, positive: 3.15 → 3150 millis
                    bt_block: [0x09, 0x00, 0x41, 0x3F],
                }],
            })],
        };

        let (grid, w, h) = build_obj_height_grid(&parsed);
        assert_eq!(w, 2);
        assert_eq!(h, 2);
        assert_eq!(grid.len(), 8); // 4 cells × 2 bytes each

        let read_i16 =
            |idx: usize| -> i16 { i16::from_le_bytes([grid[idx * 2], grid[idx * 2 + 1]]) };

        assert_eq!(read_i16(0), 450, "0x09 → 0.45 → 450mm");
        assert_eq!(read_i16(1), 0, "0x00 → 0.0 → 0mm");
        assert_eq!(read_i16(2), -50, "0x41 → -0.05 → -50mm");
        assert_eq!(read_i16(3), 3150, "0x3F → 3.15 → 3150mm");
    }

    #[test]
    fn diagnostic_btblock_height_xmas() {
        // Load the xmas map to analyze btBlock height data.
        // Skip silently if top-client data not present.
        let map_path = std::path::Path::new("../top-client/map/07xmas2.map");
        if !map_path.exists() {
            eprintln!("SKIP: {} not found", map_path.display());
            return;
        }

        let data = std::fs::read(map_path).unwrap();
        let parsed = parse_map(&data).unwrap();

        let tw = parsed.header.n_width;
        let th = parsed.header.n_height;
        eprintln!(
            "Map: {}x{} tiles, sections: {}x{}",
            tw, th, parsed.section_cnt_x, parsed.section_cnt_y
        );

        // --- Global btBlock statistics ---
        let mut total_subtiles: u64 = 0;
        let mut nonzero_height: u64 = 0; // bits 0-6 != 0
        let mut collision_set: u64 = 0; // bit 7 set
        let mut walkable_nonzero: u64 = 0; // bit 7 clear but bits 0-6 != 0 (collision grid bug)
        let mut height_positive: u64 = 0;
        let mut height_negative: u64 = 0;

        // Histogram: height value → count (in 0.5-unit buckets)
        let mut histogram: std::collections::BTreeMap<i32, u64> = std::collections::BTreeMap::new();

        // --- Near-water analysis ---
        // Tiles where cHeight < 0 (below sea level)
        let mut underwater_tiles: u64 = 0;
        let mut underwater_subtiles_nonzero_height: u64 = 0;
        let mut underwater_min_obj_height: f32 = f32::MAX;
        let mut underwater_max_obj_height: f32 = f32::MIN;

        // Water-edge tiles: cHeight between -5 and 0 (transition zone)
        let mut edge_tiles: u64 = 0;
        let mut edge_subtiles_nonzero_height: u64 = 0;
        let mut edge_min_obj_height: f32 = f32::MAX;
        let mut edge_max_obj_height: f32 = f32::MIN;

        // Global min/max
        let mut global_min_obj_height: f32 = f32::MAX;
        let mut global_max_obj_height: f32 = f32::MIN;
        let mut global_min_c_height: i8 = i8::MAX;
        let mut global_max_c_height: i8 = i8::MIN;

        // Sample some edge tiles for detailed output
        let mut edge_samples: Vec<(i32, i32, i8, [u8; 4], [f32; 4])> = Vec::new();

        for ty in 0..th {
            for tx in 0..tw {
                let tile = match get_tile(&parsed, tx, ty) {
                    Some(t) => t,
                    None => continue,
                };

                if tile.c_height < global_min_c_height {
                    global_min_c_height = tile.c_height;
                }
                if tile.c_height > global_max_c_height {
                    global_max_c_height = tile.c_height;
                }

                let is_underwater = tile.c_height < 0;
                let is_edge = tile.c_height >= -5 && tile.c_height < 0;
                if is_underwater {
                    underwater_tiles += 1;
                }
                if is_edge {
                    edge_tiles += 1;
                }

                let mut obj_heights = [0.0f32; 4];
                for i in 0..4 {
                    let bb = tile.bt_block[i];
                    let h = decode_obj_height(bb);
                    obj_heights[i] = h;

                    total_subtiles += 1;

                    let has_height = (bb & 0x7F) != 0; // bits 0-6 non-zero
                    let is_blocked = (bb & 0x80) != 0; // bit 7

                    if has_height {
                        nonzero_height += 1;
                    }
                    if is_blocked {
                        collision_set += 1;
                    }
                    if !is_blocked && bb != 0 {
                        walkable_nonzero += 1;
                    }
                    if h > 0.001 {
                        height_positive += 1;
                    }
                    if h < -0.001 {
                        height_negative += 1;
                    }

                    // Histogram bucket: multiply by 10, round to nearest 5 (= 0.5 unit buckets)
                    let bucket = (h * 10.0).round() as i32 / 5 * 5;
                    *histogram.entry(bucket).or_insert(0) += 1;

                    if h < global_min_obj_height {
                        global_min_obj_height = h;
                    }
                    if h > global_max_obj_height {
                        global_max_obj_height = h;
                    }

                    if is_underwater && has_height {
                        underwater_subtiles_nonzero_height += 1;
                    }
                    if is_underwater && h < underwater_min_obj_height {
                        underwater_min_obj_height = h;
                    }
                    if is_underwater && h > underwater_max_obj_height {
                        underwater_max_obj_height = h;
                    }

                    if is_edge && has_height {
                        edge_subtiles_nonzero_height += 1;
                    }
                    if is_edge && h < edge_min_obj_height {
                        edge_min_obj_height = h;
                    }
                    if is_edge && h > edge_max_obj_height {
                        edge_max_obj_height = h;
                    }
                }

                // Collect detailed samples for edge tiles
                if is_edge && edge_samples.len() < 20 {
                    let any_nonzero = tile.bt_block.iter().any(|&b| (b & 0x7F) != 0);
                    if any_nonzero {
                        edge_samples.push((tx, ty, tile.c_height, tile.bt_block, obj_heights));
                    }
                }
            }
        }

        // --- Print results ---
        eprintln!("\n=== btBlock Height Diagnostic for 07xmas2 ===\n");

        eprintln!(
            "cHeight range: {} to {} (fHeight: {:.2} to {:.2})",
            global_min_c_height,
            global_max_c_height,
            global_min_c_height as f32 * 0.1,
            global_max_c_height as f32 * 0.1
        );

        eprintln!("\n--- Global btBlock Statistics ---");
        eprintln!("Total sub-tiles:       {}", total_subtiles);
        eprintln!(
            "Non-zero height:       {} ({:.1}%)",
            nonzero_height,
            nonzero_height as f64 / total_subtiles as f64 * 100.0
        );
        eprintln!(
            "Collision (bit 7):     {} ({:.1}%)",
            collision_set,
            collision_set as f64 / total_subtiles as f64 * 100.0
        );
        eprintln!(
            "Walkable but != 0:     {} ({:.1}%) ← COLLISION GRID BUG",
            walkable_nonzero,
            walkable_nonzero as f64 / total_subtiles as f64 * 100.0
        );
        eprintln!("Height > 0:            {}", height_positive);
        eprintln!("Height < 0:            {}", height_negative);
        eprintln!(
            "Obj height range:      {:.3} to {:.3}",
            global_min_obj_height, global_max_obj_height
        );

        eprintln!("\n--- Height Histogram (0.5-unit buckets) ---");
        for (&bucket, &count) in &histogram {
            if count > 0 {
                let lo = bucket as f64 / 10.0;
                let hi = lo + 0.5;
                let bar_len = (count as f64 / total_subtiles as f64 * 200.0) as usize;
                let bar: String = "#".repeat(bar_len.max(1).min(80));
                eprintln!("[{:+5.1} to {:+5.1}]: {:>8} {}", lo, hi, count, bar);
            }
        }

        eprintln!("\n--- Underwater Tiles (cHeight < 0) ---");
        eprintln!("Underwater tiles:      {}", underwater_tiles);
        eprintln!(
            "Subtiles with height:  {}",
            underwater_subtiles_nonzero_height
        );
        if underwater_tiles > 0 {
            eprintln!(
                "Obj height range:      {:.3} to {:.3}",
                underwater_min_obj_height, underwater_max_obj_height
            );
        }

        eprintln!("\n--- Water-Edge Tiles (-5 <= cHeight < 0) ---");
        eprintln!("Edge tiles:            {}", edge_tiles);
        eprintln!("Subtiles with height:  {}", edge_subtiles_nonzero_height);
        if edge_tiles > 0 {
            eprintln!(
                "Obj height range:      {:.3} to {:.3}",
                edge_min_obj_height, edge_max_obj_height
            );
        }

        if !edge_samples.is_empty() {
            eprintln!("\n--- Sample Water-Edge Tiles (up to 20) ---");
            for (tx, ty, ch, bb, oh) in &edge_samples {
                let fh = *ch as f32 * 0.1;
                eprintln!(
                    "  tile({},{}) cH={:+3} fH={:+5.1} btBlock=[0x{:02X},0x{:02X},0x{:02X},0x{:02X}] objH=[{:+.3},{:+.3},{:+.3},{:+.3}]",
                    tx, ty, ch, fh, bb[0], bb[1], bb[2], bb[3], oh[0], oh[1], oh[2], oh[3]
                );
            }
        }

        // --- Compare cHeight terrain vs btBlock at same position ---
        eprintln!("\n--- cHeight vs btBlock Height Comparison (underwater tiles) ---");
        let mut deeper_count: u64 = 0;
        let mut shallower_count: u64 = 0;
        let mut same_count: u64 = 0;
        let mut max_depth_diff: f32 = 0.0;

        for ty in 0..th {
            for tx in 0..tw {
                let tile = match get_tile(&parsed, tx, ty) {
                    Some(t) => t,
                    None => continue,
                };
                if tile.c_height >= 0 {
                    continue;
                }

                let terrain_h = tile.c_height as f32 * 0.1; // fHeight (original engine units)
                for i in 0..4 {
                    let obj_h = decode_obj_height(tile.bt_block[i]);
                    let diff = obj_h - terrain_h;
                    if diff < -0.001 {
                        deeper_count += 1; // btBlock is deeper than terrain
                        if diff.abs() > max_depth_diff {
                            max_depth_diff = diff.abs();
                        }
                    } else if diff > 0.001 {
                        shallower_count += 1; // btBlock is shallower than terrain
                    } else {
                        same_count += 1;
                    }
                }
            }
        }

        eprintln!("btBlock DEEPER than terrain:    {} sub-tiles", deeper_count);
        eprintln!(
            "btBlock SHALLOWER than terrain:  {} sub-tiles",
            shallower_count
        );
        eprintln!("btBlock SAME as terrain:         {} sub-tiles", same_count);
        eprintln!(
            "Max depth difference:            {:.3} units",
            max_depth_diff
        );

        eprintln!("\n=== VERDICT ===");
        if nonzero_height > 0 && walkable_nonzero > 0 {
            eprintln!("CONFIRMED: btBlock has meaningful height data.");
            eprintln!(
                "CONFIRMED: Collision grid bug — {} walkable cells incorrectly blocked.",
                walkable_nonzero
            );
        }
        if deeper_count > 0 {
            eprintln!("CONFIRMED: btBlock encodes DEEPER heights than terrain at water edges.");
            eprintln!("→ Proceed with Phases 2-8 to use btBlock height for character placement.");
        } else if nonzero_height == 0 {
            eprintln!(
                "DISPROVED: btBlock has NO meaningful height data. Investigate other causes."
            );
        } else {
            eprintln!(
                "INCONCLUSIVE: btBlock has height data but not deeper than terrain at water."
            );
        }
    }
}
