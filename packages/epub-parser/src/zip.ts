import { inflateRawSync } from "zlib";
import { AppError } from "@core-platform";

const EOCD_SIGNATURE = 0x06054b50;
const CEN_SIGNATURE = 0x02014b50;
const LOC_SIGNATURE = 0x04034b50;

interface ZipEntry {
  path: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipArchive {
  private readonly view: DataView;
  private readonly entries: Map<string, ZipEntry>;
  private readonly decoder = new TextDecoder("utf-8");

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.entries = this.parseCentralDirectory();
  }

  async text(path: string): Promise<string | null> {
    const content = await this.read(path);
    return content ? this.decoder.decode(content) : null;
  }

  async arrayBuffer(path: string): Promise<ArrayBuffer | null> {
    const content = await this.read(path);
    return content ? content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) : null;
  }

  listPaths(): string[] {
    return Array.from(this.entries.keys());
  }

  private async read(path: string): Promise<Uint8Array | null> {
    const normalized = normalizePath(path);
    const entry = this.entries.get(normalized);
    if (!entry) {
      return null;
    }

    const localHeaderOffset = entry.localHeaderOffset;
    const signature = this.view.getUint32(localHeaderOffset, true);
    if (signature !== LOC_SIGNATURE) {
      throw new AppError("Invalid ZIP local file header signature", {
        code: "ZIP_LOCAL_HEADER_INVALID",
        source: path,
      });
    }

    const fileNameLength = this.view.getUint16(localHeaderOffset + 26, true);
    const extraLength = this.view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
    const compressedData = this.data.subarray(dataStart, dataStart + entry.compressedSize);

    switch (entry.compression) {
      case 0:
        return compressedData;
      case 8:
        return inflateRawSync(compressedData);
      default:
        throw new AppError("Unsupported compression method", {
          code: "ZIP_COMPRESSION_UNSUPPORTED",
          source: path,
          userMessage: `暂不支持的压缩算法（method=${entry.compression}）`,
        });
    }
  }

  private parseCentralDirectory(): Map<string, ZipEntry> {
    const eocdOffset = this.findEndOfCentralDirectory();
    if (eocdOffset < 0) {
      throw new AppError("Unable to locate ZIP central directory", {
        code: "ZIP_EOCD_NOT_FOUND",
      });
    }

    const totalEntries = this.view.getUint16(eocdOffset + 10, true);
    const centralDirectoryOffset = this.view.getUint32(eocdOffset + 16, true);

    const entries = new Map<string, ZipEntry>();
    let offset = centralDirectoryOffset;

    for (let i = 0; i < totalEntries; i += 1) {
      const signature = this.view.getUint32(offset, true);
      if (signature !== CEN_SIGNATURE) {
        throw new AppError("Invalid ZIP central directory signature", {
          code: "ZIP_CENTRAL_DIRECTORY_INVALID",
          source: offset.toString(),
        });
      }

      const compression = this.view.getUint16(offset + 10, true);
      const compressedSize = this.view.getUint32(offset + 20, true);
      const uncompressedSize = this.view.getUint32(offset + 24, true);
      const fileNameLength = this.view.getUint16(offset + 28, true);
      const extraLength = this.view.getUint16(offset + 30, true);
      const commentLength = this.view.getUint16(offset + 32, true);
      const localHeaderOffset = this.view.getUint32(offset + 42, true);

      const nameStart = offset + 46;
      const nameEnd = nameStart + fileNameLength;
      const fileName = this.decoder.decode(this.data.subarray(nameStart, nameEnd));

      entries.set(normalizePath(fileName), {
        path: normalizePath(fileName),
        compression,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset = nameEnd + extraLength + commentLength;
    }

    return entries;
  }

  private findEndOfCentralDirectory(): number {
    const minOffset = Math.max(0, this.data.length - 0x10000);

    for (let offset = this.data.length - 22; offset >= minOffset; offset -= 1) {
      if (this.view.getUint32(offset, true) === EOCD_SIGNATURE) {
        return offset;
      }
    }

    return -1;
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
