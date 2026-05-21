import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER_RENDER_TIMEOUT_MS = Number(process.env.PKO_BROWSER_RENDER_TIMEOUT_MS) || 20_000;
const edge = findBrowser();

if (!edge) {
  console.error("No supported browser found. Install Microsoft Edge or set EDGE_BIN.");
  process.exit(1);
}

const htmlRelativePath = "scripts/.effect-alpha-smoke.tmp.html";
const htmlPath = join(repoRoot, htmlRelativePath);
const browserUserDataDir = mkdtempSync(join(tmpdir(), "pko-effect-alpha-smoke-"));
let vite = null;

try {
  writeFileSync(htmlPath, buildHarnessHtml(), "utf8");

  const port = await getFreePort();
  vite = spawn(process.execPath, [
    join(repoRoot, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const viteOutput = [];
  vite.stdout.on("data", (chunk) => viteOutput.push(chunk.toString()));
  vite.stderr.on("data", (chunk) => viteOutput.push(chunk.toString()));

  const url = `http://127.0.0.1:${port}/${htmlRelativePath}`;
  await waitForUrl(url, vite);

  const result = spawnSync(edge, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    `--user-data-dir=${browserUserDataDir}`,
    "--virtual-time-budget=5000",
    "--dump-dom",
    url,
  ], {
    encoding: "utf8",
    timeout: BROWSER_RENDER_TIMEOUT_MS,
    killSignal: "SIGKILL",
    windowsHide: true,
  });

  if (result.error?.code === "ETIMEDOUT") {
    console.error(`Headless browser render timed out after ${BROWSER_RENDER_TIMEOUT_MS}ms.`);
    process.exit(124);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(viteOutput.join(""));
    process.exit(result.status ?? 1);
  }

  const match = result.stdout.match(/<pre id="out">([^<]+)<\/pre>/);
  if (!match || match[1] === "pending") {
    console.error("Harness did not emit a completed JSON result.");
    process.stderr.write(result.stderr);
    process.stderr.write(viteOutput.join(""));
    process.exit(1);
  }

  const report = JSON.parse(decodeHtmlEntities(match[1]));
  const failures = report.cases.filter((entry) => !entry.pass);
  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    process.exit(1);
  }
} finally {
  if (vite) {
    vite.kill("SIGKILL");
  }
  rmSync(htmlPath, { force: true });
  rmSync(browserUserDataDir, { recursive: true, force: true });
}

function findBrowser() {
  if (process.env.EDGE_BIN) return process.env.EDGE_BIN;

  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/Application/msedge.exe"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    return candidate;
  }

  return null;
}

function buildHarnessHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<body>
<pre id="out">pending</pre>
<script type="module">
import * as THREE from "three";
import { buildEffectMaterialProps } from "/src/features/effect/buildEffectMaterialProps.ts";
import { composePkoRenderState } from "/src/features/effect/pkoStateEmulation.ts";

const background = [51, 102, 153, 255];
const cases = [];

function renderCase(name, subEffect, techniqueState, expectedPixel, exact = true) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(16, 16, false);
  renderer.setClearColor(0x336699, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial(
    buildEffectMaterialProps(subEffect, texture, techniqueState),
  );
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  renderer.render(scene, camera);

  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  renderer.dispose();

  const actual = Array.from(pixel);
  const pass = exact
    ? actual.every((value, index) => value === expectedPixel[index])
    : actual.some((value, index) => value !== expectedPixel[index]);
  cases.push({
    name,
    material: {
      transparent: material.transparent,
      blending: material.blending,
      blendSrc: material.blendSrc,
      blendDst: material.blendDst,
      depthWrite: material.depthWrite,
    },
    actual,
    expected: expectedPixel,
    pass,
  });
}

renderCase(
  "pko material alpha=true additive keeps transparent black invisible",
  { alpha: true, srcBlend: 5, destBlend: 2 },
  composePkoRenderState(0, { srcBlend: 5, destBlend: 2 }),
  background,
);

renderCase(
  "pko material alpha=true normal-alpha keeps transparent black invisible",
  { alpha: true, srcBlend: 5, destBlend: 6 },
  composePkoRenderState(0, { srcBlend: 5, destBlend: 6 }),
  background,
);

renderCase(
  "pko material alpha=false shows why legacy alpha defaults matter",
  { alpha: false, srcBlend: 5, destBlend: 2 },
  composePkoRenderState(0, { srcBlend: 5, destBlend: 2 }),
  background,
  false,
);

document.getElementById("out").textContent = JSON.stringify({
  renderer: "vite-three-webgl-headless",
  source: "buildEffectMaterialProps",
  background,
  cases,
});
</script>
</body>`;
}

async function waitForUrl(url, processHandle) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Vite exited early with code ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wait and retry.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolvePromise(address.port);
        } else {
          reject(new Error("Unable to allocate a local port"));
        }
      });
    });
  });
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
