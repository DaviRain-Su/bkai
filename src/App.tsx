import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import { createPaginationSession, PageView, PaginationSession } from "@render-engine";
import { createBrowserStateStore, InMemoryStateStore } from "@state-store";

interface TocItem {
  id: string;
  label: string;
  href: string;
  children?: TocItem[];
}

interface ChapterPayload {
  index: number;
  idref: string;
  href: string;
  mediaType: string;
  content: string;
  styles: string[];
}

interface BookMetadata {
  title?: string;
  creator?: string;
  language?: string;
  publisher?: string;
  description?: string;
  [key: string]: string | undefined;
}

interface BookPayload {
  id: string;
  metadata: BookMetadata;
  toc: TocItem[];
  chapters: ChapterPayload[];
}

interface LoadedBook extends BookPayload {
  sourceName: string;
  lastUpdated: number;
}

interface ShadowPageProps {
  html: string;
  styles: string[];
  className?: string;
  inlineStyle?: string;
}

function ShadowPage({ html, styles, className, inlineStyle }: ShadowPageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.innerHTML = "";

    const baseStyle = document.createElement("style");
    baseStyle.textContent = `
      :host {
        color: inherit;
        font: inherit;
      }
      .reader-scope {
        color: var(--reader-text, #0f172a);
        background: var(--reader-bg, #f8fafc);
        font: inherit;
        line-height: 1.7;
        padding: 0;
      }
      .reader-scope p {
        margin: 0 0 1rem 0;
      }
      .reader-scope h1,
      .reader-scope h2,
      .reader-scope h3,
      .reader-scope h4,
      .reader-scope h5,
      .reader-scope h6 {
        margin: 1.5rem 0 1rem;
        font-weight: 600;
      }
      .reader-scope img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 1.5rem auto;
      }
      .reader-scope a {
        color: inherit;
        text-decoration: underline;
      }
    `;
    shadow.appendChild(baseStyle);

    styles.forEach(css => {
      if (!css || css.trim().length === 0) return;
      const styleEl = document.createElement("style");
      styleEl.textContent = css;
      shadow.appendChild(styleEl);
    });

    const container = document.createElement("div");
    container.className = ["reader-scope", className].filter(Boolean).join(" ");
    if (inlineStyle && inlineStyle.trim().length > 0) {
      container.setAttribute("style", inlineStyle);
    }
    container.innerHTML = html;
    shadow.appendChild(container);

    return () => {
      shadow.innerHTML = "";
    };
  }, [html, styles, className, inlineStyle]);

  return (
    <div
      ref={hostRef}
      className="reader-shadow flex-1 overflow-auto rounded-b-xl bg-slate-100 px-6 py-6 text-slate-900"
    />
  );
}

function sanitizeMarkup(content: string) {
  return content
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/xmlns(:\w+)?="[^"]*"/gi, "");
}

function findChapterIndex(chapters: ChapterPayload[], href: string) {
  const target = href.split("#")[0];
  return chapters.findIndex(chapter => chapter.href.split("#")[0] === target);
}

function flattenToc(toc: TocItem[]): TocItem[] {
  const list: TocItem[] = [];
  for (const item of toc) {
    list.push(item);
    if (item.children) {
      list.push(...flattenToc(item.children));
    }
  }
  return list;
}

export function App() {
  const [library, setLibrary] = useState<LoadedBook[]>([]);
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const [readingPositions, setReadingPositions] = useState<
    Record<string, { chapter: number; page: number }>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storeRef = useRef<InMemoryStateStore | null>(null);
  const paginationCacheRef = useRef<Map<string, Map<number, PaginationSession>>>(new Map());
  const loadedProgressRef = useRef<Set<string>>(new Set());
  const [storeReady, setStoreReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const storeInstance = await createBrowserStateStore();
      if (cancelled) return;
      storeRef.current = storeInstance;
      await storeInstance.hydrate();
      if (!cancelled) {
        setStoreReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const store = storeRef.current;

  const getPaginationSession = useCallback(
    (bookId: string, chapter: ChapterPayload, html: string) => {
      let bookCache = paginationCacheRef.current.get(bookId);
      if (!bookCache) {
        bookCache = new Map();
        paginationCacheRef.current.set(bookId, bookCache);
      }

      let session = bookCache.get(chapter.index);
      if (!session) {
        session = createPaginationSession({
          spineIndex: chapter.index,
          html,
        });
        bookCache.set(chapter.index, session);
      }

      return session;
    },
    [],
  );

  const currentBook: LoadedBook | null = useMemo(() => {
    if (library.length === 0) return null;
    if (currentBookId) {
      return library.find(item => item.id === currentBookId) ?? library[0];
    }
    return library[0];
  }, [library, currentBookId]);

  const currentPosition = currentBook
    ? readingPositions[currentBook.id] ?? { chapter: 0, page: 0 }
    : { chapter: 0, page: 0 };
  const currentChapterIndex = currentPosition.chapter;
  const currentPageIndex = currentPosition.page;

  const chapter = currentBook?.chapters[currentChapterIndex];
  const { inlineStyles, contentMarkup, externalStyles, bodyClassName, bodyInlineStyle } = useMemo(() => {
    if (!chapter) {
      return {
        inlineStyles: [] as string[],
        contentMarkup: "",
        externalStyles: [] as string[],
        bodyClassName: "",
        bodyInlineStyle: "",
      };
    }

    const sanitized = sanitizeMarkup(chapter.content);
    const inlineStyleBlocks: string[] = [];
    let bodyClassName = "";
    let bodyInlineStyle = "";
    let bodyContent = sanitized;

    if (typeof DOMParser !== "undefined") {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(sanitized, "text/html");

        const styleNodes = Array.from(doc.querySelectorAll("style"));
        styleNodes.forEach(node => {
          if (node.textContent) {
            inlineStyleBlocks.push(node.textContent);
          }
          node.remove();
        });

        const linkNodes = Array.from(doc.querySelectorAll("link[rel='stylesheet']"));
        linkNodes.forEach(node => node.remove());

        const docBody = doc.body;
        if (docBody) {
          bodyClassName = docBody.className ?? "";
          bodyInlineStyle = docBody.getAttribute("style") ?? "";
          bodyContent = docBody.innerHTML;
        } else {
          bodyContent = doc.documentElement?.innerHTML ?? sanitized;
        }
      } catch {
        bodyContent = sanitized.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
      }
    } else {
      bodyContent = sanitized.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
        inlineStyleBlocks.push(css);
        return "";
      });
    }

    return {
      inlineStyles: inlineStyleBlocks,
      contentMarkup: bodyContent,
      externalStyles: chapter.styles ?? [],
      bodyClassName,
      bodyInlineStyle,
    };
  }, [chapter]);

  const paginationSession = useMemo(() => {
    if (!currentBook || !chapter || !contentMarkup) {
      return null;
    }
    return getPaginationSession(currentBook.id, chapter, contentMarkup);
  }, [currentBook, chapter, contentMarkup, getPaginationSession]);

  const currentPageView: PageView | undefined = paginationSession?.page(currentPageIndex);
  const pageMarkup = useMemo(
    () => (currentPageView ? currentPageView.fragments.map(fragment => fragment.html).join("\n") : ""),
    [currentPageView],
  );
  const totalPages = paginationSession?.totalPages ?? 0;

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async event => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    setLoading(true);
    setError(null);

    const files = Array.from(fileList);
    const results = await Promise.allSettled(
      files.map(async file => {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/epub", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? `上传 ${file.name} 失败`);
        }

        const payload = (await response.json()) as BookPayload;
        const loaded: LoadedBook = {
          ...payload,
          sourceName: file.name,
          lastUpdated: Date.now(),
        };
        return loaded;
      }),
    );

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<LoadedBook> => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (fulfilled.length > 0) {
      setLibrary(prev => {
        const existingIds = new Set(prev.map(item => item.id));
        const additions = fulfilled.map(result => result.value).filter(item => !existingIds.has(item.id));
        return [...prev, ...additions];
      });

      setReadingPositions(prev => {
        const next = { ...prev };
        fulfilled.forEach(({ value }) => {
          if (!next[value.id]) {
            next[value.id] = { chapter: 0, page: 0 };
          }
        });
        return next;
      });

      const lastLoaded = fulfilled[fulfilled.length - 1]?.value;
      if (lastLoaded) {
        setCurrentBookId(lastLoaded.id);
      }
    }

    if (rejected.length > 0) {
      const messages = rejected.map(result =>
        result.reason instanceof Error ? result.reason.message : "未知错误",
      );
      setError(messages.join("；"));
    }

    setLoading(false);
    event.target.value = "";
  };

  const updatePosition = useCallback(
    (bookId: string, updater: (position: { chapter: number; page: number }) => { chapter: number; page: number }) => {
      setReadingPositions(prev => {
        const current = prev[bookId] ?? { chapter: 0, page: 0 };
        const next = updater(current);
        return {
          ...prev,
          [bookId]: {
            chapter: Math.max(0, next.chapter),
            page: Math.max(0, next.page),
          },
        };
      });
    },
    [],
  );

  const handlePrev = () => {
    if (!currentBook || !chapter) return;

    if (paginationSession && currentPageIndex > 0) {
      updatePosition(currentBook.id, position => ({
        chapter: position.chapter,
        page: position.page - 1,
      }));
      return;
    }

    updatePosition(currentBook.id, position => ({
      chapter: Math.max(0, position.chapter - 1),
      page: 0,
    }));
  };

  const handleNext = () => {
    if (!currentBook || !chapter) return;

    if (paginationSession && currentPageIndex < totalPages - 1) {
      updatePosition(currentBook.id, position => ({
        chapter: position.chapter,
        page: position.page + 1,
      }));
      return;
    }

    updatePosition(currentBook.id, position => ({
      chapter: Math.min(
        currentBook.chapters.length - 1,
        position.chapter + 1,
      ),
      page: 0,
    }));
  };

  const handleTocSelect = (href: string) => {
    if (!currentBook) return;
    const index = findChapterIndex(currentBook.chapters, href);
    if (index >= 0) {
      updatePosition(currentBook.id, () => ({
        chapter: index,
        page: 0,
      }));
    }
  };

  const flatToc = useMemo(() => (currentBook ? flattenToc(currentBook.toc) : []), [currentBook]);

  useEffect(() => {
    if (library.length > 0 && !currentBookId) {
      setCurrentBookId(library[0].id);
    }
  }, [library, currentBookId]);

  useEffect(() => {
    if (!store) return;
    library.forEach(bookEntry => {
      if (loadedProgressRef.current.has(bookEntry.id)) return;
      loadedProgressRef.current.add(bookEntry.id);
      void (async () => {
        const progress = await store.loadProgress(bookEntry.id);
        if (!progress) return;
        setReadingPositions(prev => {
          const chapterIndex = bookEntry.chapters.findIndex(ch => ch.index === progress.spineIndex);
          if (chapterIndex < 0) return prev;
          return {
            ...prev,
            [bookEntry.id]: {
              chapter: chapterIndex,
              page: Math.max(0, progress.offset ?? 0),
            },
          };
        });
      })();
    });
  }, [library, store]);

  useEffect(() => {
    if (!store || !currentBook) return;
    const position = readingPositions[currentBook.id];
    if (!position) return;
    const spineChapter = currentBook.chapters[position.chapter];
    if (!spineChapter) return;

    void store.saveProgress(currentBook.id, {
      spineIndex: spineChapter.index,
      offset: position.page,
    });
  }, [currentBook, readingPositions, store]);

  useEffect(() => {
    if (!paginationSession || !currentBook) {
      return;
    }
    if (currentPageIndex >= paginationSession.totalPages) {
      updatePosition(currentBook.id, position => ({
        chapter: position.chapter,
        page: Math.max(0, paginationSession.totalPages - 1),
      }));
    }
  }, [paginationSession, currentBook, currentPageIndex, updatePosition]);

  if (!storeReady || !store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="rounded-lg border border-slate-800 bg-slate-900 px-6 py-4 text-sm text-slate-300">
          正在加载阅读进度...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur py-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">BKAI EPUB 阅读器原型</h1>
            <p className="text-sm text-slate-400">上传本地 .epub 文件，即时解析并阅读。</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700">
            <input
              type="file"
              accept=".epub"
              onChange={handleFileChange}
              disabled={loading}
              multiple
              className="hidden"
            />
            {loading ? "解析中..." : "选择 EPUB 文件"}
          </label>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col gap-6 px-6 py-6 lg:flex-row">
        <aside className="w-full shrink-0 space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 lg:w-72">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>书库</span>
                {library.length > 0 && <span>{library.length}</span>}
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1 text-sm">
                {library.length === 0 && (
                  <p className="text-slate-500">尚未加载电子书，请先选择 `.epub` 文件。</p>
                )}
                {library.map(entry => {
                  const isActive = currentBook?.id === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setCurrentBookId(entry.id)}
                      className={`flex w-full flex-col rounded-md border px-2 py-2 text-left transition ${
                        isActive
                          ? "border-sky-500 bg-sky-500/10 text-sky-100"
                          : "border-transparent hover:border-slate-700 hover:bg-slate-800/60"
                      }`}
                    >
                      <span className="line-clamp-1 text-sm font-medium">
                        {entry.metadata.title ?? entry.sourceName ?? "未命名书籍"}
                      </span>
                      <span className="text-xs text-slate-400">
                        {entry.metadata.creator ?? "未知作者"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {currentBook ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {currentBook.metadata.title ?? currentBook.sourceName ?? "未命名书籍"}
                  </h2>
                  <p className="text-sm text-slate-400">
                    {currentBook.metadata.creator ?? "未知作者"}
                    {currentBook.metadata.publisher ? ` · ${currentBook.metadata.publisher}` : ""}
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-300">章节目录</h3>
                  <nav className="max-h-[40vh] space-y-1 overflow-auto pr-1 text-sm">
                    {flatToc.length === 0 && (
                      <p className="text-slate-500">目录缺失，使用 spine 顺序。</p>
                    )}
                    {flatToc.map(item => {
                      const chapterIndex = findChapterIndex(currentBook.chapters, item.href);
                      const isActive = chapterIndex === currentChapterIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleTocSelect(item.href)}
                          className={`block w-full rounded-md px-2 py-1 text-left ${
                            isActive ? "bg-slate-800 text-sky-200" : "hover:bg-slate-800"
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">选择一本电子书后，可在此浏览目录并跳转章节。</p>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-red-500 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </aside>

        <section className="flex-1 overflow-hidden">
          {!currentBook || !chapter || !paginationSession ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40">
              <p className="max-w-md text-center text-sm text-slate-400">
                选择一个 `.epub` 文件后，将在这里显示章节内容。
              </p>
            </div>
          ) : (
            <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-sm text-slate-300">
                <span>
                  章节 {currentChapterIndex + 1} / {currentBook.chapters.length} · 第 {currentPageIndex + 1} 页 /{" "}
                  {totalPages}
                </span>
                <div className="space-x-2">
                  <button
                    type="button"
                    onClick={handlePrev}
                    disabled={currentChapterIndex === 0 && currentPageIndex === 0}
                    className="rounded border border-slate-700 bg-slate-800 px-3 py-1 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={
                      currentChapterIndex >= currentBook.chapters.length - 1 &&
                      currentPageIndex >= totalPages - 1
                    }
                    className="rounded border border-slate-700 bg-slate-800 px-3 py-1 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>

              <ShadowPage
                html={pageMarkup}
                styles={[...externalStyles, ...inlineStyles]}
                className={bodyClassName}
                inlineStyle={bodyInlineStyle}
              />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
