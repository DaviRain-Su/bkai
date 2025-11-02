mod app;
mod epub;
mod state;
mod ui;

use crate::app::ReaderApp;
use crate::ui::GpuiRuntime;
use anyhow::Result;
use std::path::Path;

fn main() -> Result<()> {
    let ui = GpuiRuntime::default();
    let mut app = ReaderApp::new(ui);

    if let Some(path) = std::env::args().nth(1) {
        app.open_book(Path::new(&path))?;
    }

    app.run()
}
