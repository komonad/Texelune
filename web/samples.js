export const samples = {
welcome: `// Texelune · a Rust + WebGPU text playground
// Select text, apply a style, and keep writing.

use texelune::editor::{Document, Viewport};

pub struct TextEngine {
    document: Document,
    viewport: Viewport,
    frame_budget_ms: f64,
}

impl TextEngine {
    pub async fn render(&mut self) {
        let message = "Hello, 世界 · مرحبا · שלום";
        let target_hz = 144;

        // Layout lives in a worker. Input stays responsive.
        self.viewport.draw(message).await;
    }
}

// A document can mix scripts, styles, and virtual content.
// 中文自动折行。选择文字后，试试上方的粗体、斜体和背景色。
// Hints do not become part of the saved document.
`,
unicode: `Unicode / grapheme laboratory

Combining: é  a̐  ö̲  ñ  Å  क्‍ष  क्षि
Emoji ZWJ: 👩‍💻 👨‍👩‍👧‍👦 🧑🏽‍🚀 👩🏿‍❤️‍💋‍👩🏻
Flags: 🇨🇳 🇭🇰 🇺🇳 🇯🇵  Keycaps: 1️⃣ 2️⃣ #️⃣
Skin tone: 👍🏽 👋🏻 🙏🏿  Variation: ❤️ ♥︎ ✈️ ✈︎
Indic: नमस्ते दुनिया — हिन्दी और संस्कृत
Hangul Jamo: 한글  한글
中文：字体回退、自动换行、选区与输入法。

Try Backspace after a cluster. One grapheme is one deletion.
Use the arrow keys to move across visible caret stops.
Combining marks remain attached across rope storage chunks.

Soft wrapping is a view property. It never inserts newlines.
`,
bidi: `Bidirectional / visual caret laboratory

English + العربية + עברית + 中文
Hello مرحبا بالعالم — שלום עולם — 123 (456)
مرحبا بالعالم، هذا نص عربي مع English و 12345.
שלום עולם, טקסט עברי עם English ו־12345.

Mixed punctuation: abc (אבג 123) xyz [مرحبا 456].
Explicit isolates: before ⁧العربية 123⁩ after.
Nested direction: A ⁧אבג ⁦Rust 144⁩ דהו⁩ Z.
Arabic joining: لا لَا السَّلَامُ عَلَيْكُمْ
Hebrew marks: שָׁלוֹם עוֹלָם

ArrowLeft / ArrowRight follow visual caret positions.
Backspace / Delete remove logical grapheme clusters.
At a direction boundary, one text offset may have two visual positions.

Inline hints use FSI / PDI isolation in the display model.
Copying text preserves the underlying logical order.
`
};
