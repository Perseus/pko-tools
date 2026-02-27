#!/usr/bin/env python3
"""
Survey LMO files for texuv, teximg, and mtlopac animation data across PKO maps.

LMO animation section format (no version/type prefix -- determined by LMO file version):
  v >= 0x1005: 146 DWORDs = bone_size + mat_size + mtlopac_size[16] + texuv_size[16][4] + teximg_size[16][4]
  v >= 0x1000: 130 DWORDs = bone_size + mat_size + texuv_size[16][4] + teximg_size[16][4]
  v == 0x0:    Legacy format (different structure, skipped for this survey)

Then the actual animation data blobs follow, sized by the entries above.

Cross-references with map .obj files to find which maps use buildings with these animations.
"""

import struct
import os
import glob
from collections import defaultdict


# ============================================================================
# Paths
# ============================================================================

SCENE_MODEL_DIR = "/Users/anirudh/gamedev/pko-tools/top-client/corsairs-online-public/client/model/scene/"
MAP_DIR_1 = "/Users/anirudh/gamedev/pko-tools/top-client/corsairs-online-public/client/map/"
MAP_DIR_2 = "/Users/anirudh/gamedev/pko-tools/top-client/map/"
SCENEOBJINFO_BIN = "/Users/anirudh/gamedev/pko-tools/top-client/scripts/table/sceneobjinfo.bin"

# Maps to exclude from the report
EXCLUDED_MAPS = {"garner", "magicsea", "darkblue", "garner2"}

# Object types in LMO header table
OBJ_TYPE_GEOMETRY = 1


# ============================================================================
# sceneobjinfo.bin parser
# ============================================================================

def parse_sceneobjinfo_bin(path):
    """Parse sceneobjinfo.bin, return dict: obj_id -> lmo_filename (lowercase)."""
    if not os.path.exists(path):
        return {}
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 4:
        return {}

    entry_size = struct.unpack_from("<I", data, 0)[0]
    if entry_size == 0:
        return {}

    data = data[4:]
    entry_count = len(data) // entry_size
    result = {}

    for i in range(entry_count):
        offset = i * entry_size
        if offset + entry_size > len(data):
            break
        chunk = data[offset : offset + entry_size]

        # bExist at offset 0
        b_exist = struct.unpack_from("<i", chunk, 0)[0]
        if b_exist == 0:
            continue

        # nID at offset 100
        obj_id = struct.unpack_from("<I", chunk, 100)[0]

        # szDataName at offset 8, max 72 bytes
        name_bytes = chunk[8 : 8 + 72]
        end = name_bytes.find(b"\x00")
        if end >= 0:
            name_bytes = name_bytes[:end]
        filename = name_bytes.decode("utf-8", errors="replace").strip().lower()

        if filename:
            result[obj_id] = filename

    return result


# ============================================================================
# .obj map file parser
# ============================================================================

def parse_obj_file(path):
    """Parse a map .obj file, return list of (obj_type, obj_id) placements.

    obj_type: 0=model, 1=effect
    obj_id: 14-bit ID referencing sceneobjinfo.bin
    """
    with open(path, "rb") as f:
        data = f.read()

    if len(data) < 44:
        return []

    # Header: title[16] + version(4) + file_size(4) + section_cnt_x(4) +
    # section_cnt_y(4) + section_width(4) + section_height(4) + section_obj_num(4)
    version = struct.unpack_from("<i", data, 16)[0]
    if version != 600:
        return []

    section_cnt_x = struct.unpack_from("<i", data, 24)[0]
    section_cnt_y = struct.unpack_from("<i", data, 28)[0]
    section_cnt = section_cnt_x * section_cnt_y

    # Section index: offset(4) + count(4) per section
    idx_start = 44
    if idx_start + section_cnt * 8 > len(data):
        return []

    section_offsets = []
    section_counts = []
    for s in range(section_cnt):
        off = idx_start + s * 8
        section_offsets.append(struct.unpack_from("<i", data, off)[0])
        section_counts.append(struct.unpack_from("<i", data, off + 4)[0])

    # Read objects -- each entry is 20 bytes (SSceneObjInfo with MSVC alignment)
    placements = set()
    for s in range(section_cnt):
        count = section_counts[s]
        offset = section_offsets[s]
        if count <= 0 or offset <= 0:
            continue

        for j in range(count):
            entry_off = offset + j * 20
            if entry_off + 20 > len(data):
                break
            raw_type_id = struct.unpack_from("<h", data, entry_off)[0]
            obj_type = (raw_type_id & 0xFFFF) >> 14
            obj_id = (raw_type_id & 0xFFFF) & 0x3FFF
            if obj_id > 0 and obj_type <= 1:
                placements.add((obj_type, obj_id))

    return list(placements)


# ============================================================================
# LMO animation parser
# ============================================================================

class AnimInfo:
    """Parsed animation info for one geometry object in an LMO file."""

    def __init__(self):
        self.bone_size = 0
        self.mat_size = 0
        self.mtlopac_sizes = []       # list of (subset, size)
        self.texuv_sizes = []         # list of (subset, stage, size)
        self.teximg_sizes = []        # list of (subset, stage, size)


def parse_lmo_animations(path):
    """Parse an LMO file and return list of (obj_index, AnimInfo) for objects with animation.

    Skips v0x0 files (legacy format without size-array animation headers).
    """
    with open(path, "rb") as f:
        data = f.read()

    if len(data) < 8:
        return []

    lmo_version = struct.unpack_from("<I", data, 0)[0]
    obj_num = struct.unpack_from("<I", data, 4)[0]

    # Skip legacy v0x0 format
    if lmo_version == 0:
        return []

    if obj_num > 500:
        return []

    # Determine animation size-array format based on LMO version
    if lmo_version >= 0x1005:
        # 146 DWORDs: bone + mat + mtlopac[16] + texuv[16][4] + teximg[16][4]
        n_entries = 146
        has_mtlopac = True
        mtlopac_count = 16
    else:
        # 130 DWORDs: bone + mat + texuv[16][4] + teximg[16][4]
        n_entries = 130
        has_mtlopac = False
        mtlopac_count = 0

    header_bytes = n_entries * 4
    results = []

    for i in range(obj_num):
        tbl_off = 8 + i * 12
        if tbl_off + 12 > len(data):
            break

        typ, addr, size = struct.unpack_from("<III", data, tbl_off)
        if typ != OBJ_TYPE_GEOMETRY:
            continue
        if addr + 116 > len(data):
            continue

        # Read mtl_size, mesh_size, helper_size, anim_size from the geometry object header
        sizes_offset = addr + 100
        if sizes_offset + 16 > len(data):
            continue
        mtl_size, mesh_size, helper_size, anim_size = struct.unpack_from(
            "<IIII", data, sizes_offset
        )

        if anim_size == 0:
            continue

        anim_offset = addr + 116 + mtl_size + mesh_size + helper_size
        if anim_offset + header_bytes > len(data):
            continue

        # Read size array
        info = AnimInfo()
        off = anim_offset

        info.bone_size = struct.unpack_from("<I", data, off)[0]
        info.mat_size = struct.unpack_from("<I", data, off + 4)[0]
        off += 8

        if has_mtlopac:
            for s in range(mtlopac_count):
                val = struct.unpack_from("<I", data, off + s * 4)[0]
                if val > 0:
                    info.mtlopac_sizes.append((s, val))
            off += mtlopac_count * 4

        # texuv_size[16][4]
        for s in range(16):
            for t in range(4):
                val = struct.unpack_from("<I", data, off + (s * 4 + t) * 4)[0]
                if val > 0:
                    info.texuv_sizes.append((s, t, val))
        off += 16 * 4 * 4

        # teximg_size[16][4]
        for s in range(16):
            for t in range(4):
                val = struct.unpack_from("<I", data, off + (s * 4 + t) * 4)[0]
                if val > 0:
                    info.teximg_sizes.append((s, t, val))

        # Verify: header + sum of all sizes should equal anim_size
        total = info.bone_size + info.mat_size
        total += sum(sz for _, sz in info.mtlopac_sizes)
        total += sum(sz for _, _, sz in info.texuv_sizes)
        total += sum(sz for _, _, sz in info.teximg_sizes)
        expected = header_bytes + total
        if expected != anim_size:
            # Mismatch -- likely corrupt or misunderstood format, skip
            continue

        # Only report if there's texuv, teximg, or mtlopac data
        if info.texuv_sizes or info.teximg_sizes or info.mtlopac_sizes:
            results.append((i, info))

    return results


# ============================================================================
# Main survey
# ============================================================================

def main():
    print("=" * 80)
    print("LMO Animation Survey: texuv / teximg / mtlopac")
    print("=" * 80)

    # 1. Scan all LMO files
    lmo_files = sorted(glob.glob(os.path.join(SCENE_MODEL_DIR, "*.lmo")))
    print(f"\nFound {len(lmo_files)} LMO files in scene model directory.")

    # Track: lmo_filename (lowercase) -> list of (obj_idx, AnimInfo)
    lmo_anim_data = {}
    total_scanned = 0
    total_with_anim = 0
    total_with_texuv = 0
    total_with_teximg = 0
    total_with_mtlopac = 0
    skipped_v0 = 0

    for lmo_path in lmo_files:
        total_scanned += 1
        basename = os.path.basename(lmo_path).lower()

        # Check version for skip
        with open(lmo_path, "rb") as f:
            ver_bytes = f.read(4)
        if len(ver_bytes) < 4:
            continue
        ver = struct.unpack_from("<I", ver_bytes, 0)[0]
        if ver == 0:
            skipped_v0 += 1
            continue

        anims = parse_lmo_animations(lmo_path)
        if anims:
            lmo_anim_data[basename] = anims
            total_with_anim += 1
            has_texuv = any(a.texuv_sizes for _, a in anims)
            has_teximg = any(a.teximg_sizes for _, a in anims)
            has_mtlopac = any(a.mtlopac_sizes for _, a in anims)
            if has_texuv:
                total_with_texuv += 1
            if has_teximg:
                total_with_teximg += 1
            if has_mtlopac:
                total_with_mtlopac += 1

    print(f"Scanned: {total_scanned}, Skipped v0x0: {skipped_v0}")
    print(f"LMO files with texuv/teximg/mtlopac animations: {total_with_anim}")
    print(f"  - with texuv:   {total_with_texuv}")
    print(f"  - with teximg:  {total_with_teximg}")
    print(f"  - with mtlopac: {total_with_mtlopac}")

    # 2. Print detailed findings for each LMO
    print("\n" + "=" * 80)
    print("DETAILED FINDINGS: LMO files with texuv/teximg/mtlopac animation data")
    print("=" * 80)

    for basename in sorted(lmo_anim_data.keys()):
        anims = lmo_anim_data[basename]
        print(f"\n  {basename}:")
        for obj_idx, info in anims:
            parts = []
            if info.bone_size:
                parts.append(f"bone={info.bone_size}")
            if info.mat_size:
                parts.append(f"mat={info.mat_size}")
            if info.mtlopac_sizes:
                for s, sz in info.mtlopac_sizes:
                    parts.append(f"mtlopac[{s}]={sz}")
            if info.texuv_sizes:
                for s, t, sz in info.texuv_sizes:
                    parts.append(f"texuv[{s}][{t}]={sz}")
            if info.teximg_sizes:
                for s, t, sz in info.teximg_sizes:
                    parts.append(f"teximg[{s}][{t}]={sz}")
            print(f"    obj[{obj_idx}]: {', '.join(parts)}")

    # 3. Parse sceneobjinfo.bin to map obj_id -> lmo_filename
    print("\n" + "=" * 80)
    print("CROSS-REFERENCE WITH MAP FILES")
    print("=" * 80)

    obj_id_to_lmo = parse_sceneobjinfo_bin(SCENEOBJINFO_BIN)
    print(f"\nsceneobjinfo.bin: {len(obj_id_to_lmo)} entries loaded.")

    # Build reverse map: lmo_filename -> set of obj_ids
    lmo_to_obj_ids = defaultdict(set)
    for obj_id, lmo_name in obj_id_to_lmo.items():
        lmo_to_obj_ids[lmo_name].add(obj_id)

    # Find which obj_ids correspond to animated LMOs
    animated_obj_ids = set()
    obj_id_to_anim_lmo = {}
    for lmo_name in lmo_anim_data:
        for obj_id in lmo_to_obj_ids.get(lmo_name, set()):
            animated_obj_ids.add(obj_id)
            obj_id_to_anim_lmo[obj_id] = lmo_name

    print(f"Animated LMO files with sceneobjinfo entries: {len(set(lmo_anim_data.keys()) & set(lmo_to_obj_ids.keys()))}")
    print(f"Total animated obj_ids: {len(animated_obj_ids)}")

    # LMOs with animations but no sceneobjinfo entry (can't appear in maps)
    orphan_lmos = set(lmo_anim_data.keys()) - set(lmo_to_obj_ids.keys())
    if orphan_lmos:
        print(f"\nAnimated LMOs with NO sceneobjinfo entry (unused in maps): {sorted(orphan_lmos)}")

    # 4. Parse all map .obj files
    obj_files = []
    for map_dir in [MAP_DIR_1, MAP_DIR_2]:
        if os.path.isdir(map_dir):
            obj_files.extend(glob.glob(os.path.join(map_dir, "*.obj")))
    obj_files = sorted(set(obj_files))

    print(f"\nFound {len(obj_files)} map .obj files.")

    # map_name -> set of animated obj_ids placed
    map_to_animated = defaultdict(set)
    # map_name -> total model placements
    map_model_counts = {}

    for obj_path in obj_files:
        map_name = os.path.splitext(os.path.basename(obj_path))[0]
        placements = parse_obj_file(obj_path)
        model_placements = [(t, oid) for t, oid in placements if t == 0]
        map_model_counts[map_name] = len(model_placements)

        for obj_type, obj_id in placements:
            if obj_type == 0 and obj_id in animated_obj_ids:
                map_to_animated[map_name].add(obj_id)

    # 5. Report maps with animated buildings
    print("\n" + "=" * 80)
    print("MAPS WITH ANIMATED BUILDINGS (texuv/teximg/mtlopac)")
    print("=" * 80)

    # Categorize into included and excluded
    included_maps = {}
    excluded_maps = {}

    for map_name in sorted(map_to_animated.keys()):
        anim_ids = map_to_animated[map_name]
        total_models = map_model_counts.get(map_name, 0)
        entry = {
            "total_models": total_models,
            "animated_ids": anim_ids,
        }
        if map_name.lower() in EXCLUDED_MAPS:
            excluded_maps[map_name] = entry
        else:
            included_maps[map_name] = entry

    def print_map_details(map_name, entry):
        anim_ids = entry["animated_ids"]
        total = entry["total_models"]
        print(f"\n  {map_name} ({total} unique model types, {len(anim_ids)} animated):")
        for obj_id in sorted(anim_ids):
            lmo_name = obj_id_to_anim_lmo.get(obj_id, "?")
            anims = lmo_anim_data.get(lmo_name, [])
            anim_types = set()
            for _, info in anims:
                if info.texuv_sizes:
                    anim_types.add("texuv")
                if info.teximg_sizes:
                    anim_types.add("teximg")
                if info.mtlopac_sizes:
                    anim_types.add("mtlopac")
            print(f"    obj_id={obj_id} -> {lmo_name} [{', '.join(sorted(anim_types))}]")

    print(f"\n--- INCLUDED MAPS ({len(included_maps)}) ---")
    for map_name in sorted(included_maps.keys()):
        print_map_details(map_name, included_maps[map_name])

    if excluded_maps:
        print(f"\n--- EXCLUDED MAPS ({len(excluded_maps)}) ---")
        for map_name in sorted(excluded_maps.keys()):
            print_map_details(map_name, excluded_maps[map_name])

    # 6. Summary of animation types
    print("\n" + "=" * 80)
    print("ANIMATION TYPE SUMMARY")
    print("=" * 80)

    # Aggregate stats
    texuv_subsets = defaultdict(int)   # (subset, stage) -> count of LMOs
    teximg_subsets = defaultdict(int)
    mtlopac_subsets = defaultdict(int)  # subset -> count

    for basename, anims in lmo_anim_data.items():
        seen_texuv = set()
        seen_teximg = set()
        seen_mtlopac = set()
        for _, info in anims:
            for s, t, sz in info.texuv_sizes:
                seen_texuv.add((s, t))
            for s, t, sz in info.teximg_sizes:
                seen_teximg.add((s, t))
            for s, sz in info.mtlopac_sizes:
                seen_mtlopac.add(s)
        for key in seen_texuv:
            texuv_subsets[key] += 1
        for key in seen_teximg:
            teximg_subsets[key] += 1
        for key in seen_mtlopac:
            mtlopac_subsets[key] += 1

    if texuv_subsets:
        print("\n  texuv animations by (subset, stage):")
        for key in sorted(texuv_subsets.keys()):
            print(f"    subset={key[0]}, stage={key[1]}: {texuv_subsets[key]} LMO files")

    if teximg_subsets:
        print("\n  teximg animations by (subset, stage):")
        for key in sorted(teximg_subsets.keys()):
            print(f"    subset={key[0]}, stage={key[1]}: {teximg_subsets[key]} LMO files")

    if mtlopac_subsets:
        print("\n  mtlopac animations by subset:")
        for key in sorted(mtlopac_subsets.keys()):
            print(f"    subset={key}: {mtlopac_subsets[key]} LMO files")

    # 7. Quick stats on bone-only vs texture-animated
    bone_only = 0
    mat_only = 0
    bone_and_mat = 0
    for basename, anims in lmo_anim_data.items():
        for _, info in anims:
            has_bone = info.bone_size > 0
            has_mat = info.mat_size > 0
            # These already have texuv/teximg/mtlopac (that's why they're here)
            pass

    # Also scan for files that ONLY have bone/mat animations (no texuv/teximg/mtlopac)
    print("\n" + "=" * 80)
    print("BONE/MAT-ONLY ANIMATION STATS (files without texuv/teximg/mtlopac)")
    print("=" * 80)

    bone_mat_only_count = 0
    for lmo_path in lmo_files:
        basename = os.path.basename(lmo_path).lower()
        if basename in lmo_anim_data:
            continue  # Already has texuv/teximg/mtlopac

        with open(lmo_path, "rb") as f:
            ver_bytes = f.read(4)
        if len(ver_bytes) < 4:
            continue
        ver = struct.unpack_from("<I", ver_bytes, 0)[0]
        if ver == 0:
            continue

        with open(lmo_path, "rb") as f:
            data = f.read()
        obj_num = struct.unpack_from("<I", data, 4)[0]
        if obj_num > 500:
            continue

        if ver >= 0x1005:
            n_entries = 146
        else:
            n_entries = 130
        header_bytes = n_entries * 4

        has_bone_or_mat = False
        for i in range(obj_num):
            tbl_off = 8 + i * 12
            if tbl_off + 12 > len(data):
                break
            typ, addr, size = struct.unpack_from("<III", data, tbl_off)
            if typ != OBJ_TYPE_GEOMETRY:
                continue
            if addr + 116 > len(data):
                continue
            sizes_offset = addr + 100
            if sizes_offset + 16 > len(data):
                continue
            mtl_size, mesh_size, helper_size, anim_size = struct.unpack_from(
                "<IIII", data, sizes_offset
            )
            if anim_size == 0:
                continue

            anim_offset = addr + 116 + mtl_size + mesh_size + helper_size
            if anim_offset + 8 > len(data):
                continue

            bone_sz = struct.unpack_from("<I", data, anim_offset)[0]
            mat_sz = struct.unpack_from("<I", data, anim_offset + 4)[0]
            if bone_sz > 0 or mat_sz > 0:
                has_bone_or_mat = True
                break

        if has_bone_or_mat:
            bone_mat_only_count += 1

    print(f"\n  LMO files with bone/mat animation only (no texuv/teximg/mtlopac): {bone_mat_only_count}")

    print("\n" + "=" * 80)
    print("DONE")
    print("=" * 80)


if __name__ == "__main__":
    main()
