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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_book(chapter_count: usize) -> Book {
        let mut book = Book::empty();
        book.content.chapters = (0..chapter_count)
            .map(|idx| Chapter {
                id: format!("chapter-{idx}"),
                title: Some(format!("Chapter {idx}")),
                href: format!("chapter-{idx}.xhtml"),
                blocks: Vec::new(),
                plain_text: format!("Chapter {idx} content"),
            })
            .collect();
        book
    }

    #[test]
    fn sets_initial_chapter_when_book_has_content() {
        let book = sample_book(3);
        let mut state = ReaderState::default();
        state.set_active_book(book.clone());

        assert_eq!(state.current_chapter, Some(0));
        assert_eq!(
            state.current_chapter().map(|(chapter, _)| chapter.id.clone()),
            book.content.chapters.first().map(|c| c.id.clone())
        );
    }

    #[test]
    fn next_and_previous_chapter_navigation() {
        let book = sample_book(2);
        let mut state = ReaderState::default();
        state.set_active_book(book);

        assert!(state.next_chapter());
        assert_eq!(state.current_chapter, Some(1));

        // Cannot advance past the final chapter.
        assert!(!state.next_chapter());
        assert_eq!(state.current_chapter, Some(1));

        assert!(state.previous_chapter());
        assert_eq!(state.current_chapter, Some(0));

        // Cannot move before the first chapter.
        assert!(!state.previous_chapter());
        assert_eq!(state.current_chapter, Some(0));
    }

    #[test]
    fn jump_to_chapter_by_href() {
        let book = sample_book(3);
        let mut state = ReaderState::default();
        state.set_active_book(book);

        assert!(state.jump_to_chapter_href("chapter-2.xhtml"));
        assert_eq!(state.current_chapter, Some(2));

        // Href not found should leave the selection unchanged.
        assert!(!state.jump_to_chapter_href("missing.xhtml"));
        assert_eq!(state.current_chapter, Some(2));
    }

    #[test]
    fn handles_books_without_chapters() {
        let mut state = ReaderState::default();
        state.set_active_book(Book::empty());

        assert_eq!(state.current_chapter, None);
        assert_eq!(state.chapter_count(), 0);
        assert!(state.current_chapter().is_none());
        assert!(!state.next_chapter());
        assert!(!state.previous_chapter());
    }
}
