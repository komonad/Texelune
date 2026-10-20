use crate::document::{map_anchor, Change, Decoration};
use std::collections::VecDeque;

pub const HISTORY_LIMIT: usize = 4096;

#[derive(Clone, Copy)]
struct Edit {
    version: u64,
    start: usize,
    end: usize,
    inserted: usize,
}

impl Edit {
    fn map(&self, spans: &mut Vec<Decoration>) {
        for span in spans.iter_mut() {
            span.start = map_anchor(span.start, self.start..self.end, self.inserted, false);
            span.end = map_anchor(span.end, self.start..self.end, self.inserted, true);
        }
        spans.retain(|span| span.start < span.end);
    }
}

#[derive(Default)]
pub struct HighlightHistory {
    version: u64,
    source: Option<u64>,
    edits: VecDeque<Edit>,
}

impl HighlightHistory {
    pub fn advance(&mut self, change: &Change, spans: &mut Vec<Decoration>) {
        assert_eq!(change.version, self.version + 1);
        let edit = Edit {
            version: change.version,
            start: change.start,
            end: change.end,
            inserted: change.text.chars().count(),
        };
        edit.map(spans);
        self.version = edit.version;
        self.edits.push_back(edit);
        if self.edits.len() > HISTORY_LIMIT {
            self.edits.pop_front();
        }
    }

    pub fn accept(&mut self, source: u64, mut spans: Vec<Decoration>) -> Option<Vec<Decoration>> {
        if source > self.version
            || self.source.is_some_and(|accepted| source < accepted)
            || source < self.version.saturating_sub(self.edits.len() as u64)
        {
            return None;
        }
        for edit in self.edits.iter().filter(|edit| edit.version > source) {
            edit.map(&mut spans);
        }
        self.source = Some(source);
        Some(spans)
    }

    pub fn source_version(&self) -> Option<u64> {
        self.source
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Document, Style};

    fn spans() -> Vec<Decoration> {
        vec![
            Decoration {
                start: 0,
                end: 3,
                style: Style {
                    foreground: Some([1., 0., 0., 1.]),
                    ..Style::default()
                },
            },
            Decoration {
                start: 5,
                end: 9,
                style: Style {
                    italic: true,
                    ..Style::default()
                },
            },
        ]
    }

    #[test]
    fn delayed_batch_and_resident_styles_follow_the_same_edit_timeline() {
        let mut document = Document::new("foo 👩🏽‍💻 bar\nאבג");
        document.decorations = spans();
        let mut resident = spans();
        let mut history = HighlightHistory::default();
        history.accept(0, spans()).unwrap();
        let snapshot = document.text.clone();
        for (start, end, text) in [
            (0, 0, "// e\u{301}\n"),
            (8, 9, "שלום"),
            (3, 6, ""),
            (1, 4, "👨‍👩‍👧‍👦"),
        ] {
            let change = document.replace(start..end, text);
            history.advance(&change, &mut resident);
            assert_eq!(resident, document.decorations);
        }
        assert_eq!(snapshot.to_string(), "foo 👩🏽‍💻 bar\nאבג");
        assert_eq!(history.accept(0, spans()).unwrap(), resident);
        let latest = vec![Decoration {
            start: 0,
            end: 1,
            style: Style::default(),
        }];
        assert_eq!(
            history.accept(document.version, latest.clone()).unwrap(),
            latest
        );
        assert!(history.accept(0, spans()).is_none());
    }

    #[test]
    fn replacements_deletions_noop_formatting_and_undo_keep_anchor_affinity() {
        let mut document = Document::new("foo  bar!");
        document.decorations = spans();
        let mut history = HighlightHistory::default();
        let mut resident = spans();
        let first = document.replace(1..2, "XX");
        history.advance(&first, &mut resident);
        let undo = document.undo().unwrap();
        history.advance(&undo, &mut resident);
        assert_eq!(resident, spans());
        document.select(0, 3);
        let format = document.toggle("underline").unwrap();
        history.advance(&format, &mut resident);
        assert_eq!(history.accept(0, spans()).unwrap(), resident);
        let delete = document.replace(0..3, "");
        history.advance(&delete, &mut resident);
        assert_eq!(resident.len(), 1);
        assert_eq!(resident[0].start, 2);
    }

    #[test]
    fn expired_history_preserves_resident_styles_and_accepts_a_fresh_checkpoint() {
        let mut history = HighlightHistory::default();
        let mut document = Document::new("foo  bar!");
        let mut resident = spans();
        for _ in 0..=HISTORY_LIMIT {
            let change = document.replace(0..0, "x");
            history.advance(&change, &mut resident);
        }
        assert!(history.accept(0, spans()).is_none());
        assert_eq!(resident[0].start, 0);
        assert_eq!(resident[0].end, 3 + HISTORY_LIMIT + 1);
        assert_eq!(
            history.accept(document.version, resident.clone()).unwrap(),
            resident
        );
        assert!(history.accept(document.version + 1, vec![]).is_none());
    }
}
