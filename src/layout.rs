use crate::caret::{caret_cells, Cell, DisplayCluster, GlyphBox, Hit};
use crate::visual::{NavigationMap, VisualRow};
use crate::{
    document::{Change, Decoration, Selection, Style},
    index::HeightIndex,
    scheduler::{Priority, Scheduler},
    syntax::{highlight, TokenKind},
};
use cosmic_text::{
    Attrs, Buffer, CacheKey, Color, Family, FontSystem, Metrics, Shaping, SwashCache, SwashContent,
    Weight, Wrap,
};
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use unicode_segmentation::UnicodeSegmentation;
use wasm_bindgen::prelude::*;

const LINE: f32 = 28.;
const FONT: f32 = 17.;
const LEFT: f32 = 66.;
const ATLAS: u32 = 2048;

#[derive(Clone, Serialize, Deserialize)]
pub struct Rect {
    pub bounds: [f32; 4],
    pub uv: [f32; 4],
    pub color: [f32; 4],
}
impl Rect {
    fn solid(x: f32, y: f32, w: f32, h: f32, color: [f32; 4]) -> Self {
        Self {
            bounds: [x, y, w, h],
            uv: [0.; 4],
            color,
        }
    }
}
#[derive(Serialize, Deserialize)]
pub struct Patch {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    pub data: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
pub struct LineLabel {
    pub line: usize,
    pub y: f32,
}
#[derive(Serialize, Deserialize)]
pub struct Frame {
    pub version: u64,
    pub request: u32,
    pub atlas_epoch: u32,
    #[serde(skip_serializing)]
    pub rects: Vec<Rect>,
    pub patches: Vec<Patch>,
    pub labels: Vec<LineLabel>,
    pub total_height: f64,
    pub scroll: f64,
    pub scroll_min: f64,
    pub scroll_max: f64,
    pub pending: usize,
    pub visible_ready: bool,
    pub quad_count: usize,
    pub layout_ms: f64,
    pub longest_job_ms: f64,
    pub cached_blocks: usize,
    #[serde(skip_serializing)]
    pub navigation: NavigationMap,
    pub raster_ms: f64,
    pub scene_ms: f64,
    pub document_bytes: usize,
    pub document_chars: usize,
    pub document_lines: usize,
    pub atlas_entries: usize,
    pub jobs_processed: usize,
    pub highlight_source_version: Option<u64>,
    pub highlight_spans: usize,
}
#[derive(Clone, Deserialize)]
pub struct Inlay {
    pub anchor: usize,
    pub text: String,
    pub block: bool,
}
#[derive(Deserialize)]
struct ViewportRequest {
    width: f32,
    height: f32,
    scale: f32,
    scroll: f64,
    wrap: bool,
    code: bool,
    request: u32,
    #[serde(default = "default_font_size")]
    font_size: f32,
}
fn default_font_size() -> f32 {
    FONT
}

struct Glyph {
    key: CacheKey,
    x: f32,
    y: f32,
    color: [f32; 4],
}
struct Block {
    glyphs: Vec<Glyph>,
    backgrounds: Vec<Rect>,
    hits: Vec<Hit>,
    height: f32,
    cells: Vec<Cell>,
    rows: Vec<VisualRow>,
    fast_window: Option<(usize, usize)>,
    char_window: Option<std::ops::Range<usize>>,
}
impl Block {
    fn new() -> Self {
        Self {
            glyphs: vec![],
            backgrounds: vec![],
            hits: vec![],
            cells: vec![],
            height: 0.,
            rows: vec![],
            fast_window: None,
            char_window: None,
        }
    }
}
#[derive(Clone, Copy)]
struct Slot {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    left: i32,
    top: i32,
    color: bool,
}

#[wasm_bindgen]
pub struct LayoutEngine {
    theme: crate::theme::Theme,
    text: Rope,
    version: u64,
    marks: Vec<Decoration>,
    external: Vec<Decoration>,
    highlight_history: crate::highlights::HighlightHistory,
    external_index: Vec<usize>,
    external_ends: Vec<usize>,
    inlays: Vec<Inlay>,
    fonts: FontSystem,
    swash: SwashCache,
    blocks: HashMap<usize, Block>,
    heights: HeightIndex,
    jobs: Scheduler,
    slots: HashMap<CacheKey, Option<Slot>>,
    atlas_x: u32,
    atlas_y: u32,
    row: u32,
    epoch: u32,
    width: f32,
    height: f32,
    scale: f32,
    wrap: bool,
    code: bool,
    scroll: f64,
    request: u32,
    longest: f64,
    reveal: Option<usize>,
    reveal_affinity: Option<Hit>,
    raster_ms: f64,
    font_size: f32,
    line_height: f32,
    fast_eligible: HashMap<usize, bool>,
    mono_advance: Option<f32>,
    instances: Vec<f32>,
    packed_navigation: Vec<u32>,
    jobs_processed: usize,
}

fn now() -> f64 {
    js_sys::global()
        .unchecked_into::<web_sys::Window>()
        .performance()
        .unwrap()
        .now()
}

fn push_span(
    spans: &mut Vec<(std::ops::Range<usize>, Style)>,
    range: std::ops::Range<usize>,
    style: Style,
) {
    if let Some((last, previous)) = spans.last_mut() {
        if *previous == style && last.end == range.start {
            last.end = range.end;
            return;
        }
    }
    spans.push((range, style));
}

#[wasm_bindgen]
impl LayoutEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        let mut fonts = FontSystem::new();
        fonts.db_mut().set_monospace_family("JetBrains Mono");
        Self {
            theme: crate::theme::Theme::default(),
            text: Rope::new(),
            version: 0,
            marks: vec![],
            external: vec![],
            highlight_history: crate::highlights::HighlightHistory::default(),
            external_index: vec![],
            external_ends: vec![],
            inlays: vec![],
            fonts,
            swash: SwashCache::new(),
            blocks: HashMap::new(),
            heights: HeightIndex::new(1, LINE as f64),
            jobs: Scheduler::default(),
            slots: HashMap::new(),
            atlas_x: 1,
            atlas_y: 1,
            row: 0,
            epoch: 0,
            width: 800.,
            height: 600.,
            scale: 1.,
            wrap: true,
            code: true,
            scroll: 0.,
            request: 0,
            longest: 0.,
            reveal: None,
            reveal_affinity: None,
            raster_ms: 0.,
            font_size: FONT,
            line_height: LINE,
            fast_eligible: HashMap::new(),
            mono_advance: None,
            instances: Vec::new(),
            packed_navigation: Vec::new(),
            jobs_processed: 0,
        }
    }
    pub fn font(&mut self, bytes: Vec<u8>) {
        self.fonts.db_mut().load_font_data(bytes);
        self.clear_layout();
        self.mono_advance = None;
    }
    pub fn theme(&mut self, value: JsValue) -> Result<(), JsValue> {
        self.theme = serde_wasm_bindgen::from_value(value)?;
        self.clear_layout();
        self.schedule();
        Ok(())
    }
    pub fn load(&mut self, text: &str) {
        self.fast_eligible.clear();
        self.text = Rope::from_str(text);
        self.version = 0;
        self.marks.clear();
        self.external.clear();
        self.highlight_history = crate::highlights::HighlightHistory::default();
        self.external_index.clear();
        self.external_ends.clear();
        self.inlays.clear();
        self.scroll = 0.;
        self.reveal = None;
        self.heights = HeightIndex::new(self.text.len_lines(), self.line_height as f64);
        self.clear_layout();
    }
    pub fn install_import(
        &mut self,
        import: crate::browser::DocumentImport,
    ) -> Result<(), JsValue> {
        self.fast_eligible.clear();
        self.text = import.into_rope()?;
        self.version = 0;
        self.marks.clear();
        self.external.clear();
        self.highlight_history = crate::highlights::HighlightHistory::default();
        self.external_index.clear();
        self.external_ends.clear();
        self.inlays.clear();
        self.scroll = 0.;
        self.reveal = None;
        self.reveal_affinity = None;
        self.heights = HeightIndex::new(self.text.len_lines(), self.line_height as f64);
        self.clear_layout();
        Ok(())
    }
    pub fn apply(&mut self, value: JsValue) -> Result<(), JsValue> {
        let change: Change = serde_wasm_bindgen::from_value(value)?;
        if change.version != self.version + 1 {
            return Err(JsValue::from_str("document version gap"));
        }
        let old_lines = self.text.len_lines();
        let inserted = change.text.chars().count();
        let first = self.text.char_to_line(change.start);
        let last = self.text.char_to_line(change.end);
        let affected_height = self.heights.prefix(last + 1) - self.heights.prefix(first);
        let affected_chars = self.text.line_to_char(last) + self.text.line(last).len_chars()
            - self.text.line_to_char(first);
        self.text.remove(change.start..change.end);
        self.text.insert(change.start, &change.text);
        for inlay in &mut self.inlays {
            inlay.anchor =
                crate::document::map_anchor(inlay.anchor, change.start..change.end, inserted, true);
        }
        let format_changed = self.marks != change.decorations;
        self.highlight_history.advance(&change, &mut self.external);
        self.marks = change.decorations;
        self.version = change.version;
        self.index_highlights();
        if old_lines != self.text.len_lines() {
            self.fast_eligible.clear();
        } else if !change
            .text
            .bytes()
            .all(|b| b == b'\n' || b == b'\r' || (32..=126).contains(&b))
        {
            for i in first..=last {
                self.fast_eligible.remove(&i);
            }
        } else {
            for i in first..=last {
                if self.fast_eligible.get(&i) == Some(&false) {
                    self.fast_eligible.remove(&i);
                }
            }
        }
        if old_lines != self.text.len_lines() {
            let count = self.text.len_lines() + last - first + 1 - old_lines;
            let row = self.line_height as f64;
            let density = affected_height / affected_chars.max(1) as f64;
            let estimates = self
                .text
                .lines_at(first)
                .take(count)
                .map(|line| ((line.len_chars() as f64 * density / row).ceil() * row).max(row));
            self.heights.splice(first..last + 1, estimates);
            self.clear_layout();
        } else if format_changed {
            self.clear_layout();
        } else {
            for line in first..=last {
                self.blocks.remove(&line);
            }
            for (line, block) in &mut self.blocks {
                if *line <= last {
                    continue;
                }
                let shift = |offset: usize| offset - (change.end - change.start) + inserted;
                for cell in &mut block.cells {
                    cell.start = shift(cell.start);
                    cell.end = shift(cell.end);
                }
                for hit in &mut block.hits {
                    hit.offset = shift(hit.offset);
                    hit.cluster = shift(hit.cluster);
                }
                if let Some(range) = &mut block.char_window {
                    range.start = shift(range.start);
                    range.end = shift(range.end);
                }
            }
        }
        self.reveal = Some(change.selection.head);
        self.reveal_affinity = None;
        self.schedule();
        Ok(())
    }
    pub fn inlays(&mut self, value: JsValue) -> Result<(), JsValue> {
        self.inlays = serde_wasm_bindgen::from_value(value)?;
        self.clear_layout();
        self.schedule();
        Ok(())
    }
    pub fn highlights(&mut self, version: u64, value: JsValue) -> Result<bool, JsValue> {
        let spans = serde_wasm_bindgen::from_value(value)?;
        let Some(mapped) = self.highlight_history.accept(version, spans) else {
            return Ok(false);
        };
        self.external = mapped;
        self.index_highlights();
        self.clear_layout();
        self.schedule();
        Ok(true)
    }
    pub fn viewport(&mut self, value: JsValue) -> Result<(), JsValue> {
        let ViewportRequest {
            width,
            height,
            scale,
            scroll,
            wrap,
            code,
            request,
            font_size,
        } = serde_wasm_bindgen::from_value(value)?;
        if self.width != width
            || self.scale != scale
            || self.wrap != wrap
            || self.code != code
            || self.font_size != font_size
        {
            self.width = width;
            self.scale = scale.clamp(1., 3.);
            self.wrap = wrap;
            self.code = code;
            self.font_size = font_size.clamp(10., 40.);
            self.line_height = self.font_size * 28. / 17.;
            self.mono_advance = None;
            self.clear_layout();
        }
        self.height = height;
        self.scroll = scroll.max(0.);
        self.request = request;
        self.schedule();
        Ok(())
    }
    pub fn pending(&self) -> usize {
        self.jobs.pending()
    }
    pub fn instances(&self) -> Vec<f32> {
        self.instances.clone()
    }
    pub fn navigation(&self) -> Vec<u32> {
        self.packed_navigation.clone()
    }
    pub fn visible_ready(&self) -> bool {
        let first = self.heights.locate(self.scroll);
        let last = self.heights.locate(self.scroll + self.height as f64);
        (first..=last).all(|line| self.block_ready(line))
            && self
                .reveal
                .is_none_or(|offset| self.block_ready(self.text.char_to_line(offset)))
    }
    pub fn reveal(&mut self, offset: usize) {
        self.reveal = Some(offset.min(self.text.len_chars()));
        self.reveal_affinity = None;
        self.schedule();
    }
    pub fn reveal_caret(&mut self, offset: usize, affinity: JsValue) -> Result<(), JsValue> {
        self.reveal(offset);
        self.reveal_affinity = serde_wasm_bindgen::from_value(affinity)?;
        Ok(())
    }
    pub fn navigate(&mut self, value: JsValue) -> Result<JsValue, JsValue> {
        #[derive(Deserialize)]
        struct Request {
            offset: usize,
            affinity: Option<Hit>,
            command: String,
            preferred_x: Option<f32>,
        }
        let request: Request = serde_wasm_bindgen::from_value(value)?;
        let line = self
            .text
            .char_to_line(request.offset.min(self.text.len_chars()));
        let first = line.saturating_sub(1);
        let last = (line + 1).min(self.text.len_lines() - 1);
        if !self.wrap
            && self
                .blocks
                .get(&line)
                .and_then(|b| b.char_window.as_ref())
                .is_some_and(|r| request.offset <= r.start || request.offset >= r.end)
        {
            self.blocks.remove(&line);
            self.reveal = Some(request.offset);
        }
        for i in first..=last {
            self.shape_paragraph(i);
        }
        let map = self.navigation_map(first, last, f32::NEG_INFINITY, f32::INFINITY);
        Ok(serde_wasm_bindgen::to_value(&map.motion(
            request.offset,
            request.affinity.as_ref(),
            &request.command,
            request.preferred_x,
        ))?)
    }
    pub fn tick(&mut self, budget_ms: f64) -> f64 {
        let start = now();
        self.jobs_processed = 0;
        while now() - start < budget_ms.clamp(0.1, 4.) {
            let Some(line) = self.jobs.next_job() else {
                break;
            };
            if self.block_ready(line) {
                continue;
            }
            let begin = now();
            self.shape_paragraph(line);
            self.jobs_processed += 1;
            self.longest = self.longest.max(now() - begin);
        }
        now() - start
    }
    pub fn frame(&mut self, selection: JsValue, layout_ms: f64) -> Result<JsValue, JsValue> {
        let selection: Selection = serde_wasm_bindgen::from_value(selection)?;
        let frame = self.build_frame(selection, layout_ms);
        Ok(serde_wasm_bindgen::to_value(&frame)?)
    }
}

impl LayoutEngine {
    fn index_highlights(&mut self) {
        self.external_index = (0..self.external.len()).collect();
        self.external_index.sort_by_key(|i| self.external[*i].start);
        let mut end = 0;
        self.external_ends = self
            .external_index
            .iter()
            .map(|i| {
                end = end.max(self.external[*i].end);
                end
            })
            .collect();
    }
    fn clear_layout(&mut self) {
        self.blocks.clear();
        // Measured heights remain estimates until replacement blocks are ready.
        // Resetting them changes the document position represented by scroll.
        self.jobs.invalidate();
    }
    fn schedule(&mut self) {
        self.jobs.invalidate();
        let first = self.heights.locate(self.scroll);
        let last = self.heights.locate(self.scroll + self.height as f64 + 500.);
        let visible_last = self.heights.locate(self.scroll + self.height as f64);
        // Keep the working set bounded independently of document length.
        if self.blocks.len() > 320 {
            self.blocks
                .retain(|line, _| *line + 80 >= first && *line <= last + 80);
        }
        for line in first.saturating_sub(8)..=(last + 8).min(self.text.len_lines() - 1) {
            if !self.block_ready(line) {
                self.jobs.enqueue(
                    line,
                    if line >= first && line <= visible_last {
                        Priority::Viewport
                    } else {
                        Priority::Prefetch
                    },
                );
            }
        }
        if let Some(offset) = self.reveal {
            let line = self.text.char_to_line(offset);
            if !self.block_ready(line) {
                self.jobs.enqueue(line, Priority::Input);
            }
        }
    }
    fn block_ready(&self, line: usize) -> bool {
        let Some(block) = self.blocks.get(&line) else {
            return false;
        };
        if let Some(range) = &block.char_window {
            if let Some(offset) = self.reveal {
                if self.text.char_to_line(offset) == line
                    && (offset < range.start
                        || offset > range.end
                        || (offset - range.start) as f32
                            * self.mono_advance.unwrap_or(self.font_size * 0.6)
                            > (self.width - LEFT - 28.).max(40.))
                {
                    return false;
                }
            }
        }
        if let Some((first, end)) = block.fast_window {
            let row = (((self.scroll - self.heights.prefix(line) - 16.).max(0.)
                / self.line_height as f64)
                .floor() as usize)
                .min((block.height / self.line_height).ceil() as usize - 1);
            let last = (row + (self.height / self.line_height).ceil() as usize + 1)
                .min((block.height / self.line_height).ceil() as usize);
            first <= row && end >= last
        } else {
            true
        }
    }
    fn measure_mono(&mut self) -> f32 {
        if let Some(width) = self.mono_advance {
            return width;
        }
        let mut buffer = Buffer::new(
            &mut self.fonts,
            Metrics::new(self.font_size, self.line_height),
        );
        buffer.set_text(
            &mut self.fonts,
            "M",
            &Attrs::new().family(Family::Monospace),
            Shaping::Basic,
        );
        buffer.shape_until_scroll(&mut self.fonts, false);
        let width = buffer
            .layout_runs()
            .next()
            .and_then(|r| r.glyphs.first())
            .map(|g| g.w)
            .unwrap_or(self.font_size * 0.6)
            .max(1.);
        self.mono_advance = Some(width);
        width
    }
    fn shape_paragraph(&mut self, line: usize) {
        if self.block_ready(line) {
            return;
        }
        self.blocks.remove(&line);
        let advance = self.measure_mono();
        let mut block = Block::new();
        let source = self.text.line(line);
        let start = self.text.line_to_char(line);
        let eligible = source.len_chars() > 8192
            && !self
                .inlays
                .iter()
                .any(|i| i.anchor >= start && i.anchor <= start + source.len_chars())
            && *self.fast_eligible.entry(line).or_insert_with(|| {
                source.chunks().all(|c| {
                    c.bytes()
                        .all(|b| b == b'\n' || b == b'\r' || (32..=126).contains(&b))
                })
            });
        let content_len = source.len_chars()
            - if source.len_chars() > 1
                && source.char(source.len_chars() - 2) == '\r'
                && source.char(source.len_chars() - 1) == '\n'
            {
                2
            } else if source.len_chars() > 0
                && matches!(source.char(source.len_chars() - 1), '\r' | '\n')
            {
                1
            } else {
                0
            };
        if eligible && self.wrap {
            if let Some(offset) = self
                .reveal
                .filter(|o| *o >= start && *o <= start + content_len)
            {
                let columns =
                    (((self.width - LEFT - 28.).max(40.) / advance).floor() as usize).max(1);
                let row = (offset - start).min(content_len.saturating_sub(1)) / columns;
                let y = self.heights.prefix(line) + row as f64 * self.line_height as f64 + 16.;
                if y < self.scroll {
                    self.scroll = (y - 16.).max(0.);
                } else if y + self.line_height as f64 > self.scroll + self.height as f64 {
                    self.scroll = y + self.line_height as f64 - self.height as f64 + 16.;
                }
            }
        }
        let plan = eligible.then(|| {
            if self.wrap {
                crate::fast_layout::MonoWindow::new(
                    content_len,
                    advance,
                    (self.width - LEFT - 28.).max(40.),
                    self.line_height,
                    self.height,
                    self.scroll - self.heights.prefix(line) - 16.,
                )
            } else {
                crate::fast_layout::MonoWindow::unwrapped(
                    content_len,
                    (((self.width - LEFT - 28.).max(40.) / advance).floor() as usize).max(1),
                    self.reveal
                        .filter(|o| *o >= start && *o <= start + content_len)
                        .map(|o| o - start)
                        .unwrap_or(0),
                )
            }
        });
        // The shaping worker is the cancellation boundary for paragraph-wide algorithms.
        // Paragraph context must survive soft wrapping and storage chunk boundaries.
        let raw = if let Some(plan) = &plan {
            source.slice(plan.first_char..plan.end_char).to_string()
        } else {
            source.to_string()
        };
        let raw = raw.trim_end_matches([
            '\r', '\n', '\u{b}', '\u{c}', '\u{85}', '\u{2028}', '\u{2029}',
        ]);
        let base = start + plan.as_ref().map(|p| p.first_char).unwrap_or(0);
        if let Some(plan) = &plan {
            block.height = plan.first_row as f32 * self.line_height;
            block.fast_window = Some((plan.first_row, plan.end_row));
            if !self.wrap {
                block.char_window = Some(start + plan.first_char..start + plan.end_char);
            }
        }
        let tokens = if self.code { highlight(raw) } else { vec![] };
        let span_end = base + raw.chars().count();
        let first_mark = self.external_ends.partition_point(|end| *end <= base);
        let last_mark = self
            .external_index
            .partition_point(|i| self.external[*i].start < span_end);
        let mut mark_indices = self.external_index[first_mark.min(last_mark)..last_mark].to_vec();
        // Input order defines precedence when external decorations overlap.
        mark_indices.sort_unstable();
        let marks: Vec<_> = mark_indices
            .iter()
            .map(|i| &self.external[*i])
            .chain(self.marks.iter())
            .filter(|mark| mark.start < span_end && mark.end > base)
            .collect();
        let mut display = String::new();
        let mut spans: Vec<(std::ops::Range<usize>, Style)> = vec![];
        let mut clusters = Vec::new();
        let mut position = base;
        let mut local_byte = 0;
        for grapheme in raw.graphemes(true) {
            for inlay in self
                .inlays
                .iter()
                .filter(|i| !i.block && i.anchor == position)
            {
                let start = display.len();
                display.push('\u{2068}');
                display.push_str(&inlay.text);
                display.push('\u{2069}');
                push_span(
                    &mut spans,
                    start..display.len(),
                    Style {
                        foreground: Some(self.theme.hint_foreground),
                        background: Some(self.theme.hint_background),
                        ..Style::default()
                    },
                );
            }
            let mut style = Style::default();
            if let Some(token) = tokens
                .get(tokens.partition_point(|t| t.range.end <= local_byte))
                .filter(|t| t.range.contains(&local_byte))
            {
                style.foreground = Some(match token.kind {
                    TokenKind::Keyword => self.theme.keyword,
                    TokenKind::String => self.theme.string,
                    TokenKind::Comment => self.theme.comment,
                    TokenKind::Number => self.theme.number,
                    TokenKind::Type => self.theme.type_name,
                });
            }
            for mark in marks
                .iter()
                .filter(|m| m.start <= position && m.end > position)
            {
                style.bold |= mark.style.bold;
                style.italic |= mark.style.italic;
                style.underline |= mark.style.underline;
                if mark.style.foreground.is_some() {
                    style.foreground = mark.style.foreground;
                }
                if mark.style.background.is_some() {
                    style.background = mark.style.background;
                }
            }
            let start = display.len();
            display.push_str(grapheme);
            clusters.push(DisplayCluster {
                bytes: start..display.len(),
                document: position..position + grapheme.chars().count(),
            });
            push_span(&mut spans, start..display.len(), style);
            position += grapheme.chars().count();
            local_byte += grapheme.len();
        }
        for inlay in self
            .inlays
            .iter()
            .filter(|i| !i.block && i.anchor == position)
        {
            let start = display.len();
            display.push('\u{2068}');
            display.push_str(&inlay.text);
            display.push('\u{2069}');
            push_span(
                &mut spans,
                start..display.len(),
                Style {
                    foreground: Some(self.theme.hint_foreground),
                    background: Some(self.theme.hint_background),
                    ..Style::default()
                },
            );
        }
        let mut buffer = Buffer::new(
            &mut self.fonts,
            Metrics::new(self.font_size, self.line_height),
        );
        buffer.set_size(
            &mut self.fonts,
            Some(
                plan.as_ref()
                    .map(|p| p.columns as f32 * advance + 0.01)
                    .unwrap_or((self.width - LEFT - 28.).max(40.)),
            ),
            None,
        );
        buffer.set_wrap(
            &mut self.fonts,
            if self.wrap {
                if eligible || self.code {
                    Wrap::Glyph
                } else {
                    Wrap::WordOrGlyph
                }
            } else {
                Wrap::None
            },
        );
        let attrs = Attrs::new().family(Family::Monospace);
        buffer.set_rich_text(
            &mut self.fonts,
            spans.iter().enumerate().map(|(i, (range, style))| {
                (
                    &display[range.clone()],
                    attrs
                        .clone()
                        .weight(if style.bold {
                            Weight::BOLD
                        } else {
                            Weight::NORMAL
                        })
                        .style(
                            if style.italic
                                && crate::theme::use_italic_face(&display[range.clone()])
                            {
                                cosmic_text::Style::Italic
                            } else {
                                cosmic_text::Style::Normal
                            },
                        )
                        .metadata(i),
                )
            }),
            &attrs,
            if eligible {
                Shaping::Basic
            } else {
                Shaping::Advanced
            },
            None,
        );
        buffer.shape_until_scroll(&mut self.fonts, false);
        let mut height = self.line_height;
        let mut glyph_boxes = Vec::new();
        for run in buffer.layout_runs() {
            let y = block.height + run.line_top;
            block.rows.push(VisualRow {
                y,
                h: run.line_height,
                rtl: run.rtl,
            });
            height = height.max(run.line_top + run.line_height);
            for glyph in run.glyphs {
                let style = spans.get(glyph.metadata).map(|s| s.1).unwrap_or_default();
                if let Some(color) = style.background {
                    block.backgrounds.push(Rect::solid(
                        LEFT + glyph.x,
                        y,
                        glyph.w,
                        self.line_height,
                        color,
                    ));
                }
                if style.underline && glyph.w > 0. {
                    block.backgrounds.push(Rect::solid(
                        LEFT + glyph.x,
                        block.height + run.line_y + 2.,
                        glyph.w,
                        1.25,
                        style.foreground.unwrap_or(self.theme.foreground),
                    ));
                }
                let mut physical = glyph.physical((LEFT * self.scale, 0.), self.scale);
                if style.italic
                    && self
                        .fonts
                        .db()
                        .face(glyph.font_id)
                        .is_some_and(|face| face.style != cosmic_text::Style::Italic)
                {
                    physical.cache_key.flags |= cosmic_text::CacheKeyFlags::FAKE_ITALIC;
                }
                block.glyphs.push(Glyph {
                    key: physical.cache_key,
                    x: physical.x as f32 / self.scale,
                    y: block.height + run.line_y + physical.y as f32 / self.scale,
                    color: style.foreground.unwrap_or(self.theme.foreground),
                });
                glyph_boxes.push(GlyphBox {
                    start: glyph.start,
                    end: glyph.end,
                    x: LEFT + glyph.x,
                    y,
                    width: glyph.w,
                    rtl: glyph.level.is_rtl(),
                });
            }
        }
        let (cells, hits) = caret_cells(&clusters, &glyph_boxes, self.line_height);
        block.cells.extend(cells);
        block.hits.extend(hits);
        if raw.is_empty() {
            block.hits.push(Hit {
                x: LEFT,
                y: block.height,
                h: self.line_height,
                offset: base,
                cluster: base,
                trailing: false,
            });
        }
        block.height += height;
        if let Some(plan) = &plan {
            block.height = plan.total_rows as f32 * self.line_height;
        }
        for inlay in self
            .inlays
            .iter()
            .filter(|i| i.block && i.anchor >= self.text.line_to_char(line) && i.anchor <= position)
        {
            block.backgrounds.push(Rect::solid(
                LEFT,
                block.height + 4.,
                (self.width - LEFT - 28.).max(40.),
                44.,
                self.theme.hint_background,
            ));
            let mut hint = Buffer::new(&mut self.fonts, Metrics::new(14., 22.));
            hint.set_size(
                &mut self.fonts,
                Some((self.width - LEFT - 48.).max(40.)),
                Some(44.),
            );
            hint.set_text(
                &mut self.fonts,
                &inlay.text,
                &Attrs::new()
                    .family(Family::Monospace)
                    .color(Color::rgb(51, 92, 156)),
                Shaping::Advanced,
            );
            hint.shape_until_scroll(&mut self.fonts, false);
            for run in hint.layout_runs() {
                for glyph in run.glyphs {
                    let p = glyph.physical(((LEFT + 12.) * self.scale, 0.), self.scale);
                    block.glyphs.push(Glyph {
                        key: p.cache_key,
                        x: p.x as f32 / self.scale,
                        y: block.height + 12. + run.line_y + p.y as f32 / self.scale,
                        color: self.theme.hint_foreground,
                    });
                }
            }
            block.height += 56.;
        }
        let old_height = self.heights.prefix(line + 1) - self.heights.prefix(line);
        let measured = block.height.max(self.line_height) as f64;
        let anchor = self.heights.locate(self.scroll);
        self.heights.set(line, measured);
        if line < anchor {
            self.scroll += measured - old_height;
        }
        self.blocks.insert(line, block);
    }
    fn slot(&mut self, key: CacheKey, patches: &mut Vec<Patch>) -> Option<Slot> {
        if let Some(slot) = self.slots.get(&key) {
            return *slot;
        }
        let raster_start = now();
        let image = self.swash.get_image_uncached(&mut self.fonts, key);
        self.raster_ms += now() - raster_start;
        let Some(image) = image else {
            self.slots.insert(key, None);
            return None;
        };
        let p = image.placement;
        if p.width == 0 || p.height == 0 || p.width >= ATLAS || p.height >= ATLAS {
            self.slots.insert(key, None);
            return None;
        }
        if self.atlas_x + p.width + 1 > ATLAS {
            self.atlas_x = 1;
            self.atlas_y += self.row + 1;
            self.row = 0;
        }
        if self.atlas_y + p.height + 1 > ATLAS {
            return None;
        }
        let slot = Slot {
            x: self.atlas_x,
            y: self.atlas_y,
            w: p.width,
            h: p.height,
            left: p.left,
            top: p.top,
            color: image.content == SwashContent::Color,
        };
        self.atlas_x += p.width + 1;
        self.row = self.row.max(p.height);
        let data = match image.content {
            SwashContent::Color => image.data,
            SwashContent::Mask => image
                .data
                .into_iter()
                .flat_map(|a| [255, 255, 255, a])
                .collect(),
            SwashContent::SubpixelMask => image
                .data
                .chunks(4)
                .flat_map(|p| [255, 255, 255, p[0]])
                .collect(),
        };
        patches.push(Patch {
            x: slot.x,
            y: slot.y,
            w: slot.w,
            h: slot.h,
            data,
        });
        self.slots.insert(key, Some(slot));
        Some(slot)
    }
    fn build_frame(&mut self, selection: Selection, layout_ms: f64) -> Frame {
        let scene_start = now();
        self.raster_ms = 0.;
        if let Some(offset) = self.reveal {
            let line = self.text.char_to_line(offset);
            if let Some(block) = self.blocks.get(&line) {
                let hit = self
                    .reveal_affinity
                    .as_ref()
                    .and_then(|a| {
                        block.hits.iter().find(|h| {
                            h.offset == offset && h.cluster == a.cluster && h.trailing == a.trailing
                        })
                    })
                    .or_else(|| block.hits.iter().find(|h| h.offset == offset));
                if let Some(hit) = hit {
                    let y = self.heights.prefix(line) + hit.y as f64 + 16.;
                    if y < self.scroll {
                        self.scroll = (y - 16.).max(0.);
                    } else if y + self.line_height as f64 > self.scroll + self.height as f64 {
                        self.scroll = y + self.line_height as f64 - self.height as f64 + 16.;
                    }
                    self.reveal = None;
                    self.reveal_affinity = None;
                }
            }
        }
        // Reset before encoding the frame so every UV in a frame belongs to one atlas generation.
        self.scroll = self.scroll.clamp(
            0.,
            (self.heights.total() + 32. - self.height as f64).max(0.),
        );
        if !self.visible_ready() {
            self.schedule();
        }
        if self.atlas_y + 160 > ATLAS {
            self.slots.clear();
            self.atlas_x = 1;
            self.atlas_y = 1;
            self.row = 0;
            self.epoch += 1;
        }
        let mut frame = Frame {
            version: self.version,
            request: self.request,
            atlas_epoch: self.epoch,
            rects: vec![],
            patches: vec![],
            labels: vec![],
            total_height: self.heights.total() + 32.,
            scroll: self.scroll,
            scroll_min: self.scroll,
            scroll_max: self.scroll,
            pending: self.jobs.pending(),
            visible_ready: self.visible_ready(),
            quad_count: 0,
            layout_ms,
            longest_job_ms: self.longest,
            cached_blocks: self.blocks.len(),
            navigation: NavigationMap::default(),
            raster_ms: 0.,
            scene_ms: 0.,
            document_bytes: self.text.len_bytes(),
            document_chars: self.text.len_chars(),
            document_lines: self.text.len_lines(),
            atlas_entries: 0,
            jobs_processed: self.jobs_processed,
            highlight_source_version: self.highlight_history.source_version(),
            highlight_spans: self.external.len(),
        };
        let buffer = (self.height as f64 * 0.5).min(256.);
        let desired_start = (self.scroll - buffer).max(0.);
        let desired_end = self.scroll + self.height as f64 + buffer;
        // Coverage stops at uncached blocks and window edges so translation cannot expose unshaped rows.
        let mut first = self.heights.locate(self.scroll);
        let mut last = self.heights.locate(self.scroll + self.height as f64);
        while first > 0
            && self.heights.prefix(first) + 16. > desired_start
            && self.blocks.contains_key(&(first - 1))
        {
            first -= 1;
        }
        while last + 1 < self.text.len_lines()
            && self.heights.prefix(last + 1) + 16. < desired_end
            && self.blocks.contains_key(&(last + 1))
        {
            last += 1;
        }
        let mut coverage_start = if first == 0 {
            0.
        } else {
            self.heights.prefix(first) + 16.
        };
        let mut coverage_end = self.heights.prefix(last + 1) + 16.;
        if last + 1 == self.text.len_lines() {
            coverage_end += 16.;
        }
        if let Some(block) = self.blocks.get(&first) {
            if let Some((row, _)) = block.fast_window {
                if row > 0 {
                    coverage_start = coverage_start.max(
                        self.heights.prefix(first) + 16. + row as f64 * self.line_height as f64,
                    );
                }
            }
        }
        if let Some(block) = self.blocks.get(&last) {
            if let Some((_, end)) = block.fast_window {
                if end < (block.height / self.line_height).ceil() as usize {
                    coverage_end = coverage_end.min(
                        self.heights.prefix(last) + 16. + end as f64 * self.line_height as f64,
                    );
                }
            }
        }
        coverage_start = coverage_start.max(desired_start).min(self.scroll);
        coverage_end = coverage_end
            .min(desired_end)
            .max(self.scroll + self.height as f64);
        frame.scroll_min = coverage_start;
        frame.scroll_max = (coverage_end - self.height as f64)
            .max(self.scroll)
            .min((frame.total_height - self.height as f64).max(0.));
        let min_y = (coverage_start - self.scroll) as f32;
        let max_y = (coverage_end - self.scroll) as f32;
        let selected = selection.range();
        let mut glyphs = vec![];
        for line in first..=last {
            let top = (self.heights.prefix(line) - self.scroll) as f32 + 16.;
            frame.labels.push(LineLabel {
                line: line + 1,
                y: top,
            });
            if let Some(block) = self.blocks.get(&line) {
                for rect in &block.backgrounds {
                    if top + rect.bounds[1] + rect.bounds[3] < min_y || top + rect.bounds[1] > max_y
                    {
                        continue;
                    }
                    let mut rect = rect.clone();
                    rect.bounds[1] += top;
                    frame.rects.push(rect);
                }
                for cell in &block.cells {
                    if cell.start < selected.end
                        && cell.end > selected.start
                        && top + cell.bounds[1] + cell.bounds[3] >= min_y
                        && top + cell.bounds[1] <= max_y
                    {
                        frame.rects.push(Rect::solid(
                            cell.bounds[0],
                            top + cell.bounds[1],
                            cell.bounds[2],
                            self.line_height,
                            self.theme.selection,
                        ));
                    }
                }
                for g in &block.glyphs {
                    if top + g.y >= min_y - self.line_height && top + g.y < max_y + self.line_height
                    {
                        glyphs.push((g.key, g.x, g.y + top, g.color));
                    }
                }
            }
        }
        for (key, x, y, color) in glyphs {
            if let Some(slot) = self.slot(key, &mut frame.patches) {
                frame.rects.push(Rect {
                    bounds: [
                        x + slot.left as f32 / self.scale,
                        y - slot.top as f32 / self.scale,
                        slot.w as f32 / self.scale,
                        slot.h as f32 / self.scale,
                    ],
                    uv: [
                        slot.x as f32 / ATLAS as f32,
                        slot.y as f32 / ATLAS as f32,
                        slot.w as f32 / ATLAS as f32,
                        slot.h as f32 / ATLAS as f32,
                    ],
                    color: if slot.color { [1.; 4] } else { color },
                });
            }
        }
        frame.navigation = self.navigation_map(
            first.saturating_sub(1),
            (last + 1).min(self.text.len_lines() - 1),
            min_y - 3. * self.line_height,
            max_y + 3. * self.line_height,
        );
        self.packed_navigation = frame
            .navigation
            .pack()
            .expect("WASM document offsets fit u32");
        frame.quad_count = frame.rects.len();
        frame.raster_ms = self.raster_ms;
        frame.scene_ms = (now() - scene_start - self.raster_ms).max(0.);
        frame.atlas_entries = self.slots.len();
        self.instances.clear();
        for r in &frame.rects {
            self.instances.extend_from_slice(&r.bounds);
            self.instances.extend_from_slice(&r.uv);
            self.instances.extend_from_slice(&r.color);
        }
        frame
    }
    fn navigation_map(&self, first: usize, last: usize, min_y: f32, max_y: f32) -> NavigationMap {
        let mut result = NavigationMap::default();
        for line in first..=last {
            let Some(block) = self.blocks.get(&line) else {
                continue;
            };
            let top = (self.heights.prefix(line) - self.scroll) as f32 + 16.;
            for cell in &block.cells {
                let y = top + cell.bounds[1];
                if y >= min_y && y <= max_y {
                    let mut c = cell.clone();
                    c.bounds[1] = y;
                    result.cells.push(c);
                }
            }
            for hit in &block.hits {
                let y = top + hit.y;
                if y >= min_y && y <= max_y {
                    let mut h = hit.clone();
                    h.y = y;
                    result.hits.push(h);
                }
            }
            for row in &block.rows {
                let y = top + row.y;
                if y >= min_y && y <= max_y {
                    let mut r = row.clone();
                    r.y = y;
                    result.rows.push(r);
                }
            }
        }
        result
    }
}
