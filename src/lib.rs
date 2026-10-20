pub mod caret;
pub mod document;
pub mod fast_layout;
pub mod highlights;
pub mod import;
pub mod index;
pub mod interaction;
pub mod scheduler;
pub mod syntax;
pub mod theme;
pub mod visual;

#[cfg(target_arch = "wasm32")]
mod browser;
#[cfg(target_arch = "wasm32")]
mod gpu;
#[cfg(target_arch = "wasm32")]
mod layout;
