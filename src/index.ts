import { serve } from "bun";
import index from "./index.html";
import { openEpub } from "@epub-parser";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    "/api/epub": {
      async POST(req) {
        try {
          const formData = await req.formData();
          const file = formData.get("file");

          if (!file || !(file instanceof Blob)) {
            return new Response(JSON.stringify({ error: "缺少电子书文件" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const buffer = await file.arrayBuffer();
          const book = await openEpub(buffer);

          const cssResources = await Promise.all(
            Object.values(book.manifest)
              .filter(resource => resource.mediaType.includes("css"))
              .map(async resource => {
                const content = await book.resources.getContent(resource.href);
                if (content == null) return null;
                const css = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
                return {
                  id: resource.id,
                  href: resource.href,
                  css,
                };
              }),
          );

          const cssList = cssResources.filter((entry): entry is { id: string; href: string; css: string } => entry !== null);

          const chapters = await Promise.all(
            book.spine.map(async (item, index) => {
              const manifestItem = book.manifest[item.idref];
              if (!manifestItem) return null;

              if (!manifestItem.mediaType.includes("html") && !manifestItem.mediaType.includes("xml") && !manifestItem.mediaType.startsWith("text/")) {
                return null;
              }

              const content = await book.resources.getContent(manifestItem.href);
              if (content == null) return null;

              const text =
                typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);

              return {
                index,
                idref: item.idref,
                href: manifestItem.href,
                mediaType: manifestItem.mediaType,
                content: text,
                styles: cssList,
              };
            }),
          );

          const payload = {
            id: book.id,
            metadata: book.metadata,
            toc: book.toc,
            spine: book.spine,
            manifest: book.manifest,
            chapters: chapters
              .filter((chapter): chapter is NonNullable<typeof chapter> => chapter !== null)
              .map(chapter => ({
                ...chapter,
                styles: chapter.styles.map(style => style.css),
              })),
          };

          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Failed to parse EPUB:", error);
          return new Response(JSON.stringify({ error: "解析失败，请确认文件是否正确。" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
