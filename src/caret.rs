use serde::{Deserialize, Serialize};
use std::{collections::HashMap, ops::Range};

#[derive(Clone, Debug)]
pub struct DisplayCluster {
    pub bytes: Range<usize>,
    pub document: Range<usize>,
}
#[derive(Clone, Copy)]
pub struct GlyphBox {
    pub start: usize,
    pub end: usize,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub rtl: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hit {
    pub x: f32,
    pub y: f32,
    pub h: f32,
    pub offset: usize,
    pub cluster: usize,
    pub trailing: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Cell {
    pub start: usize,
    pub end: usize,
    pub bounds: [f32; 4],
    pub rtl: bool,
}

/// Glyph clusters can contain several graphemes, and a grapheme can contain several glyphs.
/// Only complete source graphemes contribute editable caret stops.
pub fn caret_cells(
    clusters: &[DisplayCluster],
    glyphs: &[GlyphBox],
    line_height: f32,
) -> (Vec<Cell>, Vec<Hit>) {
    let mut cells: Vec<Cell> = Vec::new();
    let mut indices = HashMap::new();
    for glyph in glyphs {
        let first = clusters.partition_point(|g| g.bytes.end <= glyph.start);
        let last = clusters.partition_point(|g| g.bytes.start < glyph.end);
        let members = &clusters[first..last];
        if members.is_empty() {
            continue;
        }
        let width = glyph.width / members.len() as f32;
        for (i, cluster) in members.iter().enumerate() {
            let x = glyph.x
                + if glyph.rtl {
                    (members.len() - 1 - i) as f32 * width
                } else {
                    i as f32 * width
                };
            let key = (cluster.document.start, glyph.y.to_bits());
            if let Some(&index) = indices.get(&key) {
                let cell: &mut Cell = &mut cells[index];
                let right = (cell.bounds[0] + cell.bounds[2]).max(x + width);
                cell.bounds[0] = cell.bounds[0].min(x);
                cell.bounds[2] = right - cell.bounds[0];
            } else {
                indices.insert(key, cells.len());
                cells.push(Cell {
                    start: cluster.document.start,
                    end: cluster.document.end,
                    bounds: [x, glyph.y, width, line_height],
                    rtl: glyph.rtl,
                });
            }
        }
    }
    let mut hits = Vec::with_capacity(cells.len() * 2);
    for cell in &cells {
        let [x, y, w, h] = cell.bounds;
        hits.push(Hit {
            x: if cell.rtl { x + w } else { x },
            y,
            h,
            offset: cell.start,
            cluster: cell.start,
            trailing: false,
        });
        hits.push(Hit {
            x: if cell.rtl { x } else { x + w },
            y,
            h,
            offset: cell.end,
            cluster: cell.start,
            trailing: true,
        });
    }
    (cells, hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multiple_glyphs_in_one_grapheme_have_only_two_caret_stops() {
        let clusters = [DisplayCluster {
            bytes: 0..7,
            document: 0..3,
        }];
        let glyphs = [
            GlyphBox {
                start: 0,
                end: 3,
                x: 0.,
                y: 0.,
                width: 10.,
                rtl: false,
            },
            GlyphBox {
                start: 3,
                end: 7,
                x: 10.,
                y: 0.,
                width: 8.,
                rtl: false,
            },
        ];
        let (cells, hits) = caret_cells(&clusters, &glyphs, 28.);
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].bounds[2], 18.);
        assert_eq!(
            hits.iter().map(|h| h.offset).collect::<Vec<_>>(),
            vec![0, 3]
        );
    }
    #[test]
    fn rtl_ligature_distributes_stops_in_reverse_visual_order() {
        let clusters = [
            DisplayCluster {
                bytes: 0..2,
                document: 0..1,
            },
            DisplayCluster {
                bytes: 2..4,
                document: 1..2,
            },
        ];
        let glyphs = [GlyphBox {
            start: 0,
            end: 4,
            x: 10.,
            y: 0.,
            width: 20.,
            rtl: true,
        }];
        let (_, hits) = caret_cells(&clusters, &glyphs, 28.);
        let start = hits.iter().find(|h| h.offset == 0).unwrap();
        let end = hits.iter().find(|h| h.offset == 2).unwrap();
        assert_eq!(start.x, 30.);
        assert_eq!(end.x, 10.);
    }
    #[test]
    fn bidi_boundary_retains_both_visual_affinities() {
        let clusters = [
            DisplayCluster {
                bytes: 0..1,
                document: 0..1,
            },
            DisplayCluster {
                bytes: 1..3,
                document: 1..2,
            },
        ];
        let glyphs = [
            GlyphBox {
                start: 0,
                end: 1,
                x: 0.,
                y: 0.,
                width: 10.,
                rtl: false,
            },
            GlyphBox {
                start: 1,
                end: 3,
                x: 10.,
                y: 0.,
                width: 10.,
                rtl: true,
            },
        ];
        let (_, hits) = caret_cells(&clusters, &glyphs, 28.);
        let positions: Vec<_> = hits.iter().filter(|h| h.offset == 1).map(|h| h.x).collect();
        assert_eq!(positions, vec![10., 20.]);
    }
}
