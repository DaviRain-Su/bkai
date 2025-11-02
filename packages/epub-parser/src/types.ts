export interface BookMetadata {
  title?: string;
  creator?: string;
  language?: string;
  publisher?: string;
  description?: string;
  [key: string]: string | undefined;
}

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export interface SpineItemRef {
  idref: string;
  linear: boolean;
}

export interface TocItem {
  id: string;
  label: string;
  href: string;
  children?: TocItem[];
}

export interface ResourceStore {
  basePath: string;
  items: Record<string, ManifestItem>;
  getContent: (href: string) => Promise<string | ArrayBuffer | null>;
}

export interface BookModel {
  id: string;
  metadata: BookMetadata;
  spine: SpineItemRef[];
  manifest: Record<string, ManifestItem>;
  toc: TocItem[];
  resources: ResourceStore;
}

export interface OpenEpubOptions {
  id?: string;
}
