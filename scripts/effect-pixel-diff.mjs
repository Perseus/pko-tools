#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.source || !args.candidate) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const source = readBmpRgba(readFileSync(args.source));
const candidate = readBmpRgba(readFileSync(args.candidate));
const report = compareImages(source, candidate, {
  channelTolerance: args.channelTolerance,
  maxDifferentPixels: args.maxDifferentPixels,
});

if (args.out) {
  writeFileSync(args.out, writeBmp24(buildDiffImage(source, candidate, args.channelTolerance)));
}

console.log(JSON.stringify({
  source: args.source,
  candidate: args.candidate,
  diff: args.out ?? null,
  ...report,
}, null, 2));

process.exit(report.pass ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    source: "",
    candidate: "",
    out: "",
    channelTolerance: 0,
    maxDifferentPixels: 0,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--source":
        parsed.source = requireValue(argv, ++i, arg);
        break;
      case "--candidate":
        parsed.candidate = requireValue(argv, ++i, arg);
        break;
      case "--out":
        parsed.out = requireValue(argv, ++i, arg);
        break;
      case "--channel-tolerance":
        parsed.channelTolerance = parseNonNegativeInt(requireValue(argv, ++i, arg), arg);
        break;
      case "--max-different-pixels":
        parsed.maxDifferentPixels = parseNonNegativeInt(requireValue(argv, ++i, arg), arg);
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${arg}`);
  }
  return value;
}

function parseNonNegativeInt(value, arg) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${arg} must be a non-negative integer`);
  }
  return number;
}

function printUsage() {
  console.log(`Usage:
  node scripts/effect-pixel-diff.mjs --source original.bmp --candidate pko-tools.bmp [options]

Options:
  --out diff.bmp                 Write a magenta-on-difference BMP.
  --channel-tolerance N          Per-channel tolerance before a channel differs. Default: 0.
  --max-different-pixels N       Number of differing pixels allowed before failing. Default: 0.
`);
}

function readBmpRgba(buffer) {
  if (buffer.length < 54 || buffer[0] !== 0x42 || buffer[1] !== 0x4d) {
    throw new Error("Only BMP files with a BM header are supported.");
  }

  const pixelOffset = buffer.readUInt32LE(10);
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (dibHeaderSize < 40) {
    throw new Error(`Unsupported BMP DIB header size: ${dibHeaderSize}`);
  }

  const width = buffer.readInt32LE(18);
  const signedHeight = buffer.readInt32LE(22);
  const planes = buffer.readUInt16LE(26);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);

  if (width <= 0 || signedHeight === 0) {
    throw new Error(`Invalid BMP dimensions: ${width}x${signedHeight}`);
  }
  if (planes !== 1) {
    throw new Error(`Unsupported BMP plane count: ${planes}`);
  }
  if (compression !== 0) {
    throw new Error(`Only uncompressed BMP files are supported; compression=${compression}`);
  }
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error(`Only 24-bit and 32-bit BMP files are supported; bitCount=${bitsPerPixel}`);
  }

  const height = Math.abs(signedHeight);
  const topDown = signedHeight < 0;
  const bytesPerPixel = bitsPerPixel / 8;
  const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const expectedSize = pixelOffset + rowStride * height;
  if (buffer.length < expectedSize) {
    throw new Error(`BMP pixel data is truncated: expected at least ${expectedSize} bytes, got ${buffer.length}`);
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const sourceRow = pixelOffset + sourceY * rowStride;
    const targetRow = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = sourceRow + x * bytesPerPixel;
      const targetOffset = targetRow + x * 4;
      rgba[targetOffset] = buffer[sourceOffset + 2];
      rgba[targetOffset + 1] = buffer[sourceOffset + 1];
      rgba[targetOffset + 2] = buffer[sourceOffset];
      rgba[targetOffset + 3] = bitsPerPixel === 32 ? buffer[sourceOffset + 3] : 255;
    }
  }

  return { width, height, rgba };
}

function compareImages(source, candidate, options) {
  if (source.width !== candidate.width || source.height !== candidate.height) {
    return {
      pass: false,
      reason: "dimension-mismatch",
      width: source.width,
      height: source.height,
      candidateWidth: candidate.width,
      candidateHeight: candidate.height,
      comparedPixels: 0,
      differentPixels: 0,
      maxChannelDelta: 0,
      meanAbsoluteChannelDelta: 0,
    };
  }

  let differentPixels = 0;
  let maxChannelDelta = 0;
  let absoluteDeltaSum = 0;
  const comparedPixels = source.width * source.height;

  for (let i = 0; i < source.rgba.length; i += 4) {
    let pixelDifferent = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(source.rgba[i + channel] - candidate.rgba[i + channel]);
      absoluteDeltaSum += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > options.channelTolerance) {
        pixelDifferent = true;
      }
    }
    if (pixelDifferent) {
      differentPixels += 1;
    }
  }

  return {
    pass: differentPixels <= options.maxDifferentPixels,
    reason: differentPixels <= options.maxDifferentPixels ? "within-threshold" : "pixel-difference-threshold-exceeded",
    width: source.width,
    height: source.height,
    candidateWidth: candidate.width,
    candidateHeight: candidate.height,
    comparedPixels,
    differentPixels,
    maxChannelDelta,
    meanAbsoluteChannelDelta: absoluteDeltaSum / (comparedPixels * 4),
  };
}

function buildDiffImage(source, candidate, channelTolerance) {
  if (source.width !== candidate.width || source.height !== candidate.height) {
    throw new Error("Cannot build a diff image for captures with different dimensions.");
  }

  const rgba = new Uint8Array(source.rgba.length);
  for (let i = 0; i < source.rgba.length; i += 4) {
    let pixelDifferent = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(source.rgba[i + channel] - candidate.rgba[i + channel]) > channelTolerance) {
        pixelDifferent = true;
      }
    }
    if (pixelDifferent) {
      rgba[i] = 255;
      rgba[i + 1] = 0;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    } else {
      rgba[i] = candidate.rgba[i];
      rgba[i + 1] = candidate.rgba[i + 1];
      rgba[i + 2] = candidate.rgba[i + 2];
      rgba[i + 3] = 255;
    }
  }
  return { width: source.width, height: source.height, rgba };
}

function writeBmp24(image) {
  const rowStride = Math.floor((24 * image.width + 31) / 32) * 4;
  const pixelOffset = 54;
  const fileSize = pixelOffset + rowStride * image.height;
  const buffer = Buffer.alloc(fileSize);

  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(pixelOffset, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(image.width, 18);
  buffer.writeInt32LE(image.height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(rowStride * image.height, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);

  for (let y = 0; y < image.height; y += 1) {
    const targetY = image.height - 1 - y;
    const targetRow = pixelOffset + targetY * rowStride;
    const sourceRow = y * image.width * 4;
    for (let x = 0; x < image.width; x += 1) {
      const sourceOffset = sourceRow + x * 4;
      const targetOffset = targetRow + x * 3;
      buffer[targetOffset] = image.rgba[sourceOffset + 2];
      buffer[targetOffset + 1] = image.rgba[sourceOffset + 1];
      buffer[targetOffset + 2] = image.rgba[sourceOffset];
    }
  }

  return buffer;
}
