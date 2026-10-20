use crate::document::{Document, Style};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Editor {
    inner: Document,
}

#[wasm_bindgen]
pub struct TextSnapshot {
    text: ropey::Rope,
}

#[wasm_bindgen]
impl TextSnapshot {
    pub fn offset_at(&self, line: usize, character: usize) -> usize {
        crate::document::offset_at(&self.text, line, character)
    }
}

#[wasm_bindgen]
impl Editor {
    pub fn snapshot(&self) -> TextSnapshot {
        TextSnapshot {
            text: self.inner.text.clone(),
        }
    }
    pub fn highlight_history_limit() -> usize {
        crate::highlights::HISTORY_LIMIT
    }
    pub fn map_anchor(position: usize, start: usize, end: usize, inserted: usize) -> usize {
        crate::document::map_anchor(position, start..end, inserted, true)
    }
    #[wasm_bindgen(constructor)]
    pub fn new(text: &str) -> Self {
        console_error_panic_hook::set_once();
        Self {
            inner: Document::new(text),
        }
    }
    pub fn selection(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.selection).unwrap()
    }
    pub fn version(&self) -> u64 {
        self.inner.version
    }
    pub fn position_at(&self, offset: usize) -> JsValue {
        let (line, character) = self.inner.position_at(offset);
        #[derive(serde::Serialize)]
        struct Position {
            line: usize,
            character: usize,
        }
        serde_wasm_bindgen::to_value(&Position { line, character }).unwrap()
    }
    pub fn offset_at(&self, line: usize, character: usize) -> usize {
        self.inner.offset_at(line, character)
    }
    pub fn length(&self) -> usize {
        self.inner.text.len_chars()
    }
    pub fn line_range(&self, line: usize) -> JsValue {
        let range = crate::interaction::line_range(&self.inner.text, line);
        serde_wasm_bindgen::to_value(&[range.start, range.end]).unwrap()
    }
    pub fn word_range(&self, offset: usize, exact: bool) -> JsValue {
        let range = crate::interaction::word_range(
            &self.inner.text,
            offset,
            if exact { usize::MAX } else { 4096 },
        )
        .map(|range| [range.start, range.end]);
        serde_wasm_bindgen::to_value(&range).unwrap()
    }
    pub fn lines(&self) -> usize {
        self.inner.text.len_lines()
    }
    pub fn bytes(&self) -> usize {
        self.inner.text.len_bytes()
    }
    pub fn slice(&self, start: usize, end: usize) -> String {
        self.inner.text.slice(start..end).to_string()
    }
    pub fn toggle(&mut self, attribute: &str) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.toggle(attribute)).unwrap()
    }
    pub fn select(&mut self, anchor: usize, head: usize) {
        self.inner.select(anchor, head);
    }
    pub fn selected_text(&self) -> String {
        self.inner
            .text
            .slice(self.inner.selection.range())
            .to_string()
    }
    pub fn begin_composition(&mut self) {
        self.inner.begin_group();
    }
    pub fn end_composition(&mut self) {
        self.inner.end_group();
    }
    pub fn text(&self) -> String {
        self.inner.text.to_string()
    }
    pub fn insert(&mut self, text: &str) -> JsValue {
        let range = self.inner.selection.range();
        serde_wasm_bindgen::to_value(&self.inner.replace(range, text)).unwrap()
    }
    pub fn replace(&mut self, start: usize, end: usize, text: &str) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.replace(start..end, text)).unwrap()
    }
    pub fn format(&mut self, style: JsValue) -> Result<JsValue, JsValue> {
        let style: Style = serde_wasm_bindgen::from_value(style)?;
        Ok(serde_wasm_bindgen::to_value(&self.inner.format(style))?)
    }
    pub fn undo(&mut self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.undo()).unwrap()
    }
    pub fn redo(&mut self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.redo()).unwrap()
    }
    pub fn delete(&mut self, forward: bool) -> JsValue {
        let mut range = self.inner.selection.range();
        if range.is_empty() {
            let Some(next) = self.inner.boundary_bounded(range.start, forward, 8) else {
                return JsValue::NULL;
            };
            range = next.min(range.start)..next.max(range.start);
        }
        serde_wasm_bindgen::to_value(&self.inner.replace(range, "")).unwrap()
    }
    pub fn deletion_range(&self, forward: bool) -> JsValue {
        let range = self.inner.selection.range();
        let range = if range.is_empty() {
            self.inner
                .boundary_bounded(range.start, forward, 8)
                .map(|next| [next.min(range.start), next.max(range.start)])
        } else {
            Some([range.start, range.end])
        };
        serde_wasm_bindgen::to_value(&range).unwrap()
    }
    pub fn boundary_exact(&self, position: usize, forward: bool) -> usize {
        self.inner.boundary(position, forward)
    }
    pub fn horizontal(&mut self, forward: bool, extend: bool) -> bool {
        let selection = self.inner.selection;
        let range = selection.range();
        let head = if !extend && !range.is_empty() {
            if forward {
                range.end
            } else {
                range.start
            }
        } else {
            let Some(p) = self.inner.boundary_bounded(selection.head, forward, 8) else {
                return false;
            };
            p
        };
        self.inner
            .select(if extend { selection.anchor } else { head }, head);
        true
    }
    pub fn line_edge(&mut self, end: bool, extend: bool) {
        let head = self.inner.selection.head;
        let target = self.inner.line_edge(head, end);
        self.inner.select(
            if extend {
                self.inner.selection.anchor
            } else {
                target
            },
            target,
        );
    }
}

#[wasm_bindgen]
pub struct DocumentImport {
    inner: Option<crate::import::SyntheticDocument>,
}
#[wasm_bindgen]
impl DocumentImport {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: usize, code: bool) -> Result<DocumentImport, JsValue> {
        if bytes > 512 * 1024 * 1024 {
            return Err(JsValue::from_str("fixture limit is 512 MiB"));
        }
        Ok(Self {
            inner: Some(crate::import::SyntheticDocument::with_code(bytes, code)),
        })
    }
    pub fn step(&mut self, budget: usize) -> bool {
        self.inner.as_mut().unwrap().step(budget)
    }
    pub fn bytes_done(&self) -> usize {
        self.inner.as_ref().unwrap().bytes_done()
    }
    pub fn finish_editor(self) -> Result<Editor, JsValue> {
        Ok(Editor {
            inner: Document::from_rope(self.into_rope()?),
        })
    }
}

#[wasm_bindgen]
pub struct VisualNavigation {
    map: crate::visual::NavigationMap,
}
#[wasm_bindgen]
impl VisualNavigation {
    pub fn from_packed(data: &[u32]) -> Result<Self, JsValue> {
        Ok(Self {
            map: crate::visual::NavigationMap::unpack(data).map_err(JsValue::from_str)?,
        })
    }
    pub fn hit_test(&self, x: f32, y: f32) -> Result<JsValue, JsValue> {
        Ok(serde_wasm_bindgen::to_value(&self.map.hit_test(x, y))?)
    }
    pub fn collapse(&self, anchor: usize, head: usize, right: bool) -> Result<JsValue, JsValue> {
        Ok(serde_wasm_bindgen::to_value(
            &self.map.collapse(anchor, head, right),
        )?)
    }
    #[wasm_bindgen(constructor)]
    pub fn new(value: JsValue) -> Result<Self, JsValue> {
        Ok(Self {
            map: serde_wasm_bindgen::from_value(value)?,
        })
    }
    pub fn resolve(&self, offset: usize, affinity: JsValue) -> Result<JsValue, JsValue> {
        let affinity: Option<crate::caret::Hit> = serde_wasm_bindgen::from_value(affinity)?;
        Ok(serde_wasm_bindgen::to_value(
            &self.map.resolve(offset, affinity.as_ref()),
        )?)
    }
    pub fn motion(
        &self,
        offset: usize,
        affinity: JsValue,
        command: &str,
        preferred_x: Option<f32>,
    ) -> Result<JsValue, JsValue> {
        let affinity: Option<crate::caret::Hit> = serde_wasm_bindgen::from_value(affinity)?;
        Ok(serde_wasm_bindgen::to_value(&self.map.motion(
            offset,
            affinity.as_ref(),
            command,
            preferred_x,
        ))?)
    }
}
impl DocumentImport {
    pub(crate) fn into_rope(mut self) -> Result<ropey::Rope, JsValue> {
        self.inner
            .take()
            .unwrap()
            .finish()
            .map_err(JsValue::from_str)
    }
}
