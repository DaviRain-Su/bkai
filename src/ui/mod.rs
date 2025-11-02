use crate::epub::{ChapterBlock, TextSpan, TocEntry};
use crate::state::ReaderState;
use anyhow::Result;
use gpui::{
    App, Application, Bounds, Context as GpuiContext, Div, FontStyle, FontWeight, HighlightStyle,
    KeyBinding, Render, ScrollHandle, SharedString, Stateful, StatefulInteractiveElement,
    StyledText, TitlebarOptions, Window, WindowBounds, WindowOptions, actions, div, prelude::*, px,
    relative, rgb, size,
};
use std::ops::Range;
use std::rc::Rc;

actions!([PrevChapterAction, NextChapterAction]);

pub trait UiRuntime {
    fn run(self, initial_state: ReaderState) -> Result<()>;
}

#[derive(Debug, Default)]
pub struct GpuiRuntime;

struct ReaderView {
    state: ReaderState,
    chapter_scroll: ScrollHandle,
    toc_scroll: ScrollHandle,
}

impl ReaderView {
    fn new(state: ReaderState) -> Self {
        Self {
            state,
            chapter_scroll: ScrollHandle::new(),
            toc_scroll: ScrollHandle::new(),
        }
    }

    fn nav_button(
        cx: &mut GpuiContext<Self>,
        label: &str,
        enabled: bool,
        handler: impl Fn(&mut Self, &mut GpuiContext<Self>) + 'static,
    ) -> impl IntoElement {
        let mut button = div()
            .id(SharedString::from(format!("nav-{label}")))
            .px_3()
            .py_1()
            .rounded_sm()
            .border_1()
            .border_color(rgb(0x374151))
            .text_sm()
            .text_color(rgb(0xf9fafb));

        if enabled {
            button = button
                .cursor_pointer()
                .active(|this| this.opacity(0.85))
                .on_click(cx.listener(move |this, _, _, cx| {
                    handler(this, cx);
                }));
        } else {
            button = button.opacity(0.4);
        }

        button.child(label.to_string())
    }

    fn chapter_controls(&mut self, cx: &mut GpuiContext<Self>) -> impl IntoElement {
        let total = self.state.chapter_count();
        let (position, has_prev, has_next) = match self.state.current_chapter() {
            Some((_, index)) => (
                format!("Chapter {} / {}", index + 1, total.max(1)),
                index > 0,
                index + 1 < total,
            ),
            None => ("Chapter 0 / 0".to_string(), false, false),
        };

        div()
            .flex()
            .gap_3()
            .items_center()
            .child(Self::nav_button(cx, "Previous", has_prev, |this, cx| {
                if this.state.previous_chapter() {
                    this.chapter_scroll.scroll_to_top_of_item(0);
                    cx.notify();
                }
            }))
            .child(Self::nav_button(cx, "Next", has_next, |this, cx| {
                if this.state.next_chapter() {
                    this.chapter_scroll.scroll_to_top_of_item(0);
                    cx.notify();
                }
            }))
            .child(div().text_sm().text_color(rgb(0x9ca3af)).child(position))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(0x6b7280))
                    .child("Shortcuts: ← / →"),
            )
    }

    fn handle_prev_action(
        &mut self,
        _: &PrevChapterAction,
        _window: &mut Window,
        cx: &mut GpuiContext<Self>,
    ) {
        if self.state.previous_chapter() {
            self.chapter_scroll.scroll_to_top_of_item(0);
            cx.notify();
        }
    }

    fn handle_next_action(
        &mut self,
        _: &NextChapterAction,
        _window: &mut Window,
        cx: &mut GpuiContext<Self>,
    ) {
        if self.state.next_chapter() {
            self.chapter_scroll.scroll_to_top_of_item(0);
            cx.notify();
        }
    }

    fn render_toc(
        &mut self,
        cx: &mut GpuiContext<Self>,
        book: &crate::epub::Book,
    ) -> impl IntoElement {
        if book.content.toc.is_empty() {
            return div()
                .id(SharedString::from("toc-empty"))
                .flex_shrink_0()
                .w(px(0.0))
                .into_element();
        }

        let current_href = self
            .state
            .current_chapter_href()
            .map(|href| href.to_string());

        let entries = self.render_toc_entries(cx, &book.content.toc, 0, current_href.as_deref());

        div()
            .flex()
            .flex_col()
            .flex_shrink_0()
            .w(px(240.0))
            .max_h(px(480.0))
            .bg(rgb(0x1b2533))
            .rounded_md()
            .p_3()
            .gap_2()
            .id(SharedString::from("toc-panel"))
            .track_scroll(&self.toc_scroll)
            .overflow_scroll()
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::BOLD)
                    .text_color(rgb(0xf9fafb))
                    .child("Contents"),
            )
            .children(entries)
    }

    fn render_toc_entries(
        &mut self,
        cx: &mut GpuiContext<Self>,
        entries: &[TocEntry],
        depth: usize,
        current_href: Option<&str>,
    ) -> Vec<Stateful<Div>> {
        let mut result: Vec<Stateful<Div>> = Vec::new();
        for entry in entries {
            let is_active = current_href.map(|href| href == entry.href).unwrap_or(false);
            let indent = 12.0 * depth as f32;
            let href = entry.href.clone();
            let mut row = div()
                .id(SharedString::from(format!("toc-entry-{}-{}", depth, href)))
                .flex()
                .items_center()
                .px_2()
                .py_1()
                .rounded_sm()
                .pl(px(indent + 8.0))
                .cursor_pointer()
                .on_click(cx.listener(move |this, _, _, cx| {
                    if this.state.jump_to_chapter_href(&href) {
                        this.chapter_scroll.scroll_to_top_of_item(0);
                        cx.notify();
                    }
                }))
                .child(entry.label.clone());

            if is_active {
                row = row.bg(rgb(0x243047)).text_color(rgb(0xffffff));
            } else {
                row = row
                    .text_color(rgb(0xd1d5db))
                    .hover(|style| style.bg(rgb(0x243047)));
            }

            result.push(row);

            if !entry.children.is_empty() {
                result.extend(self.render_toc_entries(
                    cx,
                    &entry.children,
                    depth + 1,
                    current_href,
                ));
            }
        }
        result
    }

    fn styled_text_from_spans(&self, spans: &[TextSpan]) -> Option<StyledText> {
        let mut text = String::new();
        let mut highlights: Vec<(Range<usize>, HighlightStyle)> = Vec::new();
        let mut last_char: Option<char> = None;
        let mut first = true;

        for span in spans {
            let trimmed = span.text.trim();
            if trimmed.is_empty() {
                continue;
            }

            if !first && Self::should_insert_space(last_char, trimmed) {
                text.push(' ');
            }

            let start = text.len();
            text.push_str(trimmed);
            let end = text.len();

            if span.bold || span.italic {
                let highlight = HighlightStyle {
                    color: None,
                    font_weight: span.bold.then_some(FontWeight::BOLD),
                    font_style: span.italic.then_some(FontStyle::Italic),
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                    fade_out: None,
                };
                highlights.push((start..end, highlight));
            }

            last_char = text.chars().last();
            first = false;
        }

        if text.trim().is_empty() {
            return None;
        }

        let styled = if highlights.is_empty() {
            StyledText::new(text)
        } else {
            StyledText::new(text).with_highlights(highlights)
        };
        Some(styled)
    }

    fn should_insert_space(prev: Option<char>, next: &str) -> bool {
        let first_char = next.chars().next();
        match (prev, first_char) {
            (_, None) => false,
            (_, Some(',' | '.' | ';' | ':' | '!' | '?' | ')' | ']' | '}')) => false,
            (Some('(' | '[' | '{' | '/'), _) => false,
            _ => true,
        }
    }

    fn render_block(&self, block: &ChapterBlock) -> Option<Div> {
        match block {
            ChapterBlock::Heading { level, spans } => {
                let styled = self.styled_text_from_spans(spans)?;
                let mut heading = div()
                    .child(styled)
                    .font_weight(FontWeight::BOLD)
                    .text_color(rgb(0xf3f4f6));

                heading = match level {
                    1 => heading.text_2xl(),
                    2 => heading.text_xl(),
                    3 => heading.text_lg(),
                    _ => heading.text_base(),
                };
                Some(heading)
            }
            ChapterBlock::Paragraph { spans } => {
                let styled = self.styled_text_from_spans(spans)?;
                Some(
                    div()
                        .text_sm()
                        .line_height(relative(1.6))
                        .text_color(rgb(0xe5e7eb))
                        .child(styled),
                )
            }
        }
    }

    fn render_content_panel(&mut self, cx: &mut GpuiContext<Self>, metadata: Div) -> Div {
        let chapter_view = match self.state.current_chapter() {
            Some((chapter, index)) => {
                let chapter_title = chapter
                    .title
                    .clone()
                    .unwrap_or_else(|| format!("Chapter {}", index + 1));

                let block_elements: Vec<_> = chapter
                    .blocks
                    .iter()
                    .filter_map(|block| self.render_block(block))
                    .collect();

                let content = if block_elements.is_empty() {
                    if chapter.plain_text.trim().is_empty() {
                        div()
                            .text_sm()
                            .text_color(rgb(0x9ca3af))
                            .child("This chapter has no visible text.")
                    } else {
                        div()
                            .text_sm()
                            .line_height(relative(1.6))
                            .text_color(rgb(0xe5e7eb))
                            .child(chapter.plain_text.clone())
                    }
                } else {
                    div().flex().flex_col().gap_3().children(block_elements)
                };

                let scroll_id = SharedString::from(format!("chapter-scroll-{index}"));

                div()
                    .id(scroll_id)
                    .flex()
                    .flex_col()
                    .flex_grow()
                    .flex_basis(px(0.0))
                    .gap_3()
                    .p_4()
                    .rounded_md()
                    .bg(rgb(0x1f2937))
                    .block_mouse_except_scroll()
                    .track_scroll(&self.chapter_scroll)
                    .scrollbar_width(px(12.0))
                    .overflow_scroll()
                    .child(
                        div()
                            .text_lg()
                            .font_weight(FontWeight::BOLD)
                            .child(chapter_title),
                    )
                    .child(content)
            }
            None => div()
                .id("chapter-scroll-empty")
                .flex()
                .flex_col()
                .gap_2()
                .p_4()
                .rounded_md()
                .bg(rgb(0x1f2937))
                .child(div().text_sm().child("No textual chapters detected.")),
        };

        div()
            .flex()
            .flex_col()
            .gap_4()
            .flex_grow()
            .child(metadata)
            .child(self.chapter_controls(cx))
            .child(chapter_view)
    }
}

impl Render for ReaderView {
    fn render(&mut self, _window: &mut Window, cx: &mut GpuiContext<Self>) -> impl IntoElement {
        let header = div().child(div().text_2xl().child("BKAI EPUB Reader"));

        let body = match self.state.active_book.clone() {
            Some(book) => {
                let title = book
                    .metadata
                    .title
                    .clone()
                    .unwrap_or_else(|| "Untitled".to_string());
                let authors = if book.metadata.authors.is_empty() {
                    "Unknown author".to_string()
                } else {
                    book.metadata.authors.join(", ")
                };
                let language = book
                    .metadata
                    .language
                    .clone()
                    .unwrap_or_else(|| "Unknown".to_string());
                let chapter_count = book.content.chapters.len();

                let metadata = div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .text_lg()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(title),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x9ca3af))
                            .child(format!("Authors: {authors}")),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x9ca3af))
                            .child(format!("Language: {language}")),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x9ca3af))
                            .child(format!("Chapters parsed: {chapter_count}")),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(0x6b7280))
                            .child(format!("Source: {}", book.source_path.display())),
                    );
                div()
                    .flex()
                    .gap_6()
                    .flex_grow()
                    .child(self.render_toc(cx, &book))
                    .child(self.render_content_panel(cx, metadata))
            }
            None => div()
                .flex()
                .flex_col()
                .gap_2()
                .flex_grow()
                .child(div().text_lg().child("No book loaded"))
                .child(
                    div()
                        .text_sm()
                        .text_color(rgb(0x9ca3af))
                        .child("Run with an .epub path to load a book."),
                ),
        };

        div()
            .flex()
            .flex_col()
            .size_full()
            .p_6()
            .gap_4()
            .bg(rgb(0x111827))
            .text_color(rgb(0xf9fafb))
            .key_context("ReaderView")
            .child(header)
            .child(body)
    }
}

impl UiRuntime for GpuiRuntime {
    fn run(self, initial_state: ReaderState) -> Result<()> {
        Application::new().run(move |app: &mut App| {
            let window_bounds = Bounds::centered(None, size(px(720.0), px(540.0)), app);
            let reader_handle = match app.open_window(
                WindowOptions {
                    titlebar: Some(TitlebarOptions {
                        title: Some("BKAI EPUB Reader".into()),
                        ..Default::default()
                    }),
                    window_bounds: Some(WindowBounds::Windowed(window_bounds)),
                    ..Default::default()
                },
                {
                    let state_for_window = initial_state.clone();
                    move |_, cx| {
                        let view_state = state_for_window.clone();
                        cx.new(|_| ReaderView::new(view_state))
                    }
                },
            ) {
                Ok(handle) => Rc::new(handle),
                Err(err) => {
                    eprintln!("Failed to open gpui window: {err:?}");
                    return;
                }
            };

            app.bind_keys([
                KeyBinding::new("left", PrevChapterAction, Some("ReaderView")),
                KeyBinding::new("right", NextChapterAction, Some("ReaderView")),
            ]);

            {
                let handle = Rc::clone(&reader_handle);
                app.on_action(move |action: &PrevChapterAction, app| {
                    let action = action.clone();
                    let _ = handle.update(app, |view, window, cx| {
                        view.handle_prev_action(&action, window, cx);
                    });
                });
            }

            {
                let handle = Rc::clone(&reader_handle);
                app.on_action(move |action: &NextChapterAction, app| {
                    let action = action.clone();
                    let _ = handle.update(app, |view, window, cx| {
                        view.handle_next_action(&action, window, cx);
                    });
                });
            }

            app.activate(true);
        });

        Ok(())
    }
}
