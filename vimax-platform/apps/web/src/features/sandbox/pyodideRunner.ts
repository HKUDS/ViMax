// ── 浏览器沙盒执行器（Pyodide）────────────────────────────────────
// `sandbox.run_requested` 的浏览器侧执行约定：
// - 脚本从 `/inputs/<name>` 读输入文件，把产物写到 `/outputs/<name>`；
//   输入文件名 = 资产 id + 按 mime 推断的扩展名（消息里只有 inputAssetIds，
//   没有原始文件名，资产 id 是 agent 唯一可预测的标识）；
// - 每次执行前清空 /inputs 与 /outputs 的旧文件，产物全量读回。

export interface SandboxFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
}

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

interface PyodideFS {
  analyzePath(path: string): { exists: boolean };
  mkdirTree(path: string): void;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array<ArrayBuffer>;
  writeFile(path: string, data: Uint8Array): void;
  stat(path: string): { isDirectory(): boolean };
  unlink(path: string): void;
}

export interface PyodideRuntime {
  runPythonAsync(code: string): Promise<unknown>;
  FS: PyodideFS;
}

interface PyodideWindow {
  loadPyodide?(options: { indexURL: string }): Promise<PyodideRuntime>;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/m4a": ".m4a",
};

/** 输入文件落盘名：资产 id + 按 mime 推断的扩展名。 */
export function sandboxInputName(assetId: string, mimeType: string): string {
  return assetId + (EXTENSION_BY_MIME[mimeType] ?? "");
}

/** 纯函数：按扩展名推断 mime（png/jpeg/webp/json，默认 application/octet-stream）。 */
export function collectOutputFiles(
  names: string[],
  read: (name: string) => Uint8Array<ArrayBuffer>,
): SandboxFile[] {
  return names.map((name) => {
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const mimeType =
      (name.includes(".") && MIME_BY_EXTENSION[ext]) ||
      "application/octet-stream";
    return { name, bytes: read(name), mimeType };
  });
}

let runtimePromise: Promise<PyodideRuntime> | null = null;

function injectPyodideScript(): Promise<void> {
  if ((window as unknown as PyodideWindow).loadPyodide) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${PYODIDE_BASE}pyodide.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load pyodide.js from CDN"));
    document.head.appendChild(script);
  });
}

/** 幂等加载 Pyodide 运行时（CDN 脚本只注入一次，运行时进程复用）。 */
export function loadPyodideRuntime(): Promise<PyodideRuntime> {
  runtimePromise ??= (async () => {
    await injectPyodideScript();
    const load = (window as unknown as PyodideWindow).loadPyodide;
    if (!load) throw new Error("pyodide.js loaded but window.loadPyodide is missing");
    return load({ indexURL: PYODIDE_BASE });
  })();
  runtimePromise.catch(() => {
    runtimePromise = null;
  });
  return runtimePromise;
}

function prepareDir(FS: PyodideFS, path: string): void {
  if (!FS.analyzePath(path).exists) FS.mkdirTree(path);
  for (const entry of FS.readdir(path)) {
    if (entry !== "." && entry !== "..") FS.unlink(`${path}/${entry}`);
  }
}

/**
 * 执行脚本：写入全部输入到 /inputs，运行后读回 /outputs 的所有文件。
 * 脚本约定：读 `/inputs/<name>`，产物写 `/outputs/<name>`。
 */
export async function runPythonCode(
  code: string,
  inputs: SandboxFile[],
): Promise<SandboxFile[]> {
  const pyodide = await loadPyodideRuntime();
  prepareDir(pyodide.FS, "/inputs");
  prepareDir(pyodide.FS, "/outputs");
  for (const file of inputs) {
    pyodide.FS.writeFile(`/inputs/${file.name}`, file.bytes);
  }

  await pyodide.runPythonAsync(code);

  const names = pyodide.FS
    .readdir("/outputs")
    .filter(
      (entry) =>
        entry !== "." &&
        entry !== ".." &&
        !pyodide.FS.stat(`/outputs/${entry}`).isDirectory(),
    );
  return collectOutputFiles(names, (name) =>
    pyodide.FS.readFile(`/outputs/${name}`),
  );
}
