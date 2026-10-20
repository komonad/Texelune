use std::{
    fs,
    path::{Path, PathBuf},
};

fn decode(value: &str) -> Option<String> {
    let mut bytes = Vec::new();
    let mut source = value.bytes();
    while let Some(byte) = source.next() {
        if byte == b'%' {
            let hi = (source.next()? as char).to_digit(16)? as u8;
            let lo = (source.next()? as char).to_digit(16)? as u8;
            bytes.push(hi * 16 + lo);
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).ok()
}

pub fn read(workspace: &Path, encoded: &str) -> Option<(PathBuf, String)> {
    let relative = decode(encoded)?;
    let relative = Path::new(&relative);
    if relative.is_absolute()
        || relative.components().any(|part| {
            !matches!(
                part,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
    {
        return None;
    }
    let file = workspace.join(relative).canonicalize().ok()?;
    if !file.starts_with(workspace)
        || !file.is_file()
        || fs::metadata(&file).ok()?.len() > 2 * 1024 * 1024
    {
        return None;
    }
    let text = fs::read_to_string(&file).ok()?;
    Some((file, text))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_paths_are_bounded_by_the_workspace() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("examples/code-workspace")
            .canonicalize()
            .unwrap();
        assert!(read(&workspace, "src%2Fmain.rs").is_some());
        for path in [
            "..%2F..%2FCargo.toml",
            "%2FCargo.toml",
            "C%3A%5CWindows%5Cwin.ini",
            "%ZZ",
            "%00",
        ] {
            assert!(read(&workspace, path).is_none());
        }
    }
}
