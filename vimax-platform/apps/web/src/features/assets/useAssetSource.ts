"use client";

// ── Local-first 资产解析 ─────────────────────────────────────────
// 所有资产展示位统一走本 Hook：本地金库优先，未命中时从服务端拉取
// 二进制、写入本地，然后（仅 generated 资产）触发远端 offload——
// 服务端对象存储退化为瞬时中转。写入失败（隐私模式/配额满）时
// 保持云端直连渲染，且绝不删除远端副本。

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { putLocalAsset, getLocalAssetUrl } from "@/lib/local-assets";

export type AssetStorageState = "loading" | "local" | "cloud" | "missing";

interface AssetSourceResult {
  status: AssetStorageState;
  /** 可直接用于 <img src> / <video src> 的地址（local=objectURL，cloud=远端签名 URL） */
  url: string | null;
}

export function useAssetSource(
  assetId: string | null | undefined,
  options: { autoOffload?: boolean } = {},
): AssetSourceResult {
  const { autoOffload = true } = options;
  const [result, setResult] = useState<AssetSourceResult>({ status: "loading", url: null });

  const urlQuery = trpc.canvas.getAssetUrl.useQuery(
    { asset_id: assetId! },
    { enabled: typeof assetId === "string" && assetId.length > 0, staleTime: 300_000 },
  );
  // 走裸客户端而非 useMutation：offload 是静默后台操作，失败不应弹全局 toast
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!assetId) {
      setResult({ status: "loading", url: null });
      return;
    }
    let cancelled = false;

    (async () => {
      // 1) 本地金库命中 → 直接出 objectURL，不再请求远端内容
      const localUrl = await getLocalAssetUrl(assetId);
      if (cancelled) return;
      if (localUrl) {
        setResult({ status: "local", url: localUrl });
        return;
      }

      // 2) 等服务端元数据（url / source / offloaded）
      const data = urlQuery.data;
      if (urlQuery.isError) {
        setResult({ status: "missing", url: null });
        return;
      }
      if (!data) return; // query loading：保持 loading 态
      if (!data.url) {
        setResult({ status: "missing", url: null });
        return;
      }

      // 3) 拉取二进制并写入本地金库
      try {
        const res = await fetch(data.url);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const stored = await putLocalAsset(assetId, blob);
        if (cancelled) return;

        if (stored) {
          const objectUrl = await getLocalAssetUrl(assetId);
          setResult({ status: "local", url: objectUrl });
          // 本地已确认落库：generated 资产立即清除远端二进制（fire-and-forget，服务端幂等）
          if (autoOffload && data.source === "generated") {
            void utils.client.asset.offload.mutate({ asset_id: assetId }).catch(() => {
              // 失败无害：服务端 TTL 清扫会兜底
            });
          }
        } else {
          // 本地写入失败：保留云端渲染路径，不删远端
          setResult({ status: "cloud", url: data.url });
        }
      } catch {
        if (!cancelled) setResult({ status: "cloud", url: data.url });
      }
    })();

    return () => {
      cancelled = true;
    };
    // urlQuery.data 引用稳定（react-query 结构共享），按 assetId 变化重跑
  }, [assetId, urlQuery.data, urlQuery.isError, autoOffload, utils]);

  return result;
}
