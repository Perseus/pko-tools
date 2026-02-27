use std::path::Path;
use std::sync::Once;

use anyhow::Result;

use super::lmo::LmoModel;

const ENV_LMO_PARSER: &str = "PKO_LMO_PARSER";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LmoParserBackend {
    Native,
    Kaitai,
}

fn parse_lmo_backend(raw: Option<&str>) -> LmoParserBackend {
    match raw.map(|v| v.trim().to_ascii_lowercase()) {
        Some(v) if v == "kaitai" || v == "ksy" => LmoParserBackend::Kaitai,
        _ => LmoParserBackend::Native,
    }
}

pub fn selected_lmo_backend() -> LmoParserBackend {
    let raw = std::env::var(ENV_LMO_PARSER).ok();
    parse_lmo_backend(raw.as_deref())
}

pub fn load_lmo(path: &Path) -> Result<LmoModel> {
    match selected_lmo_backend() {
        LmoParserBackend::Native => super::lmo::load_lmo(path),
        LmoParserBackend::Kaitai => load_lmo_kaitai(path, true),
    }
}

pub fn load_lmo_no_animation(path: &Path) -> Result<LmoModel> {
    match selected_lmo_backend() {
        LmoParserBackend::Native => super::lmo::load_lmo_no_animation(path),
        LmoParserBackend::Kaitai => load_lmo_kaitai(path, false),
    }
}

fn load_lmo_kaitai(path: &Path, parse_animations: bool) -> Result<LmoModel> {
    static WARN_ONCE: Once = Once::new();
    WARN_ONCE.call_once(|| {
        eprintln!(
            "PKO_LMO_PARSER=kaitai selected, but Kaitai adapter is scaffold-only; falling back to native parser"
        );
    });

    if parse_animations {
        super::lmo::load_lmo(path)
    } else {
        super::lmo::load_lmo_no_animation(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_defaults_to_native() {
        assert_eq!(parse_lmo_backend(None), LmoParserBackend::Native);
        assert_eq!(parse_lmo_backend(Some("")), LmoParserBackend::Native);
    }

    #[test]
    fn backend_accepts_kaitai_markers() {
        assert_eq!(
            parse_lmo_backend(Some("kaitai")),
            LmoParserBackend::Kaitai
        );
        assert_eq!(parse_lmo_backend(Some("KSY")), LmoParserBackend::Kaitai);
    }

    #[test]
    fn backend_ignores_unknown_values() {
        assert_eq!(parse_lmo_backend(Some("manual")), LmoParserBackend::Native);
        assert_eq!(parse_lmo_backend(Some("foo")), LmoParserBackend::Native);
    }
}
