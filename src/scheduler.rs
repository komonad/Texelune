use std::collections::BinaryHeap;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum Priority {
    Background,
    Prefetch,
    Viewport,
    Input,
}

#[derive(Eq, PartialEq)]
struct Entry {
    priority: Priority,
    order: std::cmp::Reverse<u64>,
    epoch: u64,
    id: usize,
}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (self.priority, self.order).cmp(&(other.priority, other.order))
    }
}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Default)]
pub struct Scheduler {
    queue: BinaryHeap<Entry>,
    epoch: u64,
    order: u64,
}
impl Scheduler {
    pub fn invalidate(&mut self) {
        self.epoch += 1;
        self.queue.clear();
    }
    pub fn enqueue(&mut self, id: usize, priority: Priority) {
        self.order += 1;
        self.queue.push(Entry {
            priority,
            order: std::cmp::Reverse(self.order),
            epoch: self.epoch,
            id,
        });
    }
    pub fn next_job(&mut self) -> Option<usize> {
        while let Some(entry) = self.queue.pop() {
            if entry.epoch == self.epoch {
                return Some(entry.id);
            }
        }
        None
    }
    pub fn pending(&self) -> usize {
        self.queue.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn input_precedes_background_and_old_epochs_disappear() {
        let mut s = Scheduler::default();
        s.enqueue(1, Priority::Background);
        s.enqueue(2, Priority::Input);
        s.enqueue(3, Priority::Input);
        assert_eq!(s.next_job(), Some(2));
        assert_eq!(s.next_job(), Some(3));
        s.invalidate();
        assert_eq!(s.next_job(), None);
    }
}
