use std::collections::BTreeMap;
mod labels;

#[derive(Debug, Clone)]
struct Palette {
    name: String,
    colors: BTreeMap<String, String>,
}

impl Palette {
    fn new(name: &str) -> Self {
        Self {
            name: name.into(),
            colors: BTreeMap::new(),
        }
    }

    fn insert(&mut self, token: &str, color: &str) {
        self.colors.insert(token.into(), color.into());
    }

    fn describe(&self) -> String {
        labels::describe(&self.name, self.colors.len())
    }
}

#[derive(Debug, Clone)]
struct TextRecord {
    id: u32,
    language: &'static str,
    text: &'static str,
    enabled: bool,
}

#[derive(Debug, Default)]
struct TextSummary {
    records: usize,
    scalars: usize,
    utf16: usize,
    bytes: usize,
    by_language: BTreeMap<&'static str, usize>,
}

impl TextSummary {
    fn add(&mut self, record: &TextRecord) {
        if !record.enabled {
            return;
        }
        self.records += 1;
        self.scalars += record.text.chars().count();
        self.utf16 += record.text.encode_utf16().count();
        self.bytes += record.text.len();
        *self.by_language.entry(record.language).or_default() += 1;
    }

    fn density(&self) -> f64 {
        if self.scalars == 0 {
            0.0
        } else {
            self.bytes as f64 / self.scalars as f64
        }
    }
}

#[derive(Default)]
struct PaletteCatalog {
    entries: BTreeMap<String, Palette>,
}

impl PaletteCatalog {
    fn register(&mut self, palette: Palette) {
        self.entries.insert(palette.name.clone(), palette);
    }

    fn find(&self, name: &str) -> Option<&Palette> {
        self.entries.get(name)
    }

    fn search(&self, prefix: &str) -> Vec<&Palette> {
        let query = prefix.to_lowercase();
        self.entries
            .values()
            .filter(|palette| palette.name.to_lowercase().starts_with(&query))
            .collect()
    }

    fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }
}

fn text_records() -> Vec<TextRecord> {
    vec![
        TextRecord {
            id: 1,
            language: "zh",
            text: "中文标点：『选区』、折行与字体回退。",
            enabled: true,
        },
        TextRecord {
            id: 2,
            language: "en",
            text: "Identifiers: palette_name, token_rules, RGB24.",
            enabled: true,
        },
        TextRecord {
            id: 3,
            language: "ar",
            text: "مرحبا بالعالم — العربية 123",
            enabled: true,
        },
        TextRecord {
            id: 4,
            language: "he",
            text: "שָׁלוֹם עוֹלָם — עברית 456",
            enabled: true,
        },
        TextRecord {
            id: 5,
            language: "hi",
            text: "नमस्ते दुनिया — क्षि क्‍ष",
            enabled: true,
        },
        TextRecord {
            id: 6,
            language: "ko",
            text: "한글과 한글",
            enabled: true,
        },
        TextRecord {
            id: 7,
            language: "ja",
            text: "日本語の句読点、改行と選択。",
            enabled: true,
        },
        TextRecord {
            id: 8,
            language: "emoji",
            text: "👩🏽‍💻 👨‍👩‍👧‍👦 🧑🏿‍🚀 🇭🇰 1️⃣",
            enabled: true,
        },
        TextRecord {
            id: 9,
            language: "combining",
            text: "e\u{301} a\u{310} o\u{308}\u{332} A\u{30a}",
            enabled: true,
        },
        TextRecord {
            id: 10,
            language: "bidi",
            text: "before \u{2067}العربية 123\u{2069} after",
            enabled: true,
        },
        TextRecord {
            id: 11,
            language: "bidi",
            text: "A \u{2067}אבג \u{2066}Rust 144\u{2069} דהו\u{2069} Z",
            enabled: true,
        },
        TextRecord {
            id: 12,
            language: "symbols",
            text: "∀x ∈ ℝ: x² ≥ 0; α → β; ∑ₙ aₙ",
            enabled: false,
        },
    ]
}

fn summarize(records: &[TextRecord]) -> TextSummary {
    let mut summary = TextSummary::default();
    for record in records {
        summary.add(record);
    }
    summary
}

fn group_by_language(records: &[TextRecord]) -> BTreeMap<&str, Vec<&TextRecord>> {
    let mut groups: BTreeMap<&str, Vec<&TextRecord>> = BTreeMap::new();
    for record in records {
        groups.entry(record.language).or_default().push(record);
    }
    groups
}

fn filter_records<'a>(records: &'a [TextRecord], query: &str) -> Vec<&'a TextRecord> {
    let query = query.to_lowercase();
    records
        .iter()
        .filter(|record| record.text.to_lowercase().contains(&query))
        .collect()
}

fn validate_color(color: &str) -> Result<(), &'static str> {
    if color.len() != 7 || !color.starts_with('#') {
        return Err("expected #RRGGBB");
    }
    if !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid hexadecimal digit");
    }
    Ok(())
}

fn format_summary(summary: &TextSummary) -> String {
    let languages = summary
        .by_language
        .iter()
        .map(|(language, count)| format!("{language}={count}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{} records / {} scalars / {} UTF-16 units\n{languages}",
        summary.records, summary.scalars, summary.utf16
    )
}

fn main() {
    // Unicode text stays in document coordinates: 你好 · שלום · 👩🏽‍💻
    let mut palette = Palette::new("Paper");
    palette.insert("keyword", "#8041ae");
    palette.insert("function", "#315eb6");
    let description = palette.describe();
    println!("{description}");
    let mut catalog = PaletteCatalog::default();
    catalog.register(palette);
    catalog.register(Palette::new("Dusk"));
    let records = text_records();
    let summary = summarize(&records);
    println!("{}", format_summary(&summary));
    println!("{:.2} bytes per scalar", summary.density());
    println!("{:?}", catalog.names().collect::<Vec<_>>());
    println!("{:?}", catalog.find("Paper"));
    println!("{:?}", catalog.search("Pa"));
    println!("{:?}", group_by_language(&records));
    println!("{:?}", filter_records(&records, "世界"));
    println!("{:?}", validate_color("#8041ae"));
    let enabled_ids: Vec<_> = records
        .iter()
        .filter(|record| record.enabled)
        .map(|record| record.id)
        .collect();
    println!("{enabled_ids:?}");
}
