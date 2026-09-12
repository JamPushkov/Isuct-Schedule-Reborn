// Create a ZIP archive of the project source code.
// Uses Node.js built-in zlib + a minimal ZIP writer (no external deps).
//
// Excludes: node_modules, .next, .git, .env*, dev.log, *.lock, download/

import { createReadStream, statSync, readdirSync, readFileSync } from "fs";
import { join, relative, dirname, basename } from "path";
import { createDeflateRaw, deflateRawSync } from "zlib";
import { Writable } from "stream";

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "out",
  "build",
  "dist",
  "tests",
  "download",
  ".vercel",
  ".zscripts",
  "skills",
  "db",
]);

const EXCLUDE_FILES = new Set([
  "dev.log",
  "server.log",
  "bun.lock",
  ".env",
  ".env.local",
  ".DS_Store",
  ".dev.pid",
]);

const EXCLUDE_PATTERNS = [
  /^\.env/,           // .env, .env.local, .env.production, etc.
  /\.log$/,
  /\.lock$/,
  /\.pid$/,
  /\.gitkeep$/,
  /^\.zscripts\//,    // internal build scripts
  /^skills\//,        // AI skills (not part of the bot)
  /^db\//,            // database files
];

/** Walk a directory and return all file paths (relative to root). */
function walkDir(root: string, dir: string = ""): string[] {
  const fullPath = dir ? join(root, dir) : root;
  let entries: string[];
  try {
    entries = readdirSync(fullPath);
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry) || EXCLUDE_FILES.has(entry)) continue;
    if (EXCLUDE_PATTERNS.some((p) => p.test(entry))) continue;

    const relPath = dir ? join(dir, entry) : entry;
    const absPath = join(fullPath, entry);

    try {
      const stat = statSync(absPath);
      if (stat.isDirectory()) {
        results.push(...walkDir(root, relPath));
      } else if (stat.isFile()) {
        results.push(relPath);
      }
    } catch {
      // skip unreadable
    }
  }
  return results;
}

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  compressed: Buffer;
  method: number; // 0 = stored, 8 = deflate
}

// CRC32 lookup table
const crcTable: number[] = (() => {
  const table = new Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function deflateRawSyncLocal(data: Buffer): Buffer {
  return deflateRawSync(data, { level: 9 });
}

function writeZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const localHeaders: { offset: number; entry: ZipEntry }[] = [];
  let offset = 0;

  // Write local file headers + data
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);          // version needed
    localHeader.writeUInt16LE(0, 6);           // flags
    localHeader.writeUInt16LE(entry.method, 8); // compression method
    localHeader.writeUInt16LE(0, 10);          // mod time
    localHeader.writeUInt16LE(0x0021, 12);     // mod date (Jan 1 1980-ish, but doesn't matter)
    localHeader.writeUInt32LE(entry.crc, 14);  // CRC-32
    localHeader.writeUInt32LE(entry.compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(entry.data.length, 22);       // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);          // filename length
    localHeader.writeUInt16LE(0, 28);           // extra field length

    localHeaders.push({ offset, entry });
    chunks.push(localHeader);
    chunks.push(nameBuf);
    chunks.push(entry.compressed);
    offset += localHeader.length + nameBuf.length + entry.compressed.length;
  }

  // Write central directory
  const centralStart = offset;
  for (const { offset: localOffset, entry } of localHeaders) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);  // signature
    centralHeader.writeUInt16LE(20, 4);           // version made by
    centralHeader.writeUInt16LE(20, 6);           // version needed
    centralHeader.writeUInt16LE(0, 8);            // flags
    centralHeader.writeUInt16LE(entry.method, 10); // compression
    centralHeader.writeUInt16LE(0, 12);           // mod time
    centralHeader.writeUInt16LE(0x0021, 14);     // mod date
    centralHeader.writeUInt32LE(entry.crc, 16);   // CRC-32
    centralHeader.writeUInt32LE(entry.compressed.length, 20); // compressed size
    centralHeader.writeUInt32LE(entry.data.length, 24);       // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28);           // filename length
    centralHeader.writeUInt16LE(0, 30);           // extra field length
    centralHeader.writeUInt16LE(0, 32);           // comment length
    centralHeader.writeUInt16LE(0, 34);           // disk number
    centralHeader.writeUInt16LE(0, 36);           // internal attrs
    centralHeader.writeUInt32LE(0, 38);           // external attrs
    centralHeader.writeUInt32LE(localOffset, 42); // local header offset

    chunks.push(centralHeader);
    chunks.push(nameBuf);
    offset += centralHeader.length + nameBuf.length;
  }
  const centralSize = offset - centralStart;

  // Write end of central directory
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);         // signature
  endRecord.writeUInt16LE(0, 4);                    // disk number
  endRecord.writeUInt16LE(0, 6);                    // disk with central dir
  endRecord.writeUInt16LE(entries.length, 8);       // entries on this disk
  endRecord.writeUInt16LE(entries.length, 10);      // total entries
  endRecord.writeUInt32LE(centralSize, 12);         // central dir size
  endRecord.writeUInt32LE(centralStart, 16);         // central dir offset
  endRecord.writeUInt16LE(0, 20);                    // comment length
  chunks.push(endRecord);

  return Buffer.concat(chunks);
}

/** Create a ZIP archive of the project source code. */
export async function createArchive(rootDir: string): Promise<Buffer> {
  const files = walkDir(rootDir);
  const entries: ZipEntry[] = [];

  for (const file of files) {
    try {
      const data = readFileSync(join(rootDir, file));
      const crc = crc32(data);
      const compressed = deflateRawSyncLocal(data);
      // Use stored method if compression makes it bigger
      const useDeflate = compressed.length < data.length;
      entries.push({
        name: file.replace(/\\/g, "/"),
        data,
        crc,
        compressed: useDeflate ? compressed : data,
        method: useDeflate ? 8 : 0,
      });
    } catch {
      // skip unreadable files
    }
  }

  // Add a README
  const readme = Buffer.from(
    `# ISUCT Schedule Reborn\n\nTelegram bot for ISUCT university schedule.\n\n## Setup\n\n1. Install dependencies: \`bun install\`\n2. Set environment variables in \`.env.local\`:\n   - \`TELEGRAM_BOT_TOKEN\` — your bot token from @BotFather\n   - \`NEXT_PUBLIC_BASE_URL\` — your app URL (for production)\n3. Run dev server: \`bun run dev\`\n4. Open http://localhost:3000\n\n## Deploy\n\nSee the "Подключите своего бота" section at http://localhost:3000#connect\n`,
    "utf8",
  );
  entries.push({
    name: "README.md",
    data: readme,
    crc: crc32(readme),
    compressed: deflateRawSyncLocal(readme),
    method: 8,
  });

  return writeZip(entries);
}
