use crate::state::ReaderState;
use anyhow::Result;
use gpui::{
    App, Application, Bounds, Context as GpuiContext, FontWeight, KeyBinding, Render, SharedString,
    StatefulInteractiveElement, TitlebarOptions, Window, WindowBounds, WindowOptions, actions, div,
    prelude::*, px, relative, rgb, size,
};
use std::rc::Rc;

actions!([PrevChapterAction, NextChapterAction]);

pub trait UiRuntime {
    fn run(self, initial_state: ReaderState) -> Result<()>;
}

#[derive(Debug, Default)]
pub struct GpuiRuntime;

struct ReaderView {
    state: ReaderState,
}

impl ReaderView {
    fn new(state: ReaderState) -> Self {
        Self { state }
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
                    cx.notify();
                }
            }))
            .child(Self::nav_button(cx, "Next", has_next, |this, cx| {
                if this.state.next_chapter() {
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
            cx.notify();
        }
    }
}

impl Render for ReaderView {
    fn render(&mut self, _window: &mut Window, cx: &mut GpuiContext<Self>) -> impl IntoElement {
        let header = div().child(div().text_2xl().child("BKAI EPUB Reader"));

        let body = match &self.state.active_book {
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

                let chapter_view = match self.state.current_chapter() {
                    Some((chapter, index)) => {
                        let chapter_title = chapter
                            .title
                            .clone()
                            .unwrap_or_else(|| format!("Chapter {}", index + 1));
                        let paragraphs: Vec<_> = chapter
                            .content
                            .split("\n\n")
                            .map(|block| block.trim())
                            .filter(|block| !block.is_empty())
                            .map(|block| {
                                let normalized = block
                                    .lines()
                                    .map(str::trim)
                                    .filter(|line| !line.is_empty())
                                    .collect::<Vec<_>>()
                                    .join(" ");
                                div()
                                    .text_sm()
                                    .line_height(relative(1.6))
                                    .text_color(rgb(0xe5e7eb))
                                    .child(normalized)
                            })
                            .collect();

                        let content = if paragraphs.is_empty() {
                            div()
                                .text_sm()
                                .text_color(rgb(0x9ca3af))
                                .child("This chapter has no visible text.")
                        } else {
                            div().flex().flex_col().gap_3().children(paragraphs)
                        };
                        div()
                            .flex()
                            .flex_col()
                            .flex_grow()
                            .min_h(px(0.))
                            .gap_3()
                            .p_4()
                            .rounded_md()
                            .bg(rgb(0x1f2937))
                            .child(
                                div()
                                    .text_lg()
                                    .font_weight(FontWeight::BOLD)
                                    .child(chapter_title),
                            )
                            .child(content)
                    }
                    None => div()
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
