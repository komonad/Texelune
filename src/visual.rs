use crate::caret::{Cell, Hit};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VisualRow {
    pub y: f32,
    pub h: f32,
    pub rtl: bool,
}
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct NavigationMap {
    pub cells: Vec<Cell>,
    pub hits: Vec<Hit>,
    pub rows: Vec<VisualRow>,
}
impl NavigationMap {
    pub fn pack(&self) -> Result<Vec<u32>, &'static str> {
        let index = |n: usize| u32::try_from(n).map_err(|_| "navigation index overflow");
        let mut out = vec![
            0x4c4e5631,
            index(self.cells.len())?,
            index(self.hits.len())?,
            index(self.rows.len())?,
        ];
        for c in &self.cells {
            out.extend([index(c.start)?, index(c.end)?]);
            out.extend(c.bounds.map(f32::to_bits));
            out.push(u32::from(c.rtl));
        }
        for h in &self.hits {
            out.extend([
                h.x.to_bits(),
                h.y.to_bits(),
                h.h.to_bits(),
                index(h.offset)?,
                index(h.cluster)?,
                u32::from(h.trailing),
            ]);
        }
        for r in &self.rows {
            out.extend([r.y.to_bits(), r.h.to_bits(), u32::from(r.rtl)]);
        }
        Ok(out)
    }
    pub fn unpack(data: &[u32]) -> Result<Self, &'static str> {
        if data.len() < 4 || data[0] != 0x4c4e5631 {
            return Err("invalid navigation header");
        }
        let cells = data[1] as usize;
        let hits = data[2] as usize;
        let rows = data[3] as usize;
        let expected = cells
            .checked_mul(7)
            .and_then(|n| hits.checked_mul(6).and_then(|h| n.checked_add(h)))
            .and_then(|n| rows.checked_mul(3).and_then(|r| n.checked_add(r)))
            .and_then(|n| n.checked_add(4));
        if expected != Some(data.len()) {
            return Err("invalid navigation length");
        }
        let mut map = Self::default();
        for c in data[4..4 + cells * 7].chunks_exact(7) {
            map.cells.push(Cell {
                start: c[0] as usize,
                end: c[1] as usize,
                bounds: [
                    f32::from_bits(c[2]),
                    f32::from_bits(c[3]),
                    f32::from_bits(c[4]),
                    f32::from_bits(c[5]),
                ],
                rtl: c[6] != 0,
            });
        }
        let begin = 4 + cells * 7;
        for h in data[begin..begin + hits * 6].chunks_exact(6) {
            map.hits.push(Hit {
                x: f32::from_bits(h[0]),
                y: f32::from_bits(h[1]),
                h: f32::from_bits(h[2]),
                offset: h[3] as usize,
                cluster: h[4] as usize,
                trailing: h[5] != 0,
            });
        }
        for r in data[begin + hits * 6..].chunks_exact(3) {
            map.rows.push(VisualRow {
                y: f32::from_bits(r[0]),
                h: f32::from_bits(r[1]),
                rtl: r[2] != 0,
            });
        }
        Ok(map)
    }
    pub fn hit_test(&self, x: f32, y: f32) -> Option<Hit> {
        if let Some(cell) = self.cells.iter().find(|cell| {
            let [left, top, width, height] = cell.bounds;
            x >= left && x < left + width && y >= top && y < top + height
        }) {
            let right = x >= cell.bounds[0] + cell.bounds[2] / 2.;
            let trailing = right != cell.rtl;
            return Some(Hit {
                x: cell.bounds[0] + if right { cell.bounds[2] } else { 0. },
                y: cell.bounds[1],
                h: cell.bounds[3],
                offset: if trailing { cell.end } else { cell.start },
                cluster: cell.start,
                trailing,
            });
        }
        let row = self
            .hits
            .iter()
            .min_by(|a, b| {
                (a.y + a.h / 2. - y)
                    .abs()
                    .total_cmp(&(b.y + b.h / 2. - y).abs())
            })?
            .y;
        self.row_hits(row)
            .min_by(|a, b| (a.x - x).abs().total_cmp(&(b.x - x).abs()))
            .cloned()
    }
    pub fn collapse(&self, anchor: usize, head: usize, right: bool) -> Option<Hit> {
        let lo = anchor.min(head);
        let hi = anchor.max(head);
        let selected = self
            .cells
            .iter()
            .filter(|c| c.start < hi && c.end > lo && c.bounds[2] > 0.01);
        let cell = if right {
            selected.max_by(|a, b| {
                a.bounds[1].total_cmp(&b.bounds[1]).then_with(|| {
                    (a.bounds[0] + a.bounds[2]).total_cmp(&(b.bounds[0] + b.bounds[2]))
                })
            })
        } else {
            selected.min_by(|a, b| {
                a.bounds[1]
                    .total_cmp(&b.bounds[1])
                    .then_with(|| a.bounds[0].total_cmp(&b.bounds[0]))
            })
        }?;
        let trailing = right != cell.rtl;
        Some(Hit {
            x: cell.bounds[0] + if right { cell.bounds[2] } else { 0. },
            y: cell.bounds[1],
            h: cell.bounds[3],
            offset: if trailing { cell.end } else { cell.start },
            cluster: cell.start,
            trailing,
        })
    }
    pub fn resolve(&self, offset: usize, affinity: Option<&Hit>) -> Option<Hit> {
        if let Some(a) = affinity {
            if let Some(h) = self
                .hits
                .iter()
                .find(|h| h.offset == offset && h.cluster == a.cluster && h.trailing == a.trailing)
            {
                return Some(h.clone());
            }
        }
        self.hits
            .iter()
            .find(|h| h.offset == offset && !h.trailing)
            .or_else(|| self.hits.iter().find(|h| h.offset == offset))
            .cloned()
    }
    fn row_hits(&self, y: f32) -> impl Iterator<Item = &Hit> {
        self.hits.iter().filter(move |h| (h.y - y).abs() < 0.5)
    }
    fn edge(&self, row: &VisualRow, right: bool) -> Option<Hit> {
        let mut hits: Vec<_> = self.row_hits(row.y).collect();
        hits.sort_by(|a, b| a.x.total_cmp(&b.x));
        if right {
            hits.last().map(|h| (*h).clone())
        } else {
            hits.first().map(|h| (*h).clone())
        }
    }
    pub fn motion(
        &self,
        offset: usize,
        affinity: Option<&Hit>,
        command: &str,
        preferred_x: Option<f32>,
    ) -> Option<Hit> {
        let current = self.resolve(offset, affinity)?;
        let row = self.rows.iter().find(|r| (r.y - current.y).abs() < 0.5)?;
        match command {
            "home" => return self.edge(row, row.rtl),
            "end" => return self.edge(row, !row.rtl),
            "up" | "down" => {
                let next = if command == "down" {
                    self.rows
                        .iter()
                        .filter(|r| r.y > row.y + 0.5)
                        .min_by(|a, b| a.y.total_cmp(&b.y))
                } else {
                    self.rows
                        .iter()
                        .filter(|r| r.y < row.y - 0.5)
                        .max_by(|a, b| a.y.total_cmp(&b.y))
                }?;
                let x = preferred_x.unwrap_or(current.x);
                return self
                    .row_hits(next.y)
                    .min_by(|a, b| (a.x - x).abs().total_cmp(&(b.x - x).abs()))
                    .cloned();
            }
            "left" | "right" => (),
            _ => return None,
        }
        let right = command == "right";
        // Traverse a visible grapheme cell, not coincident caret stops at a run boundary.
        let cell = if right {
            self.cells
                .iter()
                .filter(|c| {
                    (c.bounds[1] - row.y).abs() < 0.5
                        && c.bounds[2] > 0.01
                        && c.bounds[0] + c.bounds[2] > current.x + 0.01
                })
                .min_by(|a, b| (a.bounds[0] + a.bounds[2]).total_cmp(&(b.bounds[0] + b.bounds[2])))
        } else {
            self.cells
                .iter()
                .filter(|c| {
                    (c.bounds[1] - row.y).abs() < 0.5
                        && c.bounds[2] > 0.01
                        && c.bounds[0] < current.x - 0.01
                })
                .max_by(|a, b| a.bounds[0].total_cmp(&b.bounds[0]))
        };
        if let Some(cell) = cell {
            let trailing = right != cell.rtl;
            return Some(Hit {
                x: cell.bounds[0] + if right { cell.bounds[2] } else { 0. },
                y: cell.bounds[1],
                h: cell.bounds[3],
                offset: if trailing { cell.end } else { cell.start },
                cluster: cell.start,
                trailing,
            });
        }
        let forward = right != row.rtl;
        let next = if forward {
            self.rows
                .iter()
                .filter(|r| r.y > row.y + 0.5)
                .min_by(|a, b| a.y.total_cmp(&b.y))
        } else {
            self.rows
                .iter()
                .filter(|r| r.y < row.y - 0.5)
                .max_by(|a, b| a.y.total_cmp(&b.y))
        }?;
        self.edge(next, if forward { next.rtl } else { !next.rtl })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::caret::{caret_cells, DisplayCluster, GlyphBox};
    #[test]
    fn binary_navigation_preserves_offsets_affinity_and_coordinates() {
        let map = NavigationMap {
            cells: vec![Cell {
                start: u32::MAX as usize - 1,
                end: u32::MAX as usize,
                bounds: [-2.5, 28., 9.75, 28.],
                rtl: true,
            }],
            hits: vec![Hit {
                x: -2.5,
                y: 28.,
                h: 28.,
                offset: u32::MAX as usize,
                cluster: u32::MAX as usize - 1,
                trailing: true,
            }],
            rows: vec![VisualRow {
                y: 28.,
                h: 28.,
                rtl: true,
            }],
        };
        let packed = map.pack().unwrap();
        let decoded = NavigationMap::unpack(&packed).unwrap();
        let hit = decoded.resolve(u32::MAX as usize, None).unwrap();
        assert_eq!(
            (hit.offset, hit.cluster, hit.trailing, hit.x),
            (u32::MAX as usize, u32::MAX as usize - 1, true, -2.5)
        );
        assert_eq!(decoded.cells[0].bounds, map.cells[0].bounds);
        assert!(decoded.rows[0].rtl);
        assert_eq!(decoded.hit_test(-2.5, 40.).unwrap().offset, hit.offset);
        assert!(NavigationMap::unpack(&packed[..packed.len() - 1]).is_err());
        assert!(NavigationMap::unpack(&[0x4c4e5631, u32::MAX, u32::MAX, u32::MAX]).is_err());
    }
    #[test]
    fn mixed_runs_cross_without_stationary_steps() {
        let clusters = (0..5)
            .map(|i| DisplayCluster {
                bytes: i..i + 1,
                document: i..i + 1,
            })
            .collect::<Vec<_>>();
        let glyphs = [
            (0, 0., false),
            (1, 10., false),
            (2, 30., true),
            (3, 20., true),
            (4, 40., false),
        ]
        .map(|(i, x, rtl)| GlyphBox {
            start: i,
            end: i + 1,
            x,
            y: 0.,
            width: 10.,
            rtl,
        });
        let (cells, hits) = caret_cells(&clusters, &glyphs, 28.);
        let map = NavigationMap {
            cells,
            hits,
            rows: vec![VisualRow {
                y: 0.,
                h: 28.,
                rtl: false,
            }],
        };
        assert_eq!(map.hit_test(12., 14.).unwrap().cluster, 1);
        assert_eq!(map.hit_test(22., 14.).unwrap().cluster, 3);
        let mut hit = map.resolve(0, None).unwrap();
        let mut visited = Vec::new();
        for _ in 0..5 {
            let next = map.motion(hit.offset, Some(&hit), "right", None).unwrap();
            assert!(next.x > hit.x);
            visited.push(next.offset);
            hit = next;
        }
        assert_eq!(visited, vec![1, 2, 3, 2, 5]);
        assert!(map.motion(hit.offset, Some(&hit), "right", None).is_none());
        for _ in 0..5 {
            let next = map.motion(hit.offset, Some(&hit), "left", None).unwrap();
            assert!(next.x < hit.x);
            hit = next;
        }
        assert_eq!(hit.offset, 0);
    }
    #[test]
    fn rtl_wrap_continues_in_reading_order_and_affinity_survives_reflow() {
        let clusters = (0..2)
            .map(|i| DisplayCluster {
                bytes: i..i + 1,
                document: i..i + 1,
            })
            .collect::<Vec<_>>();
        let glyphs = [
            GlyphBox {
                start: 0,
                end: 1,
                x: 30.,
                y: 0.,
                width: 10.,
                rtl: true,
            },
            GlyphBox {
                start: 1,
                end: 2,
                x: 30.,
                y: 28.,
                width: 10.,
                rtl: true,
            },
        ];
        let (cells, hits) = caret_cells(&clusters, &glyphs, 28.);
        let map = NavigationMap {
            cells,
            hits,
            rows: vec![
                VisualRow {
                    y: 0.,
                    h: 28.,
                    rtl: true,
                },
                VisualRow {
                    y: 28.,
                    h: 28.,
                    rtl: true,
                },
            ],
        };
        let first = map.motion(0, None, "left", None).unwrap();
        assert_eq!((first.offset, first.x), (1, 30.));
        let next = map
            .motion(first.offset, Some(&first), "left", None)
            .unwrap();
        assert_eq!((next.offset, next.y, next.x), (1, 28., 40.));
        let last = map.motion(next.offset, Some(&next), "left", None).unwrap();
        assert_eq!(last.offset, 2);
        let shifted = Hit {
            y: 999.,
            x: 999.,
            ..last.clone()
        };
        assert_eq!(map.resolve(2, Some(&shifted)).unwrap().y, 28.);
    }
}
