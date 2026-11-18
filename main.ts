import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Copies entry.png (next to this script) into $MAKEFUN_OUTPUT_DIR (default
// /output), then re-reads the copy to confirm it is a PNG. Any failure prints
// "Error: ..." to stderr and exits 1; a bad output file is removed.

/** Source files outside 1..MAX_SOURCE_BYTES bytes are rejected. */
const MAX_SOURCE_BYTES = 1048576; // 1 MiB

/** The 8-byte magic number every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Directory containing this script, so the source path doesn't depend on the cwd. */
function scriptDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/** Print an error to stderr and exit with status 1. */
function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Format bytes as space-separated uppercase hex, e.g. "89 50 4E 47". */
function hex(buf: Buffer): string {
  return [...buf].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/** Exit with an error unless 1 <= size <= MAX_SOURCE_BYTES. */
function checkSourceSize(srcPath: string, size: number): void {
  if (size === 0) fail(`source file is empty: ${srcPath} (0 bytes)`);
  if (size > MAX_SOURCE_BYTES) {
    fail(`source file is too large: ${srcPath} (${size} bytes, limit ${MAX_SOURCE_BYTES} bytes / 1 MiB)`);
  }
}

/**
 * Re-read the written file from disk (not the in-memory buffer) and confirm
 * it starts with the PNG signature. On mismatch or read error, delete the
 * output and exit 1.
 */
function verifyPngSignature(filePath: string): void {
  const header = Buffer.alloc(PNG_SIGNATURE.length);
  let bytesRead = 0;
  let readError: string | undefined;
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    readError = (err as Error).message;
  }

  const actual = header.subarray(0, bytesRead);
  if (readError === undefined && actual.equals(PNG_SIGNATURE)) return;

  // Remove the bad output so nothing downstream picks it up.
  let cleanup = "output file deleted";
  try {
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    console.error(`Warning: cannot delete output file ${filePath}: ${(err as Error).message}`);
    cleanup = "output file could not be deleted";
  }

  if (readError !== undefined) {
    fail(`cannot verify output file ${filePath}: ${readError}; ${cleanup}`);
  }
  const got = bytesRead === 0 ? "(empty file)" : hex(actual);
  const short = bytesRead < PNG_SIGNATURE.length ? ` (only ${bytesRead} bytes)` : "";
  fail(
    `output file is not a valid PNG: ${filePath} ` +
      `(expected signature ${hex(PNG_SIGNATURE)}, got ${got}${short}); ${cleanup}`,
  );
}

function main(): void {
  const srcPath = path.join(scriptDir(), "entry.png");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const destPath = path.join(outDir, "entry.png");

  // Note: fail() exits the process, so calls inside a try are not caught below.
  let data: Buffer;
  try {
    // Check the size before reading so an oversized file is never loaded.
    const stat = fs.statSync(srcPath);
    if (!stat.isFile()) fail(`source is not a regular file: ${srcPath}`);
    checkSourceSize(srcPath, stat.size);
    data = fs.readFileSync(srcPath);
    // Check again: the file may have changed between stat and read.
    checkSourceSize(srcPath, data.length);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") fail(`source file not found: ${srcPath}`);
    fail(`cannot read source file ${srcPath}: ${e.message}`);
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err) {
    fail(`cannot create output directory ${outDir}: ${(err as Error).message}`);
  }

  try {
    fs.writeFileSync(destPath, data);
  } catch (err) {
    fail(`cannot write output file ${destPath}: ${(err as Error).message}`);
  }

  verifyPngSignature(destPath);

  console.log(`Wrote ${data.length} bytes to ${destPath}`);
}

main();
