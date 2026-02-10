use crate::decompiler::{GameVersion, ParserType, Structure, StructureBuilder};

/// Create CharacterInfo structure for version 1
///
/// This structure is based on the Lua decompiler's characterinfo definition.
/// Version 1 is the base version used by most game versions.
pub fn create_character_info_v1() -> Structure {
    StructureBuilder::new("CharacterInfo")
        // ID (Lua: oo(r(pad,4),ulong) - pad 4 THEN read ID)
        .pad(4) // Padding before ID
        .field_ulong("ID")
        // Name (72 chars + 32 padding)
        .field_char_fixed("Name", 72)
        .pad(32)
        // Short Name (16 chars + 33 padding - includes hidden third name field)
        .field_char_fixed("Short Name", 16)
        .pad(33) // Skip 16 bytes padding + 16 bytes third name copy + 1 byte
        // Basic properties
        .field_ubyte("Model Type")
        .field_ubyte("Logic Type")
        .pad(1) // Padding byte before Framework Number
        .field_ushort("Framework Number")
        .field_ushort("Suite Serial")
        .field_ushort("Suite Quantity")
        // Parts (8 parts: 00-07)
        .field_ushort("Part 00")
        .field_ushort("Part 01")
        .field_ushort("Part 02")
        .field_ushort("Part 03")
        .field_ushort("Part 04")
        .field_ushort("Part 05")
        .field_ushort("Part 06")
        .field_ushort("Part 07")
        // Effect IDs
        .field_ushort_repeat("FeffID", 2)
        .field_ushort("EeffID")
        .pad(4)
        .field_ushort_repeat("Special Effect Action Serial", 3)
        // More properties
        .field_ushort("Shadow")
        .field_ushort("Action ID")
        .field_ubyte("Transparency")
        .pad(1)
        // Sound effects
        .field_short("Moving Sound Effect")
        .field_short("Breathing Sound Effect")
        .field_short("Death Sound Effect")
        // Control properties
        .field_ubyte("Can it be controlled?")
        .field_ubyte("Area Limited?")
        .field_short("Altitude Excursion")
        // Item types (6 shorts + 30 padding)
        .field_short_repeat("Item types that can equip", 6)
        .pad(30)
        // Dimensions
        .field_float("Length")
        .field_float("Width")
        .field_float("Height")
        .field_ushort("Collision Range")
        // Birth/Death
        .field_ubyte_repeat("Birth", 2)
        .pad(1)
        .field_ubyte_repeat("Death", 2)
        .pad(1)
        .field_ushort("Birth Effect")
        .field_ushort("Death Effect")
        .field_ubyte("Hibernate Action")
        .pad(1)
        .field_ubyte("Death Instant Action")
        .pad(1)
        // HP Effect
        .field_ulong_repeat("Remaining HP Effect Display", 3)
        // Attack properties
        .field_ubyte("Attack can swerve")
        .field_ubyte("Confirm to blow away")
        .pad(2)
        // Scripts and weapons
        .field_ulong("Script")
        .field_ulong("Weapon Used")
        // Skills (complex: save position, read 11 longs with padding, then rewind and read rates)
        // For now, simplified version - read skills directly
        .save_pos()
        .field_custom(
            "Skill ID",
            ParserType::RepeatMulti(
                Box::new(ParserType::Sequence(vec![
                    ParserType::Long,
                    ParserType::Pad(4),
                ])),
                11,
            ),
        )
        .load_pos()
        .field_custom(
            "Skill Rate",
            ParserType::RepeatMulti(
                Box::new(ParserType::Sequence(vec![
                    ParserType::Pad(4),
                    ParserType::Long,
                ])),
                11,
            ),
        )
        // Drops (similar pattern: save, read 10 longs with padding, rewind and read rates)
        .save_pos()
        .field_custom(
            "Drop ID",
            ParserType::RepeatMulti(
                Box::new(ParserType::Sequence(vec![
                    ParserType::Long,
                    ParserType::Pad(4),
                ])),
                10,
            ),
        )
        .load_pos()
        .field_custom(
            "Drop Rate",
            ParserType::RepeatMulti(
                Box::new(ParserType::Sequence(vec![
                    ParserType::Pad(4),
                    ParserType::Long,
                ])),
                10,
            ),
        )
        // More properties
        .save_pos()
        .pad(80)
        .field_ulong("Quantity Limit")
        .field_ulong("Fatality Rate")
        .field_ulong("Prefix Lvl")
        // Quest drops (reuse the saved position from above)
        .load_pos()
        .field_custom(
            "Quest Drop ID",
            ParserType::RepeatMulti(
                Box::new(ParserType::Sequence(vec![
                    ParserType::Long,
                    ParserType::Pad(4),
                ])),
                10,
            ),
        )
        .load_pos()
        .field_custom(
            "Quest Drop Rate",
            ParserType::RepeatMulti(
                Box::new(ParserType::Sequence(vec![
                    ParserType::Pad(4),
                    ParserType::Long,
                ])),
                10,
            ),
        )
        // AI and vision (load the saved position one more time)
        .load_pos()
        .field_ulong("AI")
        .field_ubyte("Turn?")
        .pad(3)
        .field_ulong("Vision")
        .field_ulong("Noise")
        .field_ulong("GetExp")
        .field_ubyte("Light")
        .pad(3)
        .field_ulong("MobExp")
        // Stats
        .field_ulong("Level")
        .field_long("Max HP")
        .field_long("Current HP")
        .field_long("Max SP")
        .field_long("Current SP")
        .field_long("Minimum Attack")
        .field_long("Maximum Attack")
        .field_long("Physical Resistance")
        .field_long("Defense")
        .field_long("Hit Rate")
        .field_long("Dodge Rate")
        .field_long("Critical Chance")
        .field_long("Drop Rate Chance")
        .field_long("HP Recovery Per Cycle")
        .field_long("SP Recovery Per Cycle")
        .field_long("Attack Speed")
        .field_long("Attack Distance")
        .field_long("Chase Distance")
        .field_long("Movement Speed")
        .field_long("Col")
        .field_long("Strength")
        .field_long("Agility")
        .field_long("Accuracy")
        .field_long("Constitution")
        .field_long("Spirit")
        .field_long("Luck")
        .field_ulong("Left_Rad")
        // Guild and class
        .field_char_fixed("Guild ID", 32)
        .pad(1)
        .field_char_fixed("Title", 32)
        .pad(1)
        .field_char_fixed("Class", 16)
        .pad(2)
        // Experience
        .field_ulong("Experience")
        .pad(4)
        .field_ulong("Next Level Experience")
        .field_ulong("Reputation")
        .field_ushort("AP")
        .field_ushort("TP")
        .field_ulong("GD")
        .field_ulong("SPRI")
        .field_ulong("Story")
        .field_ulong("Max Sail")
        .field_ulong("Sail")
        .field_ulong("StaSA")
        .field_ulong("SCSM")
        // Total stats
        .field_long("TStrength")
        .field_long("TAgility")
        .field_long("TAccuracy")
        .field_long("TConstitution")
        .field_long("TSpirit")
        .field_long("TLuck")
        .field_long("TMax HP")
        .field_long("TMax SP")
        .field_long("TAttack")
        .field_long("TDefense")
        .field_long("THit Rate")
        .field_long("TDodge Rate")
        .field_long("TDrop Rate Chance")
        .field_long("TCritical Rate Chance")
        .field_long("THP Recovery")
        .field_long("TSP Recovery")
        .field_long("TAttack Speed")
        .field_long("TAttack Distance")
        .field_long("TMovement Speed")
        .field_ulong("TSPRI")
        .field_ulong("TSCSM")
        .pad(108) // Remaining bytes to reach 940 total
        .build()
}

/// Get CharacterInfo structure for a specific game version
pub fn get_character_info_structure(version: GameVersion) -> Structure {
    match version {
        GameVersion::V1 => create_character_info_v1(),
        // For now, all versions use V1 structure
        // TODO: Add version-specific overrides for V2-V8
        _ => create_character_info_v1(),
    }
}

/// Helper: build the 108-byte CRawDataInfo base prefix.
///
/// Only emits `nID` (offset 100, 4 bytes) as a visible field.
/// All other base fields (bExist, nIndex, szDataName, etc.) are padding.
fn raw_data_info_base(builder: StructureBuilder) -> StructureBuilder {
    builder
        .pad(100) // skip bExist(4) + nIndex(4) + szDataName(72) + dwLastUseTick(4) + bEnable(4) + pData(4) + dwPackOffset(4) + dwDataSize(4) = 100 bytes to nID
        .field_long("nID")
        .pad(4) // dwLoadCnt
}

/// Create ItemRefineInfo structure (152 bytes total).
///
/// CItemRefineInfo extends CRawDataInfo:
///   Base: 108 bytes (only nID emitted)
///   Value: short[14] (28 bytes) — effect category → refine effect ID
///   fChaEffectScale: float[4] (16 bytes) — per-character-type effect scale
pub fn create_item_refine_info() -> Structure {
    let builder = StructureBuilder::new("ItemRefineInfo");
    raw_data_info_base(builder)
        .field_short_repeat("Value", 14)
        .field_float_repeat("fChaEffectScale", 4)
        .build()
}

/// Create ItemRefineEffectInfo structure (164 bytes total).
///
/// CItemRefineEffectInfo extends CRawDataInfo:
///   Base: 108 bytes (only nID emitted)
///   nLightID: int (4 bytes)
///   sEffectID: short[16] (32 bytes) — [cha_type][tier] flattened
///   chDummy: byte[4] (4 bytes)
///   _sEffectNum: int[4] (16 bytes)
pub fn create_item_refine_effect_info() -> Structure {
    let builder = StructureBuilder::new("ItemRefineEffectInfo");
    raw_data_info_base(builder)
        .field_long("nLightID")
        .field_short_repeat("sEffectID", 16)
        .field_byte_repeat("chDummy", 4)
        .field_long_repeat("_sEffectNum", 4)
        .build()
}

/// Create sceneffectinfo structure (208 bytes total).
///
/// CMagicInfo extends CRawDataInfo:
///   Base: 108 bytes (only nID emitted)
///   szName: char[16]
///   szPhotoName: char[16]
///   nPhotoTexID: int
///   nEffType: int
///   nObjType: int
///   nDummyNum: int
///   nDummy: int[8]
///   nDummy2: int
///   nHeightOff: int
///   fPlayTime: float
///   LightID: int
///   fBaseSize: float
pub fn create_scene_effect_info() -> Structure {
    let builder = StructureBuilder::new("sceneffectinfo");
    raw_data_info_base(builder)
        .field_char_fixed("szName", 16)
        .field_char_fixed("szPhotoName", 16)
        .field_long("nPhotoTexID")
        .field_long("nEffType")
        .field_long("nObjType")
        .field_long("nDummyNum")
        .field_long_repeat("nDummy", 8)
        .field_long("nDummy2")
        .field_long("nHeightOff")
        .field_float("fPlayTime")
        .field_long("LightID")
        .field_float("fBaseSize")
        .build()
}

/// Create StoneInfo structure.
///
/// CStoneInfo extends CRawDataInfo:
///   Base: 108 bytes (only nID emitted)
///   nItemID: int (4 bytes)
///   nEquipPos: int[3] (12 bytes)
///   nType: int (4 bytes)
///   szHintFunc: char[64] (64 bytes)
pub fn create_stone_info() -> Structure {
    let builder = StructureBuilder::new("StoneInfo");
    raw_data_info_base(builder)
        .field_long("nItemID")
        .field_long_repeat("nEquipPos", 3)
        .field_long("nType")
        .field_char_fixed("szHintFunc", 64)
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_character_info_structure_creation() {
        let structure = create_character_info_v1();
        assert_eq!(structure.name(), "CharacterInfo");

        // Check that we have all the expected fields (excluding padding/save/load)
        let fields = structure.field_names();
        assert!(fields.contains(&"ID".to_string()));
        assert!(fields.contains(&"Name".to_string()));
        assert!(fields.contains(&"Level".to_string()));
        assert!(fields.contains(&"Max HP".to_string()));
    }

    #[test]
    fn test_item_refine_info_structure() {
        let structure = create_item_refine_info();
        assert_eq!(structure.name(), "ItemRefineInfo");
        let fields = structure.field_names();
        assert!(fields.contains(&"nID".to_string()));
        assert!(fields.contains(&"Value".to_string()));
        assert!(fields.contains(&"fChaEffectScale".to_string()));
    }

    #[test]
    fn test_item_refine_effect_info_structure() {
        let structure = create_item_refine_effect_info();
        assert_eq!(structure.name(), "ItemRefineEffectInfo");
        let fields = structure.field_names();
        assert!(fields.contains(&"nID".to_string()));
        assert!(fields.contains(&"nLightID".to_string()));
        assert!(fields.contains(&"sEffectID".to_string()));
        assert!(fields.contains(&"chDummy".to_string()));
        // _sEffectNum starts with _ so it's excluded from field_names() (treated as internal)
        // but it's still parsed and present in the raw output
    }

    #[test]
    fn test_scene_effect_info_structure() {
        let structure = create_scene_effect_info();
        assert_eq!(structure.name(), "sceneffectinfo");
        let fields = structure.field_names();
        assert!(fields.contains(&"nID".to_string()));
        assert!(fields.contains(&"szName".to_string()));
        assert!(fields.contains(&"nEffType".to_string()));
        assert!(fields.contains(&"fPlayTime".to_string()));
        assert!(fields.contains(&"fBaseSize".to_string()));
    }

    #[test]
    fn test_stone_info_structure() {
        let structure = create_stone_info();
        assert_eq!(structure.name(), "StoneInfo");
        let fields = structure.field_names();
        assert!(fields.contains(&"nID".to_string()));
        assert!(fields.contains(&"nItemID".to_string()));
        assert!(fields.contains(&"nEquipPos".to_string()));
        assert!(fields.contains(&"nType".to_string()));
        assert!(fields.contains(&"szHintFunc".to_string()));
    }
}
