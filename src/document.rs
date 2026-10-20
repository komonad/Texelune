use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::ops::Range;
use unicode_segmentation::{GraphemeCursor, GraphemeIncomplete};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Style {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub foreground: Option<[f32; 4]>,
    pub background: Option<[f32; 4]>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Decoration {
    pub start: usize,
    pub end: usize,
    pub style: Style,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Selection {
    pub anchor: usize,
    pub head: usize,
}

impl Selection {
    pub fn range(self) -> Range<usize> {
        self.anchor.min(self.head)..self.anchor.max(self.head)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Change {
    pub version: u64,
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub selection: Selection,
    pub decorations: Vec<Decoration>,
}

struct History {
    text: Rope,
    decorations: Vec<Decoration>,
    selection: Selection,
    forward: (usize, usize, String),
    backward: (usize, usize, String),
}
struct Group {
    history: History,
    start: usize,
    old_end: usize,
    current_end: usize,
}

pub struct Document {
    pub text: Rope,
    pub version: u64,
    pub selection: Selection,
    pub decorations: Vec<Decoration>,
    undo: Vec<History>,
    redo: Vec<History>,
    group: Option<Group>,
}

impl Document {
    pub fn position_at(&self, offset: usize) -> (usize, usize) {
        position_at(&self.text, offset)
    }

    pub fn offset_at(&self, line: usize, character: usize) -> usize {
        offset_at(&self.text, line, character)
    }

    pub fn new(text: &str) -> Self {
        Self::from_rope(Rope::from_str(text))
    }
    pub fn from_rope(text: Rope) -> Self {
        Self {
            text,
            version: 0,
            selection: Selection::default(),
            decorations: Vec::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            group: None,
        }
    }

    pub fn select(&mut self, anchor: usize, head: usize) {
        let len = self.text.len_chars();
        self.selection = Selection {
            anchor: anchor.min(len),
            head: head.min(len),
        };
    }

    pub fn line_edge(&self, position: usize, end: bool) -> usize {
        let line = self.text.char_to_line(position.min(self.text.len_chars()));
        let start = self.text.line_to_char(line);
        if !end {
            return start;
        }
        let source = self.text.line(line);
        let len = source.len_chars();
        let ending = if len > 1 && source.char(len - 2) == '\r' && source.char(len - 1) == '\n' {
            2
        } else if len > 0
            && matches!(
                source.char(len - 1),
                '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{85}' | '\u{2028}' | '\u{2029}'
            )
        {
            1
        } else {
            0
        };
        start + len - ending
    }

    pub fn replace(&mut self, range: Range<usize>, text: &str) -> Change {
        let start = range.start.min(self.text.len_chars());
        let end = range.end.max(start).min(self.text.len_chars());
        let inserted = text.chars().count();
        let history = History {
            text: self.text.clone(),
            decorations: self.decorations.clone(),
            selection: self.selection,
            forward: (start, end, text.to_owned()),
            backward: (
                start,
                start + inserted,
                self.text.slice(start..end).to_string(),
            ),
        };
        if let Some(group) = &mut self.group {
            group.current_end = group.current_end - (end - start) + inserted;
        } else {
            self.undo.push(history);
            if self.undo.len() > 512 {
                self.undo.remove(0);
            }
        }
        self.redo.clear();
        self.text.remove(start..end);
        self.text.insert(start, text);
        for mark in &mut self.decorations {
            mark.start = map_anchor(mark.start, start..end, inserted, false);
            mark.end = map_anchor(mark.end, start..end, inserted, true);
        }
        self.decorations.retain(|d| d.start < d.end);
        self.select(start + inserted, start + inserted);
        self.version += 1;
        self.change(start, end, text.to_owned())
    }

    pub fn begin_group(&mut self) {
        self.end_group();
        let range = self.selection.range();
        self.group = Some(Group {
            history: History {
                text: self.text.clone(),
                decorations: self.decorations.clone(),
                selection: self.selection,
                forward: (0, 0, String::new()),
                backward: (
                    range.start,
                    range.end,
                    self.text.slice(range.clone()).to_string(),
                ),
            },
            start: range.start,
            old_end: range.end,
            current_end: range.end,
        });
    }
    pub fn end_group(&mut self) {
        if let Some(mut group) = self.group.take() {
            group.history.forward = (
                group.start,
                group.old_end,
                self.text.slice(group.start..group.current_end).to_string(),
            );
            group.history.backward.1 = group.current_end;
            self.undo.push(group.history);
            if self.undo.len() > 512 {
                self.undo.remove(0);
            }
        }
    }

    pub fn format(&mut self, style: Style) -> Option<Change> {
        let range = self.selection.range();
        if range.is_empty() {
            return None;
        }
        // Formatting uses the same snapshot history as text transactions.
        self.undo.push(History {
            text: self.text.clone(),
            decorations: self.decorations.clone(),
            selection: self.selection,
            forward: (0, 0, String::new()),
            backward: (0, 0, String::new()),
        });
        self.redo.clear();
        self.decorations.push(Decoration {
            start: range.start,
            end: range.end,
            style,
        });
        self.version += 1;
        Some(self.change(0, 0, String::new()))
    }

    pub fn toggle(&mut self, attribute: &str) -> Option<Change> {
        let range = self.selection.range();
        if range.is_empty() || !matches!(attribute, "bold" | "italic" | "underline") {
            return None;
        }
        let value = |s: Style| match attribute {
            "bold" => s.bold,
            "italic" => s.italic,
            _ => s.underline,
        };
        let mut boundaries = vec![range.start, range.end];
        for m in &self.decorations {
            if m.start < range.end && m.end > range.start {
                boundaries.extend([m.start.max(range.start), m.end.min(range.end)]);
            }
        }
        boundaries.sort_unstable();
        boundaries.dedup();
        let enabled = !boundaries.windows(2).all(|p| {
            self.decorations
                .iter()
                .any(|m| m.start <= p[0] && m.end > p[0] && value(m.style))
        });
        self.undo.push(History {
            text: self.text.clone(),
            decorations: self.decorations.clone(),
            selection: self.selection,
            forward: (0, 0, String::new()),
            backward: (0, 0, String::new()),
        });
        self.redo.clear();
        let mut marks = Vec::new();
        for m in self.decorations.drain(..) {
            if m.start >= range.end || m.end <= range.start {
                marks.push(m);
                continue;
            }
            if m.start < range.start {
                marks.push(Decoration {
                    start: m.start,
                    end: range.start,
                    style: m.style,
                });
            }
            let mut style = m.style;
            match attribute {
                "bold" => style.bold = false,
                "italic" => style.italic = false,
                _ => style.underline = false,
            }
            if style != Style::default() {
                marks.push(Decoration {
                    start: m.start.max(range.start),
                    end: m.end.min(range.end),
                    style,
                });
            }
            if m.end > range.end {
                marks.push(Decoration {
                    start: range.end,
                    end: m.end,
                    style: m.style,
                });
            }
        }
        if enabled {
            let mut style = Style::default();
            match attribute {
                "bold" => style.bold = true,
                "italic" => style.italic = true,
                _ => style.underline = true,
            }
            marks.push(Decoration {
                start: range.start,
                end: range.end,
                style,
            });
        }
        self.decorations = marks;
        self.version += 1;
        Some(self.change(0, 0, String::new()))
    }

    pub fn undo(&mut self) -> Option<Change> {
        self.history(false)
    }
    pub fn redo(&mut self) -> Option<Change> {
        self.history(true)
    }

    fn history(&mut self, redo: bool) -> Option<Change> {
        self.end_group();
        let entry = if redo {
            self.redo.pop()?
        } else {
            self.undo.pop()?
        };
        let operation = if redo {
            entry.forward.clone()
        } else {
            entry.backward.clone()
        };
        let inverse = History {
            text: self.text.clone(),
            decorations: self.decorations.clone(),
            selection: self.selection,
            forward: entry.forward,
            backward: entry.backward,
        };
        self.text = entry.text;
        self.decorations = entry.decorations;
        self.selection = entry.selection;
        if redo {
            self.undo.push(inverse);
        } else {
            self.redo.push(inverse);
        }
        self.version += 1;
        Some(self.change(operation.0, operation.1, operation.2))
    }

    fn change(&self, start: usize, end: usize, text: String) -> Change {
        Change {
            version: self.version,
            start,
            end,
            text,
            selection: self.selection,
            decorations: self.decorations.clone(),
        }
    }

    pub fn boundary(&self, position: usize, forward: bool) -> usize {
        self.boundary_bounded(position, forward, usize::MAX)
            .expect("unlimited boundary scan")
    }

    pub fn boundary_bounded(&self, position: usize, forward: bool, limit: usize) -> Option<usize> {
        let byte = self.text.char_to_byte(position.min(self.text.len_chars()));
        if (forward && byte == self.text.len_bytes()) || (!forward && byte == 0) {
            return Some(position);
        }
        let mut cursor = GraphemeCursor::new(byte, self.text.len_bytes(), true);
        let (mut chunk, mut chunk_start, _, _) = self.text.chunk_at_byte(byte);
        for _ in 0..limit {
            let result = if forward {
                cursor.next_boundary(chunk, chunk_start)
            } else {
                cursor.prev_boundary(chunk, chunk_start)
            };
            match result {
                Ok(Some(boundary)) => return Some(self.text.byte_to_char(boundary)),
                Ok(None) => return Some(if forward { self.text.len_chars() } else { 0 }),
                Err(GraphemeIncomplete::NextChunk) => {
                    (chunk, chunk_start, _, _) = self.text.chunk_at_byte(chunk_start + chunk.len());
                }
                Err(GraphemeIncomplete::PrevChunk) => {
                    (chunk, chunk_start, _, _) =
                        self.text.chunk_at_byte(chunk_start.saturating_sub(1));
                }
                Err(GraphemeIncomplete::PreContext(offset)) => {
                    let (context, start, _, _) = self.text.chunk_at_byte(offset - 1);
                    cursor.provide_context(&context[..offset - start], start);
                }
                Err(GraphemeIncomplete::InvalidOffset) => {
                    unreachable!("rope cursor is a UTF-8 boundary")
                }
            }
        }
        None
    }
}

pub fn position_at(text: &Rope, offset: usize) -> (usize, usize) {
    let offset = offset.min(text.len_chars());
    let line = text.char_to_line(offset);
    let start = text.line_to_char(line);
    (
        line,
        text.char_to_utf16_cu(offset) - text.char_to_utf16_cu(start),
    )
}

pub fn offset_at(text: &Rope, line: usize, character: usize) -> usize {
    if line >= text.len_lines() {
        return text.len_chars();
    }
    let start = text.line_to_char(line);
    let mut end = start + text.line(line).len_chars();
    if end > start && text.char(end - 1) == '\n' {
        end -= 1;
        if end > start && text.char(end - 1) == '\r' {
            end -= 1;
        }
    }
    let first = text.char_to_utf16_cu(start);
    let last = text.char_to_utf16_cu(end);
    text.utf16_cu_to_char(first + character.min(last - first))
}

pub fn map_anchor(position: usize, replaced: Range<usize>, inserted: usize, after: bool) -> usize {
    if position < replaced.start {
        position
    } else if position > replaced.end {
        position - (replaced.end - replaced.start) + inserted
    } else if after {
        replaced.start + inserted
    } else {
        replaced.start
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utf16_ranges_use_their_read_snapshot_after_line_and_astral_edits() {
        let mut document = Document::new("👩🏽‍💻 e\u{301}\r\nאבג bar");
        let snapshot = document.text.clone();
        let start = offset_at(&snapshot, 1, 4);
        document.replace(0..0, "\n🌏\n");
        assert_eq!(snapshot.slice(start..start + 3).to_string(), "bar");
        assert_eq!(position_at(&snapshot, start), (1, 4));
        assert_ne!(document.offset_at(1, 4), start);
    }
    #[test]
    fn lsp_coordinates_round_trip_scalars_and_utf16() {
        let doc = Document::new("a👩🏽‍💻e\u{301}\r\nאבג\n");
        for offset in 0..=doc.text.len_chars() {
            let (line, column) = doc.position_at(offset);
            if offset < doc.text.len_chars() && matches!(doc.text.char(offset), '\r' | '\n') {
                continue;
            }
            assert_eq!(doc.offset_at(line, column), offset);
        }
        assert_eq!(doc.position_at(2), (0, 3));
        assert_eq!(doc.offset_at(0, 2), 1);
        assert_eq!(doc.offset_at(0, usize::MAX), 7);
        assert_eq!(doc.offset_at(99, 0), doc.text.len_chars());
    }
    #[test]
    fn underline_toggle_preserves_other_properties_and_undo() {
        let mut doc = Document::new("abcdef");
        doc.select(0, 6);
        doc.format(Style {
            bold: true,
            italic: true,
            ..Style::default()
        });
        doc.select(1, 4);
        doc.toggle("underline");
        assert!(doc
            .decorations
            .iter()
            .any(|m| m.start == 1 && m.end == 4 && m.style.underline));
        doc.select(2, 3);
        doc.toggle("underline");
        assert!(!doc
            .decorations
            .iter()
            .any(|m| m.start <= 2 && m.end > 2 && m.style.underline));
        assert!(doc
            .decorations
            .iter()
            .any(|m| m.start <= 2 && m.end > 2 && m.style.bold && m.style.italic));
        doc.undo();
        assert!(doc
            .decorations
            .iter()
            .any(|m| m.start <= 2 && m.end > 2 && m.style.underline));
    }
    #[test]
    fn line_edges_and_composition_history_preserve_clusters() {
        let mut doc = Document::new("a\r\nb\u{2028}c");
        assert_eq!(doc.line_edge(0, true), 1);
        assert_eq!(doc.line_edge(3, true), 4);
        doc.select(0, 1);
        doc.begin_group();
        doc.replace(0..1, "n");
        doc.replace(0..1, "ni");
        doc.replace(0..2, "你");
        doc.end_group();
        doc.undo();
        assert_eq!(doc.text.to_string(), "a\r\nb\u{2028}c");
        doc.redo();
        assert_eq!(doc.text.to_string(), "你\r\nb\u{2028}c");
    }
    #[test]
    fn history_restores_text_selection_and_format() {
        let mut doc = Document::new("hello 世界");
        doc.select(0, 5);
        doc.format(Style {
            bold: true,
            ..Style::default()
        });
        doc.replace(6..8, "🌍");
        assert_eq!(doc.text.to_string(), "hello 🌍");
        doc.undo();
        assert_eq!(doc.text.to_string(), "hello 世界");
        doc.undo();
        assert!(doc.decorations.is_empty());
        doc.redo();
        doc.redo();
        assert_eq!(doc.text.to_string(), "hello 🌍");
        assert!(doc.decorations[0].style.bold);
    }
    #[test]
    fn grapheme_navigation_crosses_rope_chunks() {
        let text = format!("{}👩‍💻e\u{301}🇨🇳", "a".repeat(1023));
        let doc = Document::new(&text);
        let mut p = doc.text.len_chars();
        for expected in [1028, 1026, 1023] {
            p = doc.boundary(p, false);
            assert_eq!(p, expected);
        }
        assert_eq!(doc.boundary(1023, true), 1026);
    }
    #[test]
    fn marks_track_insertions_and_deletions() {
        let mut doc = Document::new("abcdef");
        doc.select(1, 4);
        doc.format(Style {
            italic: true,
            ..Style::default()
        });
        doc.replace(2..3, "XYZ");
        assert_eq!((doc.decorations[0].start, doc.decorations[0].end), (1, 6));
        doc.replace(0..8, "");
        assert!(doc.decorations.is_empty());
    }
}
