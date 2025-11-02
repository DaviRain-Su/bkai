use crate::epub::{Book, Chapter};
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ReaderState {
    pub active_book: Option<Book>,
    pub current_chapter: Option<usize>,
}

impl ReaderState {
    pub fn set_active_book(&mut self, book: Book) {
        self.current_chapter = if book.content.chapters.is_empty() {
            None
        } else {
            Some(0)
        };
        self.active_book = Some(book);
    }

    pub fn current_chapter(&self) -> Option<(&Chapter, usize)> {
        let index = self.current_chapter?;
        let book = self.active_book.as_ref()?;
        book.content
            .chapters
            .get(index)
            .map(|chapter| (chapter, index))
    }

    pub fn chapter_count(&self) -> usize {
        self.active_book
            .as_ref()
            .map(|book| book.content.chapters.len())
            .unwrap_or(0)
    }

    pub fn current_chapter_href(&self) -> Option<&str> {
        let index = self.current_chapter?;
        let book = self.active_book.as_ref()?;
        book.content
            .chapters
            .get(index)
            .map(|chapter| chapter.href.as_str())
    }

    pub fn next_chapter(&mut self) -> bool {
        let total = self.chapter_count();
        let Some(current) = self.current_chapter else {
            return false;
        };

        if current + 1 < total {
            self.current_chapter = Some(current + 1);
            true
        } else {
            false
        }
    }

    pub fn previous_chapter(&mut self) -> bool {
        let Some(current) = self.current_chapter else {
            return false;
        };

        if current > 0 {
            self.current_chapter = Some(current - 1);
            true
        } else {
            false
        }
    }

    pub fn jump_to_chapter_href(&mut self, href: &str) -> bool {
        let Some(book) = self.active_book.as_ref() else {
            return false;
        };

        if let Some((index, _)) = book
            .content
            .chapters
            .iter()
            .enumerate()
            .find(|(_, chapter)| chapter.href == href)
        {
            self.current_chapter = Some(index);
            true
        } else {
            false
        }
    }
}
