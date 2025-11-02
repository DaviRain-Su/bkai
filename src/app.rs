use crate::epub::EpubService;
use crate::state::ReaderState;
use crate::ui::UiRuntime;
use anyhow::Result;
use std::path::Path;

/// High-level application orchestrator that wires parsing, state, and UI.
pub struct ReaderApp<U: UiRuntime> {
    parser: EpubService,
    state: ReaderState,
    ui: U,
}

impl<U: UiRuntime> ReaderApp<U> {
    pub fn new(ui: U) -> Self {
        Self {
            parser: EpubService::default(),
            state: ReaderState::default(),
            ui,
        }
    }

    pub fn open_book(&mut self, path: &Path) -> Result<()> {
        let book = self.parser.open_book(path)?;
        self.state.set_active_book(book);
        Ok(())
    }

    pub fn run(self) -> Result<()> {
        self.ui.run(self.state)
    }
}
