mod model;
mod service;

pub use model::{
    Book, BookContent, BookId, BookMetadata, Chapter, ChapterBlock, ManifestItem, Spine, TextSpan,
    TocEntry,
};
pub use service::EpubService;
