use std::collections::BTreeMap;
mod labels;

#[derive(Debug, Clone)]
struct Palette {
    name: String,
    colors: BTreeMap<String, String>,
}

impl Palette {
    fn new(name: &str) -> Self {
        Self { name: name.into(), colors: BTreeMap::new() }
    }

    fn insert(&mut self, token: &str, color: &str) {
        self.colors.insert(token.into(), color.into());
    }

    fn describe(&self) -> String {
        labels::describe(&self.name, self.colors.len())
    }
}

fn main() {
    // Unicode text stays in document coordinates: 你好 · שלום · 👩🏽‍💻
    let mut palette = Palette::new("Paper");
    palette.insert("keyword", "#8041ae");
    palette.insert("function", "#315eb6");
    let description = palette.describe();
    println!("{description}");
}
