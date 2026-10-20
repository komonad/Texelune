use ropey::{Rope, RopeBuilder};

pub const BENCHMARK_ROW: &str =
    "let value = 144; // 中文 · abc אבג 123 · مرحبا · e\u{301} 👩🏽‍💻 🇨🇳 क्षि\n";

/// Deterministic UTF-8 fixtures can be reconstructed without retaining a second full source string.
pub struct SyntheticDocument {
    builder: RopeBuilder,
    target: usize,
    done: usize,
    pattern: &'static str,
}
impl SyntheticDocument {
    pub fn new(bytes: usize) -> Self {
        Self::with_code(bytes, false)
    }
    pub fn with_code(bytes: usize, code: bool) -> Self {
        Self {
            builder: RopeBuilder::new(),
            target: bytes,
            done: 0,
            pattern: if code {
                "const value = compute(144, 256) + payload.field; "
            } else {
                BENCHMARK_ROW
            },
        }
    }
    pub fn step(&mut self, budget: usize) -> bool {
        let remaining = self.target - self.done;
        let size = remaining.min(budget.clamp(self.pattern.len(), 256 * 1024));
        let count = size / self.pattern.len();
        let mut text = self.pattern.repeat(count);
        let rest = size - text.len();
        let mut end = rest;
        while !self.pattern.is_char_boundary(end) {
            end -= 1;
        }
        text.push_str(&self.pattern[..end]);
        text.extend(std::iter::repeat_n(' ', rest - end));
        self.builder.append(&text);
        self.done += size;
        self.done == self.target
    }
    pub fn bytes_done(&self) -> usize {
        self.done
    }
    pub fn finish(self) -> Result<Rope, &'static str> {
        if self.done != self.target {
            Err("import is incomplete")
        } else {
            Ok(self.builder.finish())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_size_utf8_and_repeatable_import() {
        let mut a = SyntheticDocument::new(1024 * 1024 + 7);
        while !a.step(64 * 1024) {}
        let first = a.finish().unwrap();
        assert_eq!(first.len_bytes(), 1024 * 1024 + 7);
        let mut b = SyntheticDocument::new(1024 * 1024 + 7);
        while !b.step(64 * 1024) {}
        assert_eq!(first, b.finish().unwrap());
    }
}
