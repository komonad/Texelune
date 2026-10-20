use serde::{Deserialize, Serialize};
use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum TokenKind {
    Keyword,
    String,
    Comment,
    Number,
    Type,
}
#[derive(Clone, Debug)]
pub struct Token {
    pub range: Range<usize>,
    pub kind: TokenKind,
}

/// A bounded, line-local lexer. Stateful language providers can supply external spans.
pub fn highlight(text: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some((start, c)) = chars.next() {
        if c == '/' && chars.peek().is_some_and(|(_, n)| *n == '/') {
            tokens.push(Token {
                range: start..text.len(),
                kind: TokenKind::Comment,
            });
            break;
        }
        if c == '"' || c == '\'' {
            let mut escaped = false;
            let mut end = start + c.len_utf8();
            for (i, n) in chars.by_ref() {
                end = i + n.len_utf8();
                if n == c && !escaped {
                    break;
                }
                escaped = n == '\\' && !escaped;
            }
            tokens.push(Token {
                range: start..end,
                kind: TokenKind::String,
            });
        } else if c.is_ascii_digit() {
            let mut end = start + 1;
            while let Some(&(i, n)) = chars.peek() {
                if !n.is_ascii_alphanumeric() && n != '.' && n != '_' {
                    break;
                }
                chars.next();
                end = i + n.len_utf8();
            }
            tokens.push(Token {
                range: start..end,
                kind: TokenKind::Number,
            });
        } else if c.is_alphabetic() || c == '_' {
            let mut end = start + c.len_utf8();
            while let Some(&(i, n)) = chars.peek() {
                if !n.is_alphanumeric() && n != '_' {
                    break;
                }
                chars.next();
                end = i + n.len_utf8();
            }
            let word = &text[start..end];
            let kind = if [
                "fn", "let", "mut", "pub", "struct", "impl", "use", "mod", "enum", "match", "if",
                "else", "for", "while", "return", "async", "await", "const", "true", "false",
                "Self", "in", "move", "trait", "where",
            ]
            .contains(&word)
            {
                Some(TokenKind::Keyword)
            } else if c.is_uppercase() {
                Some(TokenKind::Type)
            } else {
                None
            };
            if let Some(kind) = kind {
                tokens.push(Token {
                    range: start..end,
                    kind,
                });
            }
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_escaped_strings_and_unicode_offsets() {
        let text = "let 世界 = \"a\\\"b\"; // comment";
        let spans = highlight(text);
        assert_eq!(&text[spans[1].range.clone()], "\"a\\\"b\"");
        assert_eq!(spans.last().unwrap().kind, TokenKind::Comment);
    }
}
