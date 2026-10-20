use cosmic_text::{Attrs, Buffer, Family, FontSystem, Metrics, Shaping, Wrap};
use texelune_editor::caret::{caret_cells, DisplayCluster, GlyphBox};
use unicode_segmentation::UnicodeSegmentation;

fn fonts() -> FontSystem {
    let mut system = FontSystem::new();
    for name in [
        "JetBrainsMono-Regular",
        "JetBrainsMono-Italic",
        "NotoSansSC",
        "NotoSansHebrew",
        "NotoSansArabic",
        "NotoSansDevanagari",
        "NotoEmoji",
    ] {
        system.db_mut().load_font_data(
            std::fs::read(format!(
                "{}/packages/editor/fonts/{name}.ttf",
                env!("CARGO_MANIFEST_DIR")
            ))
            .unwrap(),
        );
    }
    system.db_mut().set_monospace_family("JetBrains Mono");
    system
}
#[test]
fn italic_themes_preserve_multiscript_font_fallback() {
    let mut system = fonts();
    for text in [
        "// 你好 · שלום · مرحبا · क्षि",
        "// emoji 👩🏽‍💻",
        "// ASCII comment",
    ] {
        let mut buffer = Buffer::new(&mut system, Metrics::new(17., 28.));
        buffer.set_size(&mut system, Some(800.), None);
        let style = if texelune_editor::theme::use_italic_face(text) {
            cosmic_text::Style::Italic
        } else {
            cosmic_text::Style::Normal
        };
        buffer.set_text(
            &mut system,
            text,
            &Attrs::new().family(Family::Monospace).style(style),
            Shaping::Advanced,
        );
        buffer.shape_until_scroll(&mut system, false);
        assert!(
            buffer
                .layout_runs()
                .flat_map(|run| run.glyphs)
                .all(|glyph| glyph.glyph_id != 0),
            "missing glyph in {text:?}"
        );
    }
}
fn shape(text: &str, width: f32, system: &mut FontSystem) -> (Vec<DisplayCluster>, Vec<GlyphBox>) {
    let mut offset = 0;
    let clusters = text
        .grapheme_indices(true)
        .map(|(byte, g)| {
            let start = offset;
            offset += g.chars().count();
            DisplayCluster {
                bytes: byte..byte + g.len(),
                document: start..offset,
            }
        })
        .collect();
    let mut buffer = Buffer::new(system, Metrics::new(17., 28.));
    buffer.set_size(system, Some(width), None);
    buffer.set_wrap(system, Wrap::WordOrGlyph);
    buffer.set_text(
        system,
        text,
        &Attrs::new().family(Family::Monospace),
        Shaping::Advanced,
    );
    buffer.shape_until_scroll(system, false);
    let glyphs = buffer
        .layout_runs()
        .flat_map(|run| {
            run.glyphs.iter().map(move |g| GlyphBox {
                start: g.start,
                end: g.end,
                x: g.x,
                y: run.line_top,
                width: g.w,
                rtl: g.level.is_rtl(),
            })
        })
        .collect();
    (clusters, glyphs)
}
#[test]
fn shaped_caret_stops_preserve_extended_graphemes_and_bidi() {
    let mut system = fonts();
    for text in [
        "a\u{301} 👩🏽‍💻 🇨🇳 1️⃣ क्षि",
        "abc אבג 123 مرحبا xyz",
        "A \u{2067}אבג \u{2066}Rust 144\u{2069} דהו\u{2069} Z",
    ] {
        for width in [80., 800.] {
            let (clusters, glyphs) = shape(text, width, &mut system);
            let (_, hits) = caret_cells(&clusters, &glyphs, 28.);
            assert!(!hits.is_empty());
            for hit in hits {
                assert!(
                    clusters
                        .iter()
                        .any(|g| g.document.start == hit.offset || g.document.end == hit.offset),
                    "interior caret in {text:?}"
                );
            }
        }
    }
    let (clusters, glyphs) = shape("אבג", 800., &mut system);
    let (_, hits) = caret_cells(&clusters, &glyphs, 28.);
    let first = hits.iter().find(|h| h.offset == 0).unwrap();
    let last = hits.iter().find(|h| h.offset == 3).unwrap();
    assert!(
        first.x > last.x,
        "RTL logical start lies to the right of logical end"
    );
}
