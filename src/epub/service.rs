use super::{
    Book, BookContent, BookId, BookMetadata, Chapter, ChapterBlock, ManifestItem, Spine, TextSpan,
    TocEntry,
};
use anyhow::Result;
use epub::doc::{DocError, EpubDoc, NavPoint, SpineItem};
use html2text::render::text_renderer::{RichAnnotation, TaggedLine};
use html2text::{from_read, parse};
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
        let render_tree = parse(Cursor::new(html.as_bytes()));
        let lines = render_tree.render_rich(4096).into_lines();
        Self::blocks_from_tagged_lines(lines)
    }

    fn blocks_from_tagged_lines(lines: Vec<TaggedLine<Vec<RichAnnotation>>>) -> Vec<ChapterBlock> {
        let mut blocks = Vec::new();
        let mut paragraph_spans: Vec<TextSpan> = Vec::new();
        let mut i = 0;

        while i < lines.len() {
            let line = &lines[i];
            let raw_line = line.clone().into_string();
            let trimmed = raw_line.trim();

            if trimmed.is_empty() {
                Self::flush_paragraph_spans(&mut paragraph_spans, &mut blocks);
                i += 1;
                continue;
            }

            if let Some(level) = Self::underline_heading_level(
                lines
                    .get(i + 1)
                    .map(|l| l.clone().into_string())
                    .as_ref()
                    .map(|s| s.trim()),
            ) {
                Self::flush_paragraph_spans(&mut paragraph_spans, &mut blocks);
                blocks.push(ChapterBlock::Heading {
                    level,
                    spans: vec![TextSpan::plain(trimmed)],
                });
                i += 2;
                continue;
            }

            if let Some((level, text)) = Self::parse_hash_heading(trimmed) {
                Self::flush_paragraph_spans(&mut paragraph_spans, &mut blocks);
                blocks.push(ChapterBlock::Heading {
                    level,
                    spans: vec![TextSpan::plain(text)],
                });
                i += 1;
                continue;
            }

            if let Some((prefix, text)) = Self::parse_list_item(trimmed) {
                Self::flush_paragraph_spans(&mut paragraph_spans, &mut blocks);
                blocks.push(ChapterBlock::Paragraph {
                    spans: vec![TextSpan::plain(format!("{}{}", prefix, text.trim()))],
                });
                i += 1;
                continue;
            }

            let spans = Self::spans_from_line(line);
            let needs_space = !paragraph_spans.is_empty();
            Self::append_spans(&mut paragraph_spans, spans, needs_space);
            i += 1;
        }

        Self::flush_paragraph_spans(&mut paragraph_spans, &mut blocks);

        if blocks.is_empty() {
            let fallback_lines = lines
                .into_iter()
                .map(|line| line.into_string())
                .collect::<Vec<_>>()
                .join("\n");
            let condensed = Self::normalize_whitespace(&fallback_lines);
            if !condensed.trim().is_empty() {
                blocks.push(ChapterBlock::Paragraph {
                    spans: vec![TextSpan::plain(condensed.trim())],
                });
            }
        }

        blocks
    }

    fn flush_paragraph_spans(paragraph: &mut Vec<TextSpan>, blocks: &mut Vec<ChapterBlock>) {
        if paragraph.is_empty() {
            return;
        }
        let merged = Self::merge_spans(std::mem::take(paragraph));
        let text = Self::spans_to_text(&merged);
        if !text.trim().is_empty() {
            blocks.push(ChapterBlock::Paragraph { spans: merged });
        }
    }

    fn underline_heading_level(next_line: Option<&str>) -> Option<u8> {
        let line = next_line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return None;
        }
        if trimmed.chars().all(|c| c == '=') {
            Some(1)
        } else if trimmed.chars().all(|c| c == '-') {
            Some(2)
        } else {
            None
        }
    }

    fn parse_hash_heading(line: &str) -> Option<(u8, &str)> {
        if !line.starts_with('#') {
            return None;
        }
        let level = line.chars().take_while(|c| *c == '#').count().min(6) as u8;
        let text = line[level as usize..].trim();
        if text.is_empty() {
            None
        } else {
            Some((level.max(1), text))
        }
    }

    fn parse_list_item(line: &str) -> Option<(&'static str, String)> {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed
            .strip_prefix("* ")
            .or_else(|| trimmed.strip_prefix("- "))
            .or_else(|| trimmed.strip_prefix("+ "))
        {
            return Some(("• ", rest.to_string()));
        }

        let mut chars = trimmed.chars().peekable();
        let mut digits = String::new();
        while let Some(&ch) = chars.peek() {
            if ch.is_ascii_digit() {
                digits.push(ch);
                chars.next();
            } else {
                break;
            }
        }
        if !digits.is_empty() && chars.peek() == Some(&'.') {
            chars.next();
            let rest: String = chars.collect();
            return Some(("• ", rest.trim_start().to_string()));
        }
        None
    }

    fn spans_from_line(line: &TaggedLine<Vec<RichAnnotation>>) -> Vec<TextSpan> {
        let mut spans = Vec::new();
        for tagged in line.tagged_strings() {
            if tagged.s.is_empty() {
                continue;
            }
            let bold = tagged
                .tag
                .iter()
                .any(|ann| matches!(ann, RichAnnotation::Strong));
            let italic = tagged
                .tag
                .iter()
                .any(|ann| matches!(ann, RichAnnotation::Emphasis));
            let mut text = tagged.s.trim().to_string();
            if text.is_empty() {
                continue;
            }
            if bold || italic {
                text = text
                    .trim_matches(|c| c == '*' || c == '_')
                    .trim()
                    .to_string();
            }
            if text.is_empty() {
                continue;
            }
            spans.push(TextSpan::styled(text, bold, italic));
        }
        spans
    }

    fn append_spans(target: &mut Vec<TextSpan>, spans: Vec<TextSpan>, insert_space: bool) {
        let mut first = true;
        for span in spans.into_iter().filter(|s| !s.text.is_empty()) {
            if insert_space && first && !target.is_empty() {
                if !target.last().unwrap().text.ends_with(' ') {
                    target.last_mut().unwrap().text.push(' ');
                }
            }
            Self::push_span(target, span);
            first = false;
        }
    }

    fn push_span(target: &mut Vec<TextSpan>, span: TextSpan) {
        if span.text.is_empty() {
            return;
        }
        if let Some(last) = target.last_mut() {
            if last.bold == span.bold && last.italic == span.italic {
                if !last.text.ends_with(' ') && !span.text.starts_with(' ') {
                    last.text.push(' ');
                }
                last.text.push_str(&span.text);
                return;
            }
        }
        target.push(span);
    }

    fn merge_spans(spans: Vec<TextSpan>) -> Vec<TextSpan> {
        let mut merged: Vec<TextSpan> = Vec::new();
        for span in spans {
            Self::push_span(&mut merged, span);
        }
        merged
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

#[cfg(test)]
mod tests {
    use super::*;

    fn spans_text(spans: &[TextSpan]) -> Vec<(String, bool, bool)> {
        spans
            .iter()
            .map(|span| (span.text.clone(), span.bold, span.italic))
            .collect()
    }

    #[test]
    fn html_to_blocks_extracts_headings_and_paragraphs() {
        let html = r#"
            <h1>Title</h1>
            <p>Hello <strong>world</strong> and <em>friends</em>.</p>
        "#;

        let blocks = EpubService::html_to_blocks(html);
        assert_eq!(blocks.len(), 2);

        match &blocks[0] {
            ChapterBlock::Heading { level, spans } => {
                assert_eq!(*level, 1);
                assert_eq!(
                    spans_text(spans),
                    vec![("Title".to_string(), false, false)]
                );
            }
            other => panic!("expected heading block, got {other:?}"),
        }

        match &blocks[1] {
            ChapterBlock::Paragraph { spans } => {
                assert_eq!(
                    spans_text(spans),
                    vec![
                        ("Hello".to_string(), false, false),
                        ("world".to_string(), true, false),
                        ("and".to_string(), false, false),
                        ("friends".to_string(), false, true),
                        (".".to_string(), false, false)
                    ]
                );
            }
            other => panic!("expected paragraph block, got {other:?}"),
        }
    }

    #[test]
    fn blocks_to_plain_text_preserves_separation() {
        let blocks = vec![
            ChapterBlock::Heading {
                level: 1,
                spans: vec![TextSpan::plain("Title")],
            },
            ChapterBlock::Paragraph {
                spans: vec![
                    TextSpan::plain("First paragraph"),
                    TextSpan::plain("continued"),
                ],
            },
            ChapterBlock::Paragraph {
                spans: vec![TextSpan::plain("Second paragraph")],
            },
        ];

        let text = EpubService::blocks_to_plain_text(&blocks);
        assert_eq!(
            text,
            "Title\n\nFirst paragraph continued\n\nSecond paragraph"
        );
    }

    #[test]
    fn derive_chapter_title_prefers_toc_labels() {
        let mut toc_labels = HashMap::new();
        toc_labels.insert(PathBuf::from("chapter1.xhtml"), "Chapter One".to_string());

        let blocks = vec![ChapterBlock::Paragraph {
            spans: vec![TextSpan::plain("Fallback paragraph")],
        }];

        let title = EpubService::derive_chapter_title(
            &toc_labels,
            Path::new("chapter1.xhtml"),
            &blocks,
            "",
            "chapter-1",
        );

        assert_eq!(title.as_deref(), Some("Chapter One"));
    }

    #[test]
    fn derive_chapter_title_falls_back_to_text_and_id() {
        let toc_labels = HashMap::new();
        let blocks = vec![
            ChapterBlock::Paragraph {
                spans: vec![TextSpan::plain("   ")],
            },
            ChapterBlock::Paragraph {
                spans: vec![TextSpan::plain("Some intro text")],
            },
        ];

        let title = EpubService::derive_chapter_title(
            &toc_labels,
            Path::new("content/chapter2.xhtml"),
            &blocks,
            "",
            "chapter-2",
        );

        assert_eq!(title.as_deref(), Some("Some intro text"));

        let empty_blocks = vec![];
        let title_from_plain = EpubService::derive_chapter_title(
            &toc_labels,
            Path::new("content/chapter3.xhtml"),
            &empty_blocks,
            "Plain text fallback",
            "chapter-3",
        );
        assert_eq!(title_from_plain.as_deref(), Some("Plain text fallback"));

        let title_from_id = EpubService::derive_chapter_title(
            &toc_labels,
            Path::new("content/chapter4.xhtml"),
            &empty_blocks,
            "",
            "chapter-4",
        );
        assert_eq!(title_from_id.as_deref(), Some("chapter-4"));
    }
}
