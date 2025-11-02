import { AppError } from "@core-platform";
import {
  BookMetadata,
  BookModel,
  ManifestItem,
  OpenEpubOptions,
  ResourceStore,
  SpineItemRef,
  TocItem,
} from "./types";
import { parseXml, findFirst, findNodes, getText, XmlNode } from "./xml";
import { ZipArchive } from "./zip";

type EpubInput = string | ArrayBuffer | Uint8Array;

const CONTAINER_PATH = "META-INF/container.xml";
const TEXT_MEDIA_TYPE = /(text\/|xml|html)/i;

export async function openEpub(source: EpubInput, options: OpenEpubOptions = {}): Promise<BookModel> {
  const buffer = await resolveSource(source);
  const archive = new ZipArchive(new Uint8Array(buffer));

  const containerXml = await archive.text(CONTAINER_PATH);
  if (!containerXml) {
    throw new AppError("Unable to locate EPUB container descriptor", {
      code: "EPUB_CONTAINER_MISSING",
      source: CONTAINER_PATH,
      userMessage: "这本书缺少必要的容器文件，无法打开。",
    });
  }

  const opfPath = extractPackagePath(containerXml);
  if (!opfPath) {
    throw new AppError("Unable to determine package document path", {
      code: "EPUB_OPF_MISSING",
      source: CONTAINER_PATH,
      userMessage: "未能识别 EPUB 的主文件（OPF），请检查电子书文件。",
    });
  }

  const packageXml = await archive.text(opfPath);
  if (!packageXml) {
    throw new AppError("Unable to load package document", {
      code: "EPUB_OPF_NOT_FOUND",
      source: opfPath,
      userMessage: "未能读取电子书的核心内容，请确认文件完整。",
    });
  }

  const packageDoc = parseXml(packageXml);
  if (!packageDoc) {
    throw new AppError("Failed to parse package document", {
      code: "EPUB_OPF_PARSE_FAILED",
      source: opfPath,
      userMessage: "未能解析电子书的主文件。",
    });
  }

  const basePath = extractBasePath(opfPath);
  const metadata = extractMetadata(packageDoc);
  const manifest = extractManifest(packageDoc, basePath);
  const spine = extractSpine(packageDoc);
  const toc = await extractToc(archive, manifest);

  const resources = createResourceStore(archive, basePath, manifest);

  return {
    id: options.id ?? crypto.randomUUID(),
    metadata,
    manifest,
    spine,
    toc,
    resources,
  };
}

async function resolveSource(source: EpubInput): Promise<ArrayBuffer> {
  if (typeof source === "string") {
    const file = Bun.file(source);
    if (!(await file.exists())) {
      throw new AppError("EPUB file does not exist", {
        code: "EPUB_FILE_NOT_FOUND",
        source,
        userMessage: "指定的电子书文件不存在。",
      });
    }
    return file.arrayBuffer();
  }

  if (source instanceof ArrayBuffer) {
    return source;
  }

  return source.buffer;
}

function extractPackagePath(containerXml: string): string | null {
  const containerDoc = parseXml(containerXml);
  if (!containerDoc) {
    return null;
  }

  const rootfile = findFirst(containerDoc, "rootfile");
  if (!rootfile) {
    return null;
  }

  const path = rootfile.attributes["full-path"] ?? rootfile.attributes["fullpath"];
  return path ? normalizePath(path) : null;
}

function extractBasePath(opfPath: string): string {
  const parts = opfPath.split("/");
  parts.pop();
  return parts.join("/");
}

function extractMetadata(packageDoc: XmlNode): BookMetadata {
  const metadataNode = findFirst(packageDoc, "metadata");
  if (!metadataNode) {
    return {};
  }

  const readText = (tagName: string) => getText(findFirst(metadataNode, tagName));

  return {
    title: readText("dc:title"),
    creator: readText("dc:creator"),
    language: readText("dc:language"),
    publisher: readText("dc:publisher"),
    description: readText("dc:description"),
  };
}

function extractManifest(packageDoc: XmlNode, basePath: string): Record<string, ManifestItem> {
  const manifestNode = findFirst(packageDoc, "manifest");
  if (!manifestNode) {
    return {};
  }

  const manifest: Record<string, ManifestItem> = {};
  const items = manifestNode.children.filter(child => child.name === "item");

  for (const item of items) {
    const id = item.attributes["id"];
    const href = item.attributes["href"];
    const mediaType = item.attributes["media-type"] ?? item.attributes["mediatype"];

    if (!id || !href || !mediaType) {
      continue;
    }

    manifest[id] = {
      id,
      href: normalizeRelativePath(basePath, href),
      mediaType,
      properties: item.attributes["properties"],
    };
  }

  return manifest;
}

function extractSpine(packageDoc: XmlNode): SpineItemRef[] {
  const spineNode = findFirst(packageDoc, "spine");
  if (!spineNode) {
    return [];
  }

  const refs = spineNode.children.filter(child => child.name === "itemref");
  return refs
    .map(ref => {
      const idref = ref.attributes["idref"];
      if (!idref) return null;
      return {
        idref,
        linear: ref.attributes["linear"] !== "no",
      };
    })
    .filter((item): item is SpineItemRef => item !== null);
}

async function extractToc(archive: ZipArchive, manifest: Record<string, ManifestItem>): Promise<TocItem[]> {
  const navManifestItem = Object.values(manifest).find(item => item.properties?.split(" ").includes("nav"));
  if (navManifestItem) {
    const navContent = await archive.text(navManifestItem.href);
    if (navContent) {
      const navDoc = parseXml(navContent);
      if (navDoc) {
        return parseNavDocument(navDoc, extractBasePath(navManifestItem.href));
      }
    }
  }

  const ncxManifestItem = Object.values(manifest).find(item => item.mediaType === "application/x-dtbncx+xml");
  if (ncxManifestItem) {
    const ncxContent = await archive.text(ncxManifestItem.href);
    if (ncxContent) {
      const ncxDoc = parseXml(ncxContent);
      if (ncxDoc) {
        return parseNcxDocument(ncxDoc, extractBasePath(ncxManifestItem.href));
      }
    }
  }

  return [];
}

function parseNavDocument(doc: XmlNode, basePath: string): TocItem[] {
  const navNodes = findNodes(doc, "nav");
  const tocNode = navNodes.find(node => {
    const type = node.attributes["epub:type"] ?? node.attributes["role"];
    return type?.includes("toc");
  });
  if (!tocNode) {
    return [];
  }

  const listNode = tocNode.children.find(child => child.name === "ol");
  if (!listNode) {
    return [];
  }

  return parseTocList(listNode, basePath);
}

function parseTocList(listNode: XmlNode, basePath: string): TocItem[] {
  const result: TocItem[] = [];
  const entries = listNode.children.filter(child => child.name === "li");

  for (const entry of entries) {
    const anchor = entry.children.find(child => child.name === "a");
    if (!anchor) continue;

    const href = anchor.attributes["href"];
    if (!href) continue;

    const label = getText(anchor) ?? href;
    const childList = entry.children.find(child => child.name === "ol");

    result.push({
      id: crypto.randomUUID(),
      label: label.trim(),
      href: normalizeRelativePath(basePath, href),
      children: childList ? parseTocList(childList, basePath) : undefined,
    });
  }

  return result;
}

function parseNcxDocument(doc: XmlNode, basePath: string): TocItem[] {
  const navMap = findFirst(doc, "navmap");
  if (!navMap) {
    return [];
  }

  const buildItem = (point: XmlNode): TocItem => {
    const labelNode = findFirst(point, "text");
    const contentNode = findFirst(point, "content");

    const rawHref = contentNode?.attributes["src"] ?? "";
    const childrenPoints = point.children.filter(child => child.name === "navpoint");

    return {
      id: point.attributes["id"] ?? crypto.randomUUID(),
      label: (getText(labelNode) ?? "Chapter").trim(),
      href: rawHref ? normalizeRelativePath(basePath, rawHref) : "",
      children: childrenPoints.length > 0 ? childrenPoints.map(buildItem) : undefined,
    };
  };

  const topLevelPoints = navMap.children.filter(child => child.name === "navpoint");
  return topLevelPoints.map(buildItem);
}

function createResourceStore(
  archive: ZipArchive,
  basePath: string,
  manifest: Record<string, ManifestItem>,
): ResourceStore {
  return {
    basePath,
    items: manifest,
    async getContent(href: string) {
      const normalized = normalizeRelativePath(basePath, href);
      const manifestItem = Object.values(manifest).find(item => item.href === normalized);
      if (!manifestItem) {
        return null;
      }

      if (TEXT_MEDIA_TYPE.test(manifestItem.mediaType)) {
        return archive.text(normalized);
      }

      return archive.arrayBuffer(normalized);
    },
  };
}

function normalizeRelativePath(base: string, relative: string): string {
  const [pathPart, suffix] = splitSuffix(relative);

  if (!base) {
    return applySuffix(normalizePath(pathPart), suffix);
  }

  const normalizedBase = normalizePath(base);
  const normalizedPath = normalizePath(pathPart);

  if (normalizedPath.startsWith(`${normalizedBase}/`) || normalizedPath === normalizedBase) {
    return applySuffix(normalizedPath, suffix);
  }

  if (normalizedPath.startsWith("/")) {
    return applySuffix(normalizedPath.slice(1), suffix);
  }

  return applySuffix(normalizePath(`${normalizedBase}/${normalizedPath}`), suffix);
}

function normalizePath(path: string): string {
  const replaced = path.replace(/\\/g, "/");
  const segments = replaced.split("/").filter(segment => segment.length > 0 && segment !== ".");
  const stack: string[] = [];

  for (const segment of segments) {
    if (segment === "..") {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }

  return stack.join("/");
}

function splitSuffix(input: string): [string, string] {
  const [pathWithQuery, fragment] = input.split("#");
  const [pathPart, query] = pathWithQuery.split("?");
  let suffix = "";
  if (query && query.length > 0) {
    suffix += `?${query}`;
  }
  if (fragment && fragment.length > 0) {
    suffix += `#${fragment}`;
  }
  return [pathPart, suffix];
}

function applySuffix(path: string, suffix: string): string {
  return suffix ? `${path}${suffix}` : path;
}

export * from "./types";
