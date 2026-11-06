// ── 本地资产金库（IndexedDB）────────────────────────────────────
// 中间产物（生成的图片/视频/音频）的二进制存在用户设备本地，云端只做
// 瞬时中转。设计要点：
// - 全部 API SSR 安全（无 indexedDB 时优雅降级为 false/null）；
// - objectURL 走内存缓存按 id 复用，仅在删除时 revoke；
// - putLocalAsset 返回 boolean：false = 存储 fails（隐私模式/配额满），
//   调用方此时绝不能触发服务端 offload，否则数据会丢失。

const DB_NAME = "vimax-local-assets";
const DB_VERSION = 1;
const STORE = "assets";

export interface LocalAssetMeta {
  kind: "image" | "video" | "audio";
  mimeType: string;
}

interface LocalAssetRecord extends LocalAssetMeta {
  id: string;
  blob: Blob;
  bytes: number;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const objectUrlCache = new Map<string, string>();

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("indexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

export function inferKindFromMime(mimeType: string): LocalAssetMeta["kind"] {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

/** 写入本地。返回 false 表示存储失败（调用方不得 offload 远端副本）。 */
export async function putLocalAsset(id: string, blob: Blob, meta?: Partial<LocalAssetMeta>): Promise<boolean> {
  try {
    const db = await openDb();
    const record: LocalAssetRecord = {
      id,
      blob,
      kind: meta?.kind ?? inferKindFromMime(blob.type || "application/octet-stream"),
      mimeType: meta?.mimeType ?? blob.type,
      bytes: blob.size,
      savedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB put aborted"));
    });
    return true;
  } catch {
    return false;
  }
}

export async function getLocalAssetBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as LocalAssetRecord | undefined)?.blob ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** 取本地 objectURL（命中即缓存复用）。无副本返回 null。 */
export async function getLocalAssetUrl(id: string): Promise<string | null> {
  const cached = objectUrlCache.get(id);
  if (cached) return cached;
  const blob = await getLocalAssetBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(id, url);
  return url;
}

export function getCachedLocalAssetUrl(id: string): string | null {
  return objectUrlCache.get(id) ?? null;
}

export async function hasLocalAsset(id: string): Promise<boolean> {
  return (await getLocalAssetBlob(id)) !== null;
}

export async function deleteLocalAsset(id: string): Promise<void> {
  const url = objectUrlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(id);
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 删除失败不致命：本地孤儿文件不产生数据风险
  }
}

export async function localAssetUsage(): Promise<{ count: number; bytes: number }> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const records = (req.result as LocalAssetRecord[]) ?? [];
        resolve({
          count: records.length,
          bytes: records.reduce((sum, r) => sum + (r.bytes ?? 0), 0),
        });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** 触发浏览器下载本地副本（保存到用户磁盘）。 */
export async function downloadLocalAsset(id: string, filename: string): Promise<boolean> {
  const blob = await getLocalAssetBlob(id);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
