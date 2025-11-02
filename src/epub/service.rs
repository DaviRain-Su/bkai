use super::{
    Book, BookContent, BookId, BookMetadata, Chapter, ChapterBlock, ManifestItem, Spine, TextSpan,
    TocEntry,
};
use anyhow::Result;
use epub::doc::{DocError, EpubDoc, NavPoint, SpineItem};
use html2text::from_read;
use std::collections::HashMap;
use std::io::{Cursor, Read, Seek};
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum EpubError {
    #[error("failed to open epub at {path:?}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse epub at {path:?}: {source}")]
    Parse {
        path: PathBuf,
        #[source]
        source: DocError,
    },
}

#[derive(Debug, Default)]
pub struct EpubService;

impl EpubService {
    pub fn open_book(&self, path: &Path) -> Result<Book> {
        let mut doc = EpubDoc::new(path).map_err(|source| Self::map_doc_error(path, source))?;

        let metadata = Self::extract_metadata(&doc);
        let content = Self::extract_content(&mut doc);

        let identifier = metadata
            .identifier
            .clone()
            .or_else(|| doc.get_release_identifier());
        let book_id = identifier.unwrap_or_else(|| Uuid::new_v4().to_string());

        let mut book = Book::empty();
        book.id = BookId(book_id);
        book.metadata = metadata;
        book.content = content;
        book.source_path = path.to_path_buf();
        Ok(book)
    }

    fn extract_metadata<R: Read + Seek>(doc: &EpubDoc<R>) -> BookMetadata {
        let identifier = Self::metadata_value(doc, &["identifier"]);
        let release_identifier = doc.get_release_identifier();

        let title = doc
            .get_title()
            .or_else(|| Self::metadata_value(doc, &["title"]));

        let authors = Self::collect_metadata_values(doc, &["creator", "author"]);

        let language = Self::metadata_value(doc, &["language"]);
        let description = Self::metadata_value(doc, &["description", "abstract"]);

        BookMetadata {
            identifier: identifier.clone().or(release_identifier.clone()),
            title,
            authors,
            language,
            description,
        }
    }

    fn extract_content<R: Read + Seek>(doc: &mut EpubDoc<R>) -> BookContent {
        let manifest = doc
            .resources
            .iter()
            .map(|(id, resource)| {
                (
                    id.clone(),
                    ManifestItem {
                        id: id.clone(),
                        href: resource.path.to_string_lossy().to_string(),
                        media_type: resource.mime.clone(),
                    },
                )
            })
            .collect();

        let spine_items: Vec<_> = doc.spine.clone();
        let spine = Spine {
            items: spine_items.iter().map(|item| item.idref.clone()).collect(),
        };

        let toc_labels = Self::build_toc_label_map(&doc.toc);
        let chapters = Self::collect_chapters(doc, spine_items, &toc_labels);
        let toc = Self::build_toc_entries(&doc.toc);

        BookContent {
            manifest,
            spine,
            toc,
            chapters,
        }
    }

    fn metadata_value<R: Read + Seek>(doc: &EpubDoc<R>, keys: &[&str]) -> Option<String> {
        doc.metadata.iter().find_map(|item| {
            let property = item.property.to_ascii_lowercase();
            let matched = keys.iter().any(|key| {
                let key = key.to_ascii_lowercase();
                property == key || property.ends_with(&format!(":{}", key))
            });
            if matched {
                Some(item.value.clone())
            } else {
                None
            }
        })
    }

    fn collect_metadata_values<R: Read + Seek>(doc: &EpubDoc<R>, keys: &[&str]) -> Vec<String> {
        let mut values: Vec<String> = Vec::new();
        for item in &doc.metadata {
            let property = item.property.to_ascii_lowercase();
            if keys.iter().any(|key| {
                let key = key.to_ascii_lowercase();
                property == key || property.ends_with(&format!(":{}", key))
            }) {
                let value = item.value.trim();
                if !value.is_empty()
                    && !values
                        .iter()
                        .any(|existing| existing.as_str().eq_ignore_ascii_case(value))
                {
                    values.push(value.to_string());
                }
            }
        }
        values
    }

    fn collect_chapters<R: Read + Seek>(
        doc: &mut EpubDoc<R>,
        spine_items: Vec<SpineItem>,
        toc_labels: &HashMap<PathBuf, String>,
    ) -> Vec<Chapter> {
        let mut chapters = Vec::new();

        for spine_item in spine_items {
            let idref = spine_item.idref.clone();
            let resource = match doc.resources.get(&idref).cloned() {
                Some(resource) => resource,
                None => continue,
            };

            let mime_lower = resource.mime.to_ascii_lowercase();
            if !(mime_lower.contains("html") || mime_lower.contains("xhtml")) {
                continue;
            }

            let (html, _) = match doc.get_resource_str(&idref) {
                Some(result) => result,
                None => continue,
            };

            let blocks = Self::html_to_blocks(&html);
            let plain_text = if blocks.is_empty() {
                Self::html_to_plain_text(&html)
            } else {
                Self::blocks_to_plain_text(&blocks)
            };
            let title = Self::derive_chapter_title(
                toc_labels,
                &resource.path,
                &blocks,
                &plain_text,
                &idref,
            );
            let href = resource.path.to_string_lossy().to_string();

            chapters.push(Chapter {
                id: idref.clone(),
                title,
                href,
                blocks,
                plain_text,
            });
        }

        chapters
    }

    fn build_toc_label_map(nav: &[NavPoint]) -> HashMap<PathBuf, String> {
        let mut labels = HashMap::new();
        for nav_point in nav {
            Self::collect_nav_labels(nav_point, &mut labels);
        }
        labels
    }

    fn collect_nav_labels(nav_point: &NavPoint, labels: &mut HashMap<PathBuf, String>) {
        let key = Self::normalize_nav_path(&nav_point.content);
        labels.entry(key).or_insert_with(|| nav_point.label.clone());

        for child in &nav_point.children {
            Self::collect_nav_labels(child, labels);
        }
    }

    fn normalize_nav_path(path: &Path) -> PathBuf {
        let raw = path.to_string_lossy();
        if let Some((prefix, _fragment)) = raw.split_once('#') {
            PathBuf::from(prefix)
        } else {
            path.to_path_buf()
        }
    }

    fn derive_chapter_title(
        toc_labels: &HashMap<PathBuf, String>,
        resource_path: &Path,
        blocks: &[ChapterBlock],
        plain_text: &str,
        fallback_id: &str,
    ) -> Option<String> {
        if let Some(label) = toc_labels.get(resource_path) {
            return Some(label.clone());
        }

        if let Some(label) = Self::match_toc_label(toc_labels, resource_path) {
            return Some(label);
        }

        for block in blocks {
            match block {
                ChapterBlock::Heading { spans, .. } | ChapterBlock::Paragraph { spans } => {
                    let text = Self::spans_to_text(spans);
                    if !text.trim().is_empty() {
                        return Some(text.trim().to_string());
                    }
                }
            }
        }

        if let Some(line) = plain_text.lines().find(|line| !line.trim().is_empty()) {
            return Some(line.trim().to_string());
        }

        if !fallback_id.is_empty() {
            return Some(fallback_id.to_string());
        }

        None
    }

    fn match_toc_label(
        toc_labels: &HashMap<PathBuf, String>,
        resource_path: &Path,
    ) -> Option<String> {
        for (candidate, label) in toc_labels {
            if resource_path.ends_with(candidate) {
                return Some(label.clone());
            }
        }
        None
    }

    fn build_toc_entries(nav: &[NavPoint]) -> Vec<TocEntry> {
        nav.iter()
            .map(|point| TocEntry {
                label: point.label.clone(),
                href: Self::normalize_nav_path(&point.content)
                    .to_string_lossy()
                    .to_string(),
                children: Self::build_toc_entries(&point.children),
            })
            .collect()
    }

    fn html_to_blocks(html: &str) -> Vec<ChapterBlock> {
        let mut blocks = Vec::new();
        let mut index = 0usize;
        while let Some(open_rel) = html[index..].find('<') {
            let open_idx = index + open_rel;
            let remaining = &html[open_idx + 1..];
            let close_tag_end = match remaining.find('>') {
                Some(end) => end,
                None => break,
            };
            let tag_body = remaining[..close_tag_end].trim();
            if tag_body.is_empty()
                || tag_body.starts_with('!')
                || tag_body.starts_with('?')
                || tag_body.starts_with('/')
            {
                index = open_idx + close_tag_end + 1;
                continue;
            }

            let mut first_token = tag_body.split_whitespace().next().unwrap_or("").trim();
            let self_closing = first_token.ends_with('/');
            if self_closing {
                first_token = first_token.trim_end_matches('/');
            }
            let tag_name_owned = first_token.to_ascii_lowercase();
            let tag_name = tag_name_owned.as_str();
            let tag_end_index = open_idx + close_tag_end + 1;

            if self_closing {
                if tag_name == "br" {
                    blocks.push(ChapterBlock::Paragraph {
                        spans: vec![TextSpan {
                            text: String::new(),
                            bold: false,
                            italic: false,
                        }],
                    });
                }
                index = tag_end_index;
                continue;
            }

            let closing_tag = format!("</{}>", tag_name);
            if let Some(close_rel) = html[tag_end_index..].find(&closing_tag) {
                let content_start = tag_end_index;
                let content_end = tag_end_index + close_rel;
                let inner = &html[content_start..content_end];
                let text = Self::html_fragment_to_text(inner);
                if !text.trim().is_empty() {
                    match tag_name {
                        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                            let level = tag_name.trim_start_matches('h').parse::<u8>().unwrap_or(1);
                            blocks.push(ChapterBlock::Heading {
                                level,
                                spans: vec![TextSpan {
                                    text: text.trim().to_string(),
                                    bold: false,
                                    italic: false,
                                }],
                            });
                        }
                        "p" | "blockquote" => {
                            blocks.push(ChapterBlock::Paragraph {
                                spans: vec![TextSpan {
                                    text: text.trim().to_string(),
                                    bold: false,
                                    italic: false,
                                }],
                            });
                        }
                        "li" => {
                            blocks.push(ChapterBlock::Paragraph {
                                spans: vec![TextSpan {
                                    text: format!("- {}", text.trim()),
                                    bold: false,
                                    italic: false,
                                }],
                            });
                        }
                        _ => {}
                    }
                }
                index = content_end + closing_tag.len();
            } else {
                index = tag_end_index;
            }
        }

        if blocks.is_empty() {
            let fallback = Self::html_to_plain_text(html);
            if !fallback.trim().is_empty() {
                blocks.push(ChapterBlock::Paragraph {
                    spans: vec![TextSpan {
                        text: fallback.trim().to_string(),
                        bold: false,
                        italic: false,
                    }],
                });
            }
        }

        blocks
    }

    fn html_fragment_to_text(fragment: &str) -> String {
        let rendered = html2text::from_read(fragment.as_bytes(), usize::MAX);
        Self::normalize_whitespace(&rendered)
    }

    fn normalize_whitespace(text: &str) -> String {
        text.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn spans_to_text(spans: &[TextSpan]) -> String {
        spans
            .iter()
            .map(|span| span.text.trim())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn blocks_to_plain_text(blocks: &[ChapterBlock]) -> String {
        blocks
            .iter()
            .map(|block| match block {
                ChapterBlock::Heading { spans, .. } | ChapterBlock::Paragraph { spans } => {
                    Self::spans_to_text(spans)
                }
            })
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    fn html_to_plain_text(html: &str) -> String {
        let mut reader = Cursor::new(html.as_bytes());
        from_read(&mut reader, 80).trim().to_string()
    }

    fn map_doc_error(path: &Path, error: DocError) -> EpubError {
        match error {
            DocError::IOError(source) => EpubError::Io {
                path: path.to_path_buf(),
                source,
            },
            other => EpubError::Parse {
                path: path.to_path_buf(),
                source: other,
            },
        }
    }
}
