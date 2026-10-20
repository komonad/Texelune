use unicode_bidi::{BidiInfo, Level};

#[test]
fn unicode_16_bidi_character_conformance() {
    let mut cases = 0;
    for (line_number, line) in include_str!("data/BidiCharacterTest-16.0.0.txt")
        .lines()
        .enumerate()
    {
        let data = line.split('#').next().unwrap().trim();
        if data.is_empty() {
            continue;
        }
        let fields: Vec<_> = data.split(';').collect();
        let text: String = fields[0]
            .split_whitespace()
            .map(|c| char::from_u32(u32::from_str_radix(c, 16).unwrap()).unwrap())
            .collect();
        let direction = match fields[1] {
            "0" => Some(Level::ltr()),
            "1" => Some(Level::rtl()),
            _ => None,
        };
        let bidi = BidiInfo::new(&text, direction);
        let paragraph = &bidi.paragraphs[0];
        assert_eq!(
            paragraph.level.number(),
            fields[2].parse::<u8>().unwrap(),
            "paragraph line {}",
            line_number + 1
        );
        let expected_levels: Vec<_> = fields[3].split_whitespace().collect();
        let levels = bidi.reordered_levels_per_char(paragraph, 0..text.len());
        let mut filtered = Vec::new();
        let mut indices = Vec::new();
        for (i, (level, expected)) in levels.into_iter().zip(expected_levels).enumerate() {
            if expected == "x" {
                continue;
            }
            assert_eq!(
                level.number(),
                expected.parse::<u8>().unwrap(),
                "level line {} char {i}",
                line_number + 1
            );
            filtered.push(level);
            indices.push(i);
        }
        let order: Vec<_> = BidiInfo::reorder_visual(&filtered)
            .into_iter()
            .map(|i| indices[i])
            .collect();
        let expected: Vec<usize> = fields[4]
            .split_whitespace()
            .map(|i| i.parse().unwrap())
            .collect();
        assert_eq!(order, expected, "visual order line {}", line_number + 1);
        cases += 1;
    }
    assert!(cases > 90_000);
}
