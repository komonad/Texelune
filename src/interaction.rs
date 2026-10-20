use ropey::Rope;
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

pub fn line_range(text: &Rope, line: usize) -> Range<usize> {
    let line = line.min(text.len_lines() - 1);
    let start = text.line_to_char(line);
    start..start + text.line(line).len_chars()
}

pub fn word_range(text: &Rope, offset: usize, byte_limit: usize) -> Option<Range<usize>> {
    let offset = offset.min(text.len_chars());
    let line = text.char_to_line(offset);
    let source = text.line(line);
    if source.len_bytes() > byte_limit {
        return None;
    }
    let start = text.line_to_char(line);
    let source = source.to_string();
    let local = offset - start;
    let mut position = 0;
    let mut result = start..start;
    for unit in source.split_word_bounds() {
        let end = position + unit.chars().count();
        result = start + position..start + end;
        if local < end {
            return Some(result);
        }
        position = end;
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_line_ranges_include_terminators_and_trailing_empty_line() {
        let text = Rope::from_str("a\r\nאב\n");
        assert_eq!(line_range(&text, 0), 0..3);
        assert_eq!(line_range(&text, 1), 3..6);
        assert_eq!(line_range(&text, 9), 6..6);
    }

    #[test]
    fn word_selection_preserves_identifiers_graphemes_and_direction() {
        let text = Rope::from_str("foo_bar e\u{301} 👩🏽‍💻 שלום 中文\n");
        for expected in ["foo_bar", "e\u{301}", "👩🏽‍💻", "שלום"] {
            let source = text.to_string();
            let start = source[..source.find(expected).unwrap()].chars().count();
            for offset in start..start + expected.chars().count() {
                let range = word_range(&text, offset, usize::MAX).unwrap();
                assert_eq!(text.slice(range).to_string(), expected);
            }
        }
        assert_eq!(word_range(&text, 0, 4), None);
    }
}
