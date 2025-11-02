use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub struct BookId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BookMetadata {
    pub identifier: Option<String>,
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Spine {
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BookContent {
    pub manifest: HashMap<String, ManifestItem>,
    pub spine: Spine,
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Chapter {
    pub id: String,
    pub title: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Book {
    pub id: BookId,
    pub metadata: BookMetadata,
    pub content: BookContent,
    pub source_path: PathBuf,
}

impl Book {
    pub fn empty() -> Self {
        Self {
            id: BookId("unknown".to_string()),
            metadata: BookMetadata::default(),
            content: BookContent::default(),
            source_path: PathBuf::new(),
        }
    }
}
