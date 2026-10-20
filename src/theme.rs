use serde::{Deserialize, Serialize};

/// Bundled script fallback faces have upright outlines; mixed runs use synthetic italic.
pub fn use_italic_face(text: &str) -> bool {
    text.is_ascii()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Theme {
    pub foreground: [f32; 4],
    pub background: [f32; 4],
    pub caret: [f32; 4],
    pub selection: [f32; 4],
    pub hint_foreground: [f32; 4],
    pub hint_background: [f32; 4],
    pub keyword: [f32; 4],
    pub string: [f32; 4],
    pub comment: [f32; 4],
    pub number: [f32; 4],
    pub type_name: [f32; 4],
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            foreground: [0.16, 0.18, 0.23, 1.],
            background: [1.; 4],
            caret: [0.16, 0.35, 0.80, 1.],
            selection: [0.76, 0.84, 0.98, 0.85],
            hint_foreground: [0.42, 0.45, 0.51, 1.],
            hint_background: [0.93, 0.94, 0.96, 1.],
            keyword: [0.48, 0.25, 0.68, 1.],
            string: [0.58, 0.32, 0.14, 1.],
            comment: [0.45, 0.48, 0.54, 1.],
            number: [0.10, 0.35, 0.72, 1.],
            type_name: [0.12, 0.33, 0.55, 1.],
        }
    }
}
