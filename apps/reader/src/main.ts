import { openEpub } from "@epub-parser";
import { InMemoryStateStore } from "@state-store";

export interface ReaderBootstrapOptions {
  epubPath: string;
}

export async function bootstrapReader(options: ReaderBootstrapOptions) {
  const store = new InMemoryStateStore();
  const book = await openEpub(options.epubPath);

  await store.saveProgress(book.id, { spineIndex: 0, offset: 0 });

  return {
    book,
    store,
  };
}

if (import.meta.main) {
  const epubPath = Bun.argv[2];
  if (!epubPath) {
    console.error("Usage: bun apps/reader/src/main.ts <path-to-epub>");
    process.exit(1);
  }

  bootstrapReader({ epubPath })
    .then(({ book }) => {
      console.log(`Loaded book: ${book.metadata.title ?? "Unknown Title"}`);
      console.log(`Chapters in spine: ${book.spine.length}`);
    })
    .catch(error => {
      console.error("Failed to open EPUB:", error);
      process.exit(1);
    });
}
