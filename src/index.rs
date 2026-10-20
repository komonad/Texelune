/// Prefix sums of measured or estimated block heights.
pub struct HeightIndex {
    values: Vec<f64>,
    tree: Vec<f64>,
}

impl HeightIndex {
    pub fn new(count: usize, estimate: f64) -> Self {
        Self::from_values(vec![estimate; count])
    }
    fn from_values(values: Vec<f64>) -> Self {
        let count = values.len();
        let mut result = Self {
            values,
            tree: vec![0.; count + 1],
        };
        for i in 1..=count {
            result.tree[i] += result.values[i - 1];
            let parent = i + (i & i.wrapping_neg());
            if parent <= count {
                result.tree[parent] += result.tree[i];
            }
        }
        result
    }
    pub fn splice(
        &mut self,
        range: std::ops::Range<usize>,
        heights: impl IntoIterator<Item = f64>,
    ) {
        self.values.splice(range, heights);
        let values = std::mem::take(&mut self.values);
        *self = Self::from_values(values);
    }
    pub fn len(&self) -> usize {
        self.values.len()
    }
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }
    pub fn set(&mut self, index: usize, value: f64) {
        let delta = value - self.values[index];
        self.values[index] = value;
        let mut i = index + 1;
        while i < self.tree.len() {
            self.tree[i] += delta;
            i += i & i.wrapping_neg();
        }
    }
    pub fn prefix(&self, end: usize) -> f64 {
        let mut i = end.min(self.len());
        let mut total = 0.;
        while i > 0 {
            total += self.tree[i];
            i &= i - 1;
        }
        total
    }
    pub fn total(&self) -> f64 {
        self.prefix(self.len())
    }
    pub fn locate(&self, y: f64) -> usize {
        if self.is_empty() {
            return 0;
        }
        let mut index = 0;
        let mut sum = 0.;
        let mut step = self.len().next_power_of_two();
        while step > 0 {
            let next = index + step;
            if next <= self.len() && sum + self.tree[next] <= y.max(0.) {
                index = next;
                sum += self.tree[next];
            }
            step >>= 1;
        }
        index.min(self.len() - 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn height_queries_match_linear_reference() {
        let mut index = HeightIndex::new(1000, 24.);
        let mut heights = vec![24.; 1000];
        for i in (0..1000).step_by(7) {
            heights[i] = (i % 80 + 1) as f64;
            index.set(i, heights[i]);
        }
        for end in 0..=1000 {
            assert_eq!(index.prefix(end), heights[..end].iter().sum::<f64>());
        }
        for y in (0..index.total() as usize).step_by(11) {
            let expected = (0..1000)
                .find(|i| heights[..=*i].iter().sum::<f64>() > y as f64)
                .unwrap();
            assert_eq!(index.locate(y as f64), expected);
        }
    }
    #[test]
    fn paragraph_splices_preserve_surrounding_measurements() {
        let mut index = HeightIndex::new(5, 28.);
        index.set(0, 252.);
        index.set(1, 168.);
        index.set(3, 112.);
        index.splice(2..3, [28., 56.]);
        assert_eq!(index.prefix(2), 420.);
        assert_eq!(index.prefix(5), 616.);
        assert_eq!(index.total(), 644.);
        assert_eq!(index.locate(520.), 4);
        index.splice(2..5, [140.]);
        assert_eq!(index.prefix(2), 420.);
        assert_eq!(index.total(), 588.);
        assert_eq!(index.locate(570.), 3);
    }
}
