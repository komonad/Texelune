use std::{
    io::{self, BufRead, BufReader, Write},
    net::TcpStream,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};
use tungstenite::{
    handshake::server::{Request, Response},
    Message,
};

const MAX_MESSAGE: usize = 16 * 1024 * 1024;
static SESSIONS: AtomicUsize = AtomicUsize::new(0);

pub fn file_uri(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let normalized = normalized.strip_prefix("//?/").unwrap_or(&normalized);
    let mut encoded = String::new();
    for byte in normalized.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/:".contains(&byte) {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(encoded, "%{byte:02X}").unwrap();
        }
    }
    format!("file:///{}", encoded.trim_start_matches('/'))
}

struct Session(Option<Child>);
impl Drop for Session {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
        SESSIONS.fetch_sub(1, Ordering::Relaxed);
    }
}

fn read_packet(reader: &mut impl BufRead) -> io::Result<String> {
    let mut length = None;
    let mut header_bytes = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Language server exited",
            ));
        }
        header_bytes += line.len();
        if header_bytes > 8192 {
            return Err(io::Error::other("LSP header limit exceeded"));
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("Content-Length") {
                length = Some(value.trim().parse::<usize>().map_err(io::Error::other)?);
            }
        }
    }
    let length = length
        .filter(|n| *n <= MAX_MESSAGE)
        .ok_or_else(|| io::Error::other("Invalid LSP Content-Length"))?;
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    String::from_utf8(bytes).map_err(io::Error::other)
}

fn blocked(error: &tungstenite::Error) -> bool {
    matches!(error, tungstenite::Error::Io(e) if e.kind()==io::ErrorKind::WouldBlock)
}

pub fn bridge(stream: TcpStream, root: &Path) -> io::Result<()> {
    let port = stream.local_addr()?.port();
    let mut socket = tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
        let origin = request
            .headers()
            .get("origin")
            .and_then(|v| v.to_str().ok());
        if ![
            format!("http://127.0.0.1:{port}"),
            format!("http://localhost:{port}"),
        ]
        .iter()
        .any(|allowed| Some(allowed.as_str()) == origin)
        {
            let mut denied = tungstenite::http::Response::new(Some("Origin rejected".to_owned()));
            *denied.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
            return Err(denied);
        }
        Ok(response)
    })
    .map_err(|e| io::Error::other(e.to_string()))?;
    if SESSIONS.fetch_add(1, Ordering::Relaxed) >= 4 {
        SESSIONS.fetch_sub(1, Ordering::Relaxed);
        let _ = socket.close(None);
        return Ok(());
    }
    let mut session = Session(None);
    let executable =
        std::env::var_os("TEXELUNE_LSP_COMMAND").unwrap_or_else(|| "rust-analyzer".into());
    let mut command = Command::new(executable);
    command
        .current_dir(root.join("examples/code-workspace"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    session.0 = match command.spawn() {
        Ok(child) => Some(child),
        Err(error) => {
            let message = serde_json::json!({"jsonrpc":"2.0","method":"texelune/serverError","params":{"message":format!("Cannot start rust-analyzer: {error}. Install with rustup component add rust-analyzer.")}});
            let _ = socket.send(Message::Text(message.to_string().into()));
            let _ = socket.close(None);
            return Ok(());
        }
    };
    let child = session.0.as_mut().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let (sender, receiver) = mpsc::sync_channel(8);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let result = read_packet(&mut reader);
            let failed = result.is_err();
            if sender.send(result).is_err() || failed {
                break;
            }
        }
    });
    socket.get_mut().set_nonblocking(true)?;
    socket.set_config(|config| {
        config.max_message_size = Some(MAX_MESSAGE);
        config.max_frame_size = Some(MAX_MESSAGE);
        config.max_write_buffer_size = 2 * MAX_MESSAGE;
    });
    loop {
        for _ in 0..8 {
            match receiver.try_recv() {
                Ok(Ok(packet)) => {
                    if let Err(error) = socket.send(Message::Text(packet.into())) {
                        if !blocked(&error) {
                            return Ok(());
                        }
                    }
                }
                Ok(Err(_)) | Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }
        if let Err(error) = socket.flush() {
            if !blocked(&error) {
                return Ok(());
            }
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let value: serde_json::Value =
                    serde_json::from_str(text.as_str()).map_err(io::Error::other)?;
                if let Some(method) = value.get("method").and_then(|v| v.as_str()) {
                    let allowed = [
                        "initialize",
                        "initialized",
                        "shutdown",
                        "exit",
                        "$/cancelRequest",
                        "$/setTrace",
                        "textDocument/didOpen",
                        "textDocument/didChange",
                        "textDocument/didClose",
                        "textDocument/semanticTokens/full",
                        "textDocument/semanticTokens/range",
                        "textDocument/hover",
                        "textDocument/definition",
                        "textDocument/diagnostic",
                        "textDocument/completion",
                    ];
                    if !allowed.contains(&method) {
                        continue;
                    }
                }
                write!(stdin, "Content-Length: {}\r\n\r\n{}", text.len(), text)?;
                stdin.flush()?;
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(error) if blocked(&error) => thread::sleep(Duration::from_millis(2)),
            Err(_) => return Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_consecutive_utf8_packets_and_rejects_unbounded_lengths() {
        let data = "Content-Length: 6\r\n\r\n你好Content-Length: 2\r\n\r\n{}";
        let mut reader = io::Cursor::new(data.as_bytes());
        assert_eq!(read_packet(&mut reader).unwrap(), "你好");
        assert_eq!(read_packet(&mut reader).unwrap(), "{}");
        assert!(read_packet(&mut io::Cursor::new(b"Content-Length: 999999999\r\n\r\n")).is_err());
        assert_eq!(
            file_uri(Path::new("D:\\dev\\a b\\main.rs")),
            "file:///D:/dev/a%20b/main.rs"
        );
    }
}
