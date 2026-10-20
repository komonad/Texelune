use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tungstenite::Message;

#[derive(Default)]
struct State {
    text: String,
    version: u64,
    held: Vec<Value>,
    writes: Vec<Value>,
    requests: usize,
}

fn at(text: &str, position: &Value) -> usize {
    let line = position["line"].as_u64().unwrap() as usize;
    let start = text
        .split_inclusive('\n')
        .take(line)
        .map(str::len)
        .sum::<usize>();
    let target = position["character"].as_u64().unwrap() as usize;
    let mut units = 0;
    for (offset, ch) in text[start..].char_indices() {
        if units >= target {
            return start + offset;
        }
        units += ch.len_utf16();
    }
    text.len()
}
fn tokens(text: &str) -> Vec<u32> {
    let mut data = vec![];
    let mut chars = text.char_indices().peekable();
    let (mut line, mut column, mut previous_line, mut previous_column) = (0, 0, 0, 0);
    while let Some((start, ch)) = chars.next() {
        if ch == '\n' {
            line += 1;
            column = 0;
            continue;
        }
        if ch.is_ascii_alphabetic() {
            let first_column = column;
            let mut end = start + 1;
            column += 1;
            while let Some(&(offset, next)) = chars.peek() {
                if !next.is_ascii_alphanumeric() && next != '_' {
                    break;
                }
                chars.next();
                end = offset + 1;
                column += 1;
            }
            let word = &text[start..end];
            let kind = if word.starts_with("foo") {
                Some(0)
            } else if word.starts_with("bar") {
                Some(1)
            } else if word.starts_with("baz") {
                Some(2)
            } else {
                None
            };
            if let Some(kind) = kind {
                data.extend([
                    line - previous_line,
                    if line == previous_line {
                        first_column - previous_column
                    } else {
                        first_column
                    },
                    column - first_column,
                    kind,
                    0,
                ]);
                previous_line = line;
                previous_column = first_column;
            }
        } else {
            column += ch.len_utf16() as u32;
        }
    }
    data
}
fn http(mut stream: TcpStream, state: Arc<Mutex<State>>) {
    let mut bytes = [0; 4096];
    let count = stream.read(&mut bytes).unwrap();
    let request = String::from_utf8_lossy(&bytes[..count]);
    let path = request.split_whitespace().nth(1).unwrap_or("/");
    let mut state = state.lock().unwrap();
    let result = if let Some(id) = path
        .strip_prefix("/release?id=")
        .and_then(|v| v.parse::<u64>().ok())
    {
        if let Some(item) = state.held.iter_mut().find(|item| item["id"] == id) {
            item["release"] = json!(true);
        }
        json!({"ok":true})
    } else {
        json!({"text":state.text,"version":state.version,"held":state.held,"writes":state.writes,"requests":state.requests})
    };
    let body = result.to_string();
    let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
}
fn websocket(stream: TcpStream, state: Arc<Mutex<State>>) {
    let mut socket = tungstenite::accept(stream).unwrap();
    socket.get_mut().set_nonblocking(true).unwrap();
    *state.lock().unwrap() = State::default();
    loop {
        let mut outgoing = vec![];
        {
            let mut state = state.lock().unwrap();
            let data = tokens(&state.text);
            for item in &mut state.held {
                if item["release"] == true && item["released"] != true {
                    item["released"] = json!(true);
                    outgoing.push(json!({"jsonrpc":"2.0","id":item["id"],"result":{"data":data}}));
                }
            }
        }
        for value in outgoing {
            if socket
                .send(Message::Text(value.to_string().into()))
                .is_err()
            {
                return;
            }
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let message: Value = serde_json::from_str(&text).unwrap();
                let mut state = state.lock().unwrap();
                let method = message["method"].as_str().unwrap_or("");
                let params = &message["params"];
                match method {
                    "initialize" => {
                        let _=socket.send(Message::Text(json!({"jsonrpc":"2.0","id":message["id"],"result":{"serverInfo":{"name":"delayed-lsp"},"capabilities":{"positionEncoding":"utf-16","textDocumentSync":{"openClose":true,"change":2},"semanticTokensProvider":{"legend":{"tokenTypes":["keyword","string","function"],"tokenModifiers":[]},"full":true}}}}).to_string().into()));
                    }
                    "textDocument/didOpen" => {
                        state.text = params["textDocument"]["text"].as_str().unwrap().into();
                        state.version = params["textDocument"]["version"].as_u64().unwrap();
                    }
                    "textDocument/didChange" => {
                        for edit in params["contentChanges"].as_array().unwrap() {
                            let insert = edit["text"].as_str().unwrap();
                            if edit["range"].is_object() {
                                let start = at(&state.text, &edit["range"]["start"]);
                                let end = at(&state.text, &edit["range"]["end"]);
                                state.text.replace_range(start..end, insert);
                            } else {
                                state.text = insert.into();
                            }
                        }
                        state.version = params["textDocument"]["version"].as_u64().unwrap();
                        let entry = json!({"version":state.version,"text":state.text,"changes":params["contentChanges"].as_array().unwrap().len()});
                        state.writes.push(entry);
                    }
                    "textDocument/semanticTokens/full" => {
                        state.requests += 1;
                        let entry = json!({"id":message["id"],"version":state.version,"text":state.text,"cancelled":false,"released":false});
                        state.held.push(entry);
                    }
                    "$/cancelRequest" => {
                        if let Some(item) = state
                            .held
                            .iter_mut()
                            .find(|item| item["id"] == params["id"])
                        {
                            item["cancelled"] = json!(true);
                        }
                    }
                    _ => {
                        if message.get("id").is_some() {
                            let _ = socket.send(Message::Text(
                                json!({"jsonrpc":"2.0","id":message["id"],"result":null})
                                    .to_string()
                                    .into(),
                            ));
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => return,
            Err(tungstenite::Error::Io(error))
                if error.kind() == std::io::ErrorKind::WouldBlock =>
            {
                thread::sleep(Duration::from_millis(2))
            }
            Err(_) => return,
            _ => {}
        }
    }
}
fn main() {
    let port = std::env::args().nth(1).unwrap_or_else(|| "4175".into());
    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
    let state = Arc::new(Mutex::new(State::default()));
    println!("Delayed LSP fixture: 127.0.0.1:{port}");
    for stream in listener.incoming().flatten() {
        let state = state.clone();
        thread::spawn(move || {
            let mut peek = [0; 64];
            let size = stream.peek(&mut peek).unwrap();
            if peek[..size].starts_with(b"GET /lsp ") {
                websocket(stream, state);
            } else {
                http(stream, state);
            }
        });
    }
}
