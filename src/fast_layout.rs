#[derive(Debug)]
pub struct MonoWindow {
    pub columns: usize,
    pub first_row: usize,
    pub end_row: usize,
    pub total_rows: usize,
    pub first_char: usize,
    pub end_char: usize,
}
impl MonoWindow {
    pub fn unwrapped(chars: usize, columns: usize, focus: usize) -> Self {
        let first_char = focus
            .saturating_sub(columns / 2)
            .min(chars.saturating_sub(columns));
        Self {
            columns,
            first_row: 0,
            end_row: 1,
            total_rows: 1,
            first_char,
            end_char: (first_char + columns + 8).min(chars),
        }
    }
    pub fn new(
        chars: usize,
        advance: f32,
        width: f32,
        line_height: f32,
        height: f32,
        scroll: f64,
    ) -> Self {
        let columns = ((width / advance).floor() as usize).max(1);
        let total_rows = chars.div_ceil(columns).max(1);
        let visible_first =
            ((scroll.max(0.) / line_height as f64).floor() as usize).min(total_rows - 1);
        let visible_rows = (height / line_height).ceil() as usize;
        let margin = visible_rows.clamp(8, 32);
        let first_row = visible_first.saturating_sub(margin);
        let end_row = (visible_first + visible_rows + margin + 2).min(total_rows);
        Self {
            columns,
            first_row,
            end_row,
            total_rows,
            first_char: first_row * columns,
            end_char: (end_row * columns).min(chars),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hundred_megabyte_line_keeps_a_bounded_prefetch_window() {
        let plan = MonoWindow::new(100 * 1024 * 1024, 10., 800., 28., 560., 14_000_000.);
        assert_eq!(plan.columns, 80);
        assert!(plan.end_char - plan.first_char < 3 * 80 * 22);
        assert_eq!(plan.total_rows, (100usize * 1024 * 1024).div_ceil(80));
    }
}
