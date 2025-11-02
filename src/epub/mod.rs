mod model;
mod service;

pub use model::{Book, BookContent, BookId, BookMetadata, Chapter, ManifestItem, Spine};
pub use service::EpubService;
