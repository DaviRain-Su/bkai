import { describe, expect, it } from "bun:test";
import { openEpub } from "@epub-parser";

const fixturePath = new URL("./fixtures/test.epub", import.meta.url).pathname;

describe("openEpub", () => {
  it("parses basic metadata, manifest, and spine from file path input", async () => {
    const book = await openEpub(fixturePath);

    expect(book.metadata.title).toBe("Test Book");
    expect(book.metadata.language).toBe("en");

    expect(Object.keys(book.manifest)).toContain("chapter1");
    expect(book.spine).toHaveLength(1);
    expect(book.spine[0]?.idref).toBe("chapter1");
  });

  it("extracts toc entries from navigation document when opened from buffer", async () => {
    const data = await Bun.file(fixturePath).arrayBuffer();
    const book = await openEpub(data);

    expect(book.toc).toHaveLength(1);
    expect(book.toc[0]?.label).toBe("Chapter 1");
    expect(book.toc[0]?.href).toBe("OEBPS/chapter1.xhtml");
  });

  it("handles large chapters without excessive delay", async () => {
    const largeFixturePath = new URL("./fixtures/large.epub", import.meta.url).pathname;
    const buffer = await Bun.file(largeFixturePath).arrayBuffer();

    const start = performance.now();
    const book = await openEpub(buffer);
    const duration = performance.now() - start;

    expect(book.spine).toHaveLength(1);
    expect(duration).toBeLessThan(750);
  });
});
