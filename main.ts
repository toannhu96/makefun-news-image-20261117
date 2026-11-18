import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function scriptDir(): string {
  // Resolve relative to this file, not the current working directory.
  return path.dirname(fileURLToPath(import.meta.url));
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const MAX_SOURCE_BYTES = 1048576; // 1 MiB

const PNG_SIGNATURE =Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hex(buf: Buffer): string {
  return [...buf].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

// Re-read the written file from disk and confirm it begins with the PNG
// signature. On mismatch (or read error), remove the bad output and exit 1.
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

  try {
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    console.error(`Warning: could not delete ${filePath}: ${(err as Error).message}`);
  }

  if (readError !== undefined) {
    fail(`could not verify ${filePath}: ${readError}; output file deleted`);
  }
  fail(
    `${filePath} is not a valid PNG: expected signature ${hex(PNG_SIGNATURE)}, ` +
      `got ${bytesRead ? hex(actual) : "(empty file)"}` +
      `${bytesRead < PNG_SIGNATURE.length ? ` (only ${bytesRead} bytes)` : ""}; output file deleted`,
  );
}

function main(): void {
  const srcPath = path.join(scriptDir(), "entry.png");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const destPath = path.join(outDir, "entry.png");

  let data: Buffer;
  try {
    const stat = fs.statSync(srcPath);
    if (!stat.isFile()) fail(`source is not a regular file: ${srcPath}`);
    if (stat.size === 0) fail(`source file is empty (0 bytes): ${srcPath}`);
    if (stat.size > MAX_SOURCE_BYTES) {
      fail(`source file is too large: ${srcPath} is ${stat.size} bytes (limit ${MAX_SOURCE_BYTES} bytes / 1 MiB)`);
    }
    data = fs.readFileSync(srcPath);
    // Re-check after reading in case the file changed between stat and read.
    if (data.length === 0) fail(`source file is empty (0 bytes): ${srcPath}`);
    if (data.length > MAX_SOURCE_BYTES) {
      fail(`source file is too large: ${srcPath} is ${data.length} bytes (limit ${MAX_SOURCE_BYTES} bytes / 1 MiB)`);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") fail(`entry.png not found at ${srcPath}`);
    fail(`cannot read ${srcPath}: ${e.message}`);
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err) {
    fail(`cannot create output directory ${outDir}: ${(err as Error).message}`);
  }

  try {
    fs.writeFileSync(destPath, data);
  } catch (err) {
    fail(`cannot write ${destPath}: ${(err as Error).message}`);
  }

  verifyPngSignature(destPath);

  console.log(`Wrote ${data.length} bytes to ${destPath}`);
}

main();
