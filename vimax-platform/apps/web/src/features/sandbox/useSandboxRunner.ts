"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AssetUploadRequest,
  AssetUploadResponse,
  ServerWsMessage,
} from "@vimax/contracts";
import { trpc } from "@/lib/trpc/client";
import { getLocalAssetBlob, putLocalAsset } from "@/lib/local-assets";
import { useCanvasWebSocket } from "@/lib/websocket/client";
import { runPythonCode, sandboxInputName } from "./pyodideRunner";
import type { SandboxFile } from "./pyodideRunner";

// ── Sandbox Runner ──────────────────────────────────────────────────
// 订阅画布 WS 的 sandbox.run_requested：本地/远端取输入 → Pyodide 执行 →
// 产物走 requestUpload/confirmUpload 入库 → sandbox.completeRun 回执。
// 任何一步失败都会以 completeRun({ error }) 收尾，绝不悬挂。

type SandboxRunRequested = Extract<
  ServerWsMessage,
  { type: "sandbox.run_requested" }
>;

interface UseSandboxRunnerReturn {
  runningRunId: string | null;
  error: string | null;
  handleRunRequested: (msg: SandboxRunRequested) => Promise<void>;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchInputFile(
  assetId: string,
  getAssetUrl: (
    assetId: string,
  ) => Promise<{ url: string | null; offloaded: boolean }>,
): Promise<SandboxFile> {
  const local = await getLocalAssetBlob(assetId);
  if (local) {
    return {
      name: sandboxInputName(assetId, local.type),
      bytes: new Uint8Array(await local.arrayBuffer()),
      mimeType: local.type || "application/octet-stream",
    };
  }

  const meta = await getAssetUrl(assetId);
  if (!meta.url) throw new Error(`asset ${assetId} binary unavailable`);
  const res = await fetch(meta.url);
  if (!res.ok) throw new Error(`fetch asset ${assetId}: HTTP ${res.status}`);
  const blob = await res.blob();
  void putLocalAsset(assetId, blob);
  return {
    name: sandboxInputName(assetId, blob.type),
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type || "application/octet-stream",
  };
}

async function uploadOutputFile(
  file: SandboxFile,
  requestUpload: (input: {
    mime_type: AssetUploadRequest["mime_type"];
    size_bytes: number;
  }) => Promise<AssetUploadResponse>,
  confirmUpload: (input: {
    asset_id: string;
    sha256: string;
    width: number;
    height: number;
  }) => Promise<unknown>,
): Promise<string> {
  const req = await requestUpload({
    mime_type: file.mimeType as AssetUploadRequest["mime_type"],
    size_bytes: file.bytes.byteLength,
  });
  await fetch(req.upload_url, {
    method: "PUT",
    body: file.bytes,
    headers: { "Content-Type": file.mimeType },
  });
  await confirmUpload({
    asset_id: req.asset_id,
    sha256: await sha256Hex(file.bytes),
    width: 0,
    height: 0,
  });
  return req.asset_id;
}

export function useSandboxRunner(canvasId: string): UseSandboxRunnerReturn {
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRunRef = useRef<string | null>(null);

  const utils = trpc.useUtils();
  const requestUploadMutation = trpc.asset.requestUpload.useMutation();
  const confirmUploadMutation = trpc.asset.confirmUpload.useMutation();
  const completeRunMutation = trpc.sandbox.completeRun.useMutation();

  const completeRun = useCallback(
    async (
      runId: string,
      payload: { outputAssetIds?: string[]; error?: string },
    ) => {
      try {
        await completeRunMutation.mutateAsync({ runId, ...payload });
      } catch (err) {
        console.error("[sandbox] completeRun failed:", err);
      }
    },
    [completeRunMutation],
  );

  const handleRunRequested = useCallback(
    async (msg: SandboxRunRequested) => {
      if (msg.canvasId !== canvasId) return;

      if (activeRunRef.current) {
        await completeRun(msg.runId, {
          error: "another sandbox run is in progress",
        });
        return;
      }
      if (msg.language !== "python") {
        await completeRun(msg.runId, {
          error: `unsupported language: ${msg.language}`,
        });
        return;
      }

      activeRunRef.current = msg.runId;
      setRunningRunId(msg.runId);
      setError(null);

      let outputAssetIds: string[] | undefined;
      let failure: string | undefined;
      try {
        const inputs = await Promise.all(
          msg.inputAssetIds.map((assetId) =>
            fetchInputFile(assetId, (id) =>
              utils.canvas.getAssetUrl.fetch({ asset_id: id }),
            ),
          ),
        );
        const outputs = await runPythonCode(msg.code, inputs);
        outputAssetIds = [];
        for (const file of outputs) {
          outputAssetIds.push(
            await uploadOutputFile(
              file,
              (input) => requestUploadMutation.mutateAsync(input),
              (input) => confirmUploadMutation.mutateAsync(input),
            ),
          );
        }
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        setError(failure);
      }

      activeRunRef.current = null;
      setRunningRunId(null);
      await completeRun(msg.runId, {
        outputAssetIds,
        error: failure,
      });
    },
    [canvasId, completeRun, utils, requestUploadMutation, confirmUploadMutation],
  );

  useCanvasWebSocket({
    canvasId,
    onMessage: useCallback(
      (msg: ServerWsMessage) => {
        if (msg.type === "sandbox.run_requested") {
          void handleRunRequested(msg);
        }
      },
      [handleRunRequested],
    ),
    enabled: !!canvasId,
  });

  return { runningRunId, error, handleRunRequested };
}
