import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const pixelDiffScript = join(repoRoot, "scripts/effect-pixel-diff.mjs");

describe("effect pixel diff CLI", () => {
  it("passes identical BMP captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-diff-"));
    try {
      const sourcePath = join(dir, "source.bmp");
      const candidatePath = join(dir, "candidate.bmp");
      const image = writeBmp24(2, 2, [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 255, 255],
      ]);
      writeFileSync(sourcePath, image);
      writeFileSync(candidatePath, image);

      const output = execFileSync(process.execPath, [
        pixelDiffScript,
        "--source",
        sourcePath,
        "--candidate",
        candidatePath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.differentPixels).toBe(0);
      expect(report.maxChannelDelta).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails and writes a diff BMP when a pixel exceeds tolerance", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-diff-"));
    try {
      const sourcePath = join(dir, "source.bmp");
      const candidatePath = join(dir, "candidate.bmp");
      const diffPath = join(dir, "diff.bmp");
      writeFileSync(sourcePath, writeBmp24(2, 1, [
        [10, 20, 30, 255],
        [40, 50, 60, 255],
      ]));
      writeFileSync(candidatePath, writeBmp24(2, 1, [
        [10, 20, 30, 255],
        [41, 50, 60, 255],
      ]));

      const result = spawnSync(process.execPath, [
        pixelDiffScript,
        "--source",
        sourcePath,
        "--candidate",
        candidatePath,
        "--out",
        diffPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.differentPixels).toBe(1);
      expect(report.maxChannelDelta).toBe(1);
      expect(readFileSync(diffPath).subarray(0, 2).toString("ascii")).toBe("BM");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeBmp24(width: number, height: number, pixels: Array<[number, number, number, number]>): Buffer {
  const rowStride = Math.floor((24 * width + 31) / 32) * 4;
  const pixelOffset = 54;
  const fileSize = pixelOffset + rowStride * height;
  const buffer = Buffer.alloc(fileSize);

  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(pixelOffset, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(rowStride * height, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const targetY = height - 1 - y;
    const targetRow = pixelOffset + targetY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixels[y * width + x];
      const targetOffset = targetRow + x * 3;
      buffer[targetOffset] = b;
      buffer[targetOffset + 1] = g;
      buffer[targetOffset + 2] = r;
    }
  }

  return buffer;
}
