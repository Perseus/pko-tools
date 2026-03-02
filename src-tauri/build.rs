use std::env;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=KSC_BIN");
    println!("cargo:rerun-if-env-changed=PKO_KAITAI_BUILD");
    println!("cargo:rerun-if-changed=../formats");

    if let Err(err) = build_kaitai_rust_scaffold() {
        panic!("Kaitai scaffold generation failed: {err}");
    }

    tauri_build::build();
}

fn build_kaitai_rust_scaffold() -> Result<(), String> {
    let enable = env::var("PKO_KAITAI_BUILD")
        .map(|raw| {
            let lower = raw.trim().to_ascii_lowercase();
            !(lower == "0" || lower == "false" || lower == "off")
        })
        .unwrap_or(true);

    let formats_dir = PathBuf::from("../formats");
    let out_dir = PathBuf::from("gen/kaitai");

    if !formats_dir.exists() {
        return Ok(());
    }

    let specs = collect_ksy_files(&formats_dir)?;
    if specs.is_empty() {
        return Ok(());
    }

    fs::create_dir_all(&out_dir).map_err(|e| format!("failed to create output directory: {e}"))?;

    let module_names: Vec<String> = specs
        .iter()
        .filter_map(|path| path.file_stem().and_then(|stem| stem.to_str()))
        .map(|stem| stem.to_string())
        .collect();

    if !enable {
        ensure_generated_outputs_exist(&out_dir, &module_names)?;
        return Ok(());
    }

    let ksc_bin = env::var("KSC_BIN").unwrap_or_else(|_| "ksc".to_string());
    let ksc_available = Command::new(&ksc_bin)
        .arg("--help")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);

    if !ksc_available {
        ensure_generated_outputs_exist(&out_dir, &module_names).map_err(|_| {
            format!(
                "ksc not found (KSC_BIN={ksc_bin}) and generated Rust files are missing. \
Install kaitai-struct-compiler or set PKO_KAITAI_BUILD=0 once files are checked in."
            )
        })?;
        return Ok(());
    }

    for spec in &specs {
        let status = Command::new(&ksc_bin)
            .arg("--target")
            .arg("rust")
            .arg("--outdir")
            .arg(&out_dir)
            .arg(spec)
            .status()
            .map_err(|e| format!("failed to run ksc for {}: {e}", spec.display()))?;
        if !status.success() {
            return Err(format!("ksc failed for {}", spec.display()));
        }
    }

    let mut sorted_modules = module_names;
    sorted_modules.sort();
    sorted_modules.dedup();
    write_mod_rs(&out_dir, &sorted_modules)?;

    Ok(())
}

fn collect_ksy_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut specs = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|e| format!("failed to read directory {}: {e}", dir.display()))?;
        for entry in entries {
            let entry = entry
                .map_err(|e| format!("failed to read entry in {}: {e}", dir.display()))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension() == Some(OsStr::new("ksy")) {
                specs.push(path);
            }
        }
    }

    specs.sort();
    Ok(specs)
}

fn ensure_generated_outputs_exist(out_dir: &Path, module_names: &[String]) -> Result<(), String> {
    for name in module_names {
        let file = out_dir.join(format!("{name}.rs"));
        if !file.exists() {
            return Err(format!("missing generated file: {}", file.display()));
        }
    }
    let mod_file = out_dir.join("mod.rs");
    if !mod_file.exists() {
        return Err(format!("missing generated file: {}", mod_file.display()));
    }
    Ok(())
}

fn write_mod_rs(out_dir: &Path, module_names: &[String]) -> Result<(), String> {
    let mod_path = out_dir.join("mod.rs");
    let mut content = String::new();
    for name in module_names {
        content.push_str("pub mod ");
        content.push_str(name);
        content.push_str(";\n");
    }
    fs::write(&mod_path, content)
        .map_err(|e| format!("failed to write {}: {e}", mod_path.display()))
}
