#[path = "support/lsp.rs"]
mod lsp;
#[path = "support/source.rs"]
mod source;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    thread,
};
fn main() -> std::io::Result<()> {
    let port = std::env::args().nth(1).unwrap_or_else(|| "4173".into());
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).canonicalize()?;
    let server = TcpListener::bind(format!("127.0.0.1:{port}"))?;
    println!("Texelune: http://127.0.0.1:{port}/web/");
    for stream in server.incoming().flatten() {
        let root = root.clone();
        thread::spawn(move || {
            if let Err(error) = respond(stream, &root) {
                eprintln!("HTTP: {error}");
            }
        });
    }
    Ok(())
}
fn body(stream: &mut TcpStream, status: &str, mime: &str, content: &[u8]) -> std::io::Result<()> {
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",content.len())?;
    stream.write_all(content)
}
fn respond(mut stream: TcpStream, root: &Path) -> std::io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(3)))?;
    let mut peek = [0; 8192];
    let size = stream.peek(&mut peek)?;
    if peek[..size].starts_with(b"GET /lsp ") {
        return lsp::bridge(stream, root);
    }
    let mut buffer = [0; 8192];
    let size = stream.read(&mut buffer)?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut parts = request.lines().next().unwrap_or("").split_whitespace();
    if parts.next() != Some("GET") {
        return body(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            b"GET required",
        );
    }
    let target = parts.next().unwrap_or("/");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path == "/" {
        return stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: /web/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
    if path == "/api/workspace" {
        let workspace = root.join("examples/code-workspace").canonicalize()?;
        let file = workspace.join("src/main.rs");
        let data = serde_json::json!({"rootUri":lsp::file_uri(&workspace),"uri":lsp::file_uri(&file),"text":fs::read_to_string(file)?,"languageId":"rust","server":"rust-analyzer","maxDocumentBytes":2*1024*1024});
        return body(
            &mut stream,
            "200 OK",
            "application/json",
            data.to_string().as_bytes(),
        );
    }
    if path == "/api/source" {
        let workspace = root.join("examples/code-workspace").canonicalize()?;
        if let Some((file, text)) = query
            .strip_prefix("path=")
            .and_then(|path| source::read(&workspace, path))
        {
            let data = serde_json::json!({"uri":lsp::file_uri(&file),"text":text});
            return body(
                &mut stream,
                "200 OK",
                "application/json",
                data.to_string().as_bytes(),
            );
        }
        return body(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"Workspace source unavailable",
        );
    }
    let relative = if path.ends_with('/') {
        format!("{}index.html", path.trim_start_matches('/'))
    } else {
        path.trim_start_matches('/').into()
    };
    let requested = match root.join(relative).canonicalize() {
        Ok(path)
            if ["web", "assets", "packages/editor"]
                .iter()
                .any(|p| path.starts_with(root.join(p)))
                && path.is_file() =>
        {
            path
        }
        _ => return body(&mut stream, "404 Not Found", "text/plain", b"Not found"),
    };
    let mime = match requested.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    };
    body(&mut stream, "200 OK", mime, &fs::read(requested)?)
}
