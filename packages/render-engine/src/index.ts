export interface Viewport {
  width: number;
  height: number;
}

export interface ReadingPrefs {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  pageCharLimit: number;
}

export interface PaginationOptions {
  spineIndex: number;
  html: string;
  viewport?: Viewport;
  prefs?: Partial<ReadingPrefs>;
}

export interface TextFragment {
  html: string;
  textLength: number;
}

export interface PageView {
  id: string;
  spineIndex: number;
  pageIndex: number;
  fragments: TextFragment[];
  textLength: number;
}

export interface PaginationSession {
  readonly totalPages: number;
  page(index: number): PageView | undefined;
  locate(percent: number): PageView | undefined;
  all(): PageView[];
}

const DEFAULT_PREFS: ReadingPrefs = {
  fontSize: 18,
  lineHeight: 1.6,
  fontFamily: "system-ui",
  pageCharLimit: 1600,
};

export function createPaginationSession(options: PaginationOptions): PaginationSession {
  const prefs = { ...DEFAULT_PREFS, ...options.prefs };
  const fragments = splitIntoFragments(options.html);
  const pages = paginateFragments(fragments, prefs.pageCharLimit, options.spineIndex);
  return new BasicPaginationSession(pages);
}

function splitIntoFragments(html: string): TextFragment[] {
  const cleaned = html.replace(/\r\n/g, "\n");

  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${cleaned}</div>`, "text/html");
    const container = doc.body.firstElementChild;

    if (container) {
      const fragments: TextFragment[] = [];
      container.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? "";
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            const escaped = escapeHtml(trimmed);
            fragments.push({
              html: `<p>${escaped}</p>`,
              textLength: trimmed.length,
            });
          }
          return;
        }

        if (node instanceof Element) {
          const content = node.outerHTML;
          const length = stripTags(content).length;
          if (length > 0) {
            fragments.push({
              html: content,
              textLength: length,
            });
          }
        }
      });

      if (fragments.length > 0) {
        return fragments;
      }
    }
  }

  const paragraphRegex =
    /(<(?:p|h[1-6]|li|div|blockquote|pre|section|article|figure)[^>]*>[\s\S]*?<\/(?:p|h[1-6]|li|div|blockquote|pre|section|article|figure)>)/gi;
  const matches = cleaned.match(paragraphRegex);

  if (matches && matches.length > 0) {
    return matches.map(htmlFragment => ({
      html: htmlFragment,
      textLength: stripTags(htmlFragment).length,
    }));
  }

  const plain = cleaned.trim();
  return plain.length > 0
    ? [
        {
          html: `<p>${escapeHtml(plain)}</p>`,
          textLength: stripTags(plain).length,
        },
      ]
    : [];
}

function paginateFragments(fragments: TextFragment[], limit: number, spineIndex: number): PageView[] {
  if (fragments.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        spineIndex,
        pageIndex: 0,
        fragments: [],
        textLength: 0,
      },
    ];
  }

  const pages: PageView[] = [];
  let currentPage: TextFragment[] = [];
  let currentLength = 0;

  const flushPage = () => {
    const htmlFragments = [...currentPage];
    const page: PageView = {
      id: crypto.randomUUID(),
      spineIndex,
      pageIndex: pages.length,
      fragments: htmlFragments,
      textLength: htmlFragments.reduce((sum, fragment) => sum + fragment.textLength, 0),
    };
    pages.push(page);
    currentPage = [];
    currentLength = 0;
  };

  fragments.forEach(fragment => {
    if (currentLength > 0 && currentLength + fragment.textLength > limit) {
      flushPage();
    }

    currentPage.push(fragment);
    currentLength += fragment.textLength;
  });

  if (currentPage.length > 0) {
    flushPage();
  }

  return pages;
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class BasicPaginationSession implements PaginationSession {
  constructor(private readonly pages: PageView[]) {}

  get totalPages() {
    return this.pages.length;
  }

  page(index: number): PageView | undefined {
    if (index < 0 || index >= this.pages.length) {
      return undefined;
    }
    return this.pages[index];
  }

  locate(percent: number): PageView | undefined {
    if (this.pages.length === 0) return undefined;
    const clamped = Math.min(Math.max(percent, 0), 1);
    const index = Math.floor(clamped * (this.pages.length - 1));
    return this.pages[index];
  }

  all(): PageView[] {
    return [...this.pages];
  }
}
