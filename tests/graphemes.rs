use texelune_editor::document::Document;

#[test]
fn unicode_17_extended_grapheme_conformance() {
    let fixture = include_str!("data/GraphemeBreakTest-17.0.0.txt");
    let mut cases = 0;
    for (line_number, line) in fixture.lines().enumerate() {
        let data = line.split('#').next().unwrap().trim();
        if data.is_empty() {
            continue;
        }
        let mut text = String::new();
        let mut expected = Vec::new();
        let mut count = 0;
        for token in data.split_whitespace() {
            match token {
                "÷" => expected.push(count),
                "×" => (),
                code => {
                    text.push(char::from_u32(u32::from_str_radix(code, 16).unwrap()).unwrap());
                    count += 1;
                }
            }
        }
        for padding in [0, 1023, 2047] {
            // A control separates the fixture from the padding's grapheme context.
            let prefix = format!("{}\n", "x".repeat(padding));
            let base = prefix.chars().count();
            let doc = Document::new(&format!("{prefix}{text}"));
            for pair in expected.windows(2) {
                assert_eq!(
                    doc.boundary(base + pair[0], true),
                    base + pair[1],
                    "forward case {} padding {padding}",
                    line_number + 1
                );
                assert_eq!(
                    doc.boundary(base + pair[1], false),
                    base + pair[0],
                    "backward case {} padding {padding}",
                    line_number + 1
                );
            }
        }
        cases += 1;
    }
    assert!(cases > 700);
}

#[test]
fn pathological_cluster_defers_without_splitting() {
    let text = format!("a{}z", "\u{301}".repeat(20_000));
    let doc = Document::new(&text);
    assert_eq!(doc.boundary_bounded(0, true, 8), None);
    assert_eq!(doc.boundary_bounded(20_001, false, 8), None);
    assert_eq!(doc.boundary(0, true), 20_001);
    assert_eq!(doc.boundary(20_001, false), 0);
}
