import type { JobEventValidated } from "@vimax/contracts";
import { JobEventSchema } from "@vimax/contracts";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, canvasNodes, jobEvents, jobs } from "../../infrastructure/db/schema.js";
import { createPresignedDownloadUrl } from "../../infrastructure/storage/s3.js";
import { broadcastJobEvent } from "../../realtime/sse.js";
import { markDownstreamDirty, setNodeStatus, updateNodeDataField } from "../canvas/canvas.service.js";
import { runReadyDirtyChildren } from "../canvas/node-executor.service.js";
import { broadcastNodeStatus } from "../canvas/node-status.js";
import { appendVariant, isVariantJob, type VariantEntry } from "../canvas/variations.js";
import { inferAssetKind, shouldCreateAsset } from "../asset/asset-utils.js";
import { persistStoryboardSpawn, clearScriptStoryboardChain } from "../canvas/storyboard-spawn.js";
import { applyAgentResult } from "../canvas/agent-result.js";
import { maybeEvaluateNode } from "../evaluate/evaluate.service.js";

function mapEventType(type: JobEventValidated["type"]) {
  switch (type) {
    case "started":
      return "started" as const;
    case "progress":
      return "progress" as const;
    case "completed":
      return "completed" as const;
    case "failed":
      return "failed" as const;
    default:
      return "log" as const;
  }
}

export async function handleJobEvent(raw: string): Promise<void> {
  let parsed: JobEventValidated;
  try {
    parsed = JobEventSchema.parse(JSON.parse(raw));
  } catch {
    return;
  }

  const db = getDb();
  const [currentJob] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, parsed.job_id))
    .limit(1);
  if (!currentJob || currentJob.status === "succeeded" || currentJob.status === "failed") return;

  await db.insert(jobEvents).values({
    jobId: parsed.job_id,
    eventType: mapEventType(parsed.type),
    payload: parsed as unknown as Record<string, unknown>,
  });

  if (parsed.type === "started") {
    await db
      .update(jobs)
      .set({ status: "running", startedAt: new Date(), progress: 5 })
      .where(eq(jobs.id, parsed.job_id));
  }

  if (parsed.type === "progress") {
    await db
      .update(jobs)
      .set({ progress: parsed.percent })
      .where(eq(jobs.id, parsed.job_id));
  }

  if (parsed.type === "completed") {
    const output = parsed.output;
    const cells = output.cells;

    const [job] = await db
      .select({ inputSnapshot: jobs.inputSnapshot, jobType: jobs.jobType })
      .from(jobs)
      .where(eq(jobs.id, parsed.job_id))
      .limit(1);

    const canvasMeta = (job?.inputSnapshot as Record<string, unknown> | undefined)
      ?._canvas as { canvas_id?: string; node_id?: string } | undefined;

    if (Array.isArray(cells) && cells.length > 0 && canvasMeta?.canvas_id && canvasMeta?.node_id) {
      try {
        const normalizedCells = cells.map((cell) => ({
          shotBrief: cell.shotBrief,
          cameraIdx: cell.cameraIdx,
          ffDesc: cell.ffDesc ?? "",
          lfDesc: cell.lfDesc ?? "",
          motionDesc: cell.motionDesc ?? "",
          audioDesc: cell.audioDesc ?? "",
          shotIdx: cell.shotIdx,
        }));
        // 分镜重跑前清掉本 script 的旧链，保证 cell/shot/image/video 不翻倍。
        await clearScriptStoryboardChain(canvasMeta.canvas_id, canvasMeta.node_id);
        await persistStoryboardSpawn(canvasMeta.canvas_id, canvasMeta.node_id, normalizedCells);
        await setNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "done");
        broadcastNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "done", null, parsed.job_id);
      } catch (err) {
        console.error(
          `[canvas hook] Failed to spawn storyboard cells for node ${canvasMeta.node_id}:`,
          (err as Error).message,
        );
        const errorMessage = `Failed to create storyboard nodes: ${err instanceof Error ? err.message : "unknown error"}`;
        await db.update(jobs).set({
          status: "failed",
          errorCode: "canvas.storyboard_persist_failed",
          errorMessage,
          finishedAt: new Date(),
        }).where(eq(jobs.id, parsed.job_id));
        await setNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "failed");
        broadcastNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "failed", null, parsed.job_id);
        broadcastJobEvent(parsed.job_id, {
          type: "failed",
          ts: parsed.ts,
          job_id: parsed.job_id,
          error_code: "canvas.storyboard_persist_failed",
          error_message: errorMessage,
          retryable: true,
        });
        return;
      }

      await db
        .update(jobs)
        .set({
          status: "succeeded",
          progress: 100,
          finishedAt: new Date(),
        })
        .where(eq(jobs.id, parsed.job_id));

      broadcastJobEvent(parsed.job_id, parsed);
      return;
    }

    // ── Agent bridge results: characters, scripts, selections, trees ──
    if (
      output.result &&
      !Array.isArray(cells) &&
      canvasMeta?.canvas_id &&
      canvasMeta?.node_id
    ) {
      try {
        await applyAgentResult(
          job?.jobType ?? "",
          canvasMeta.canvas_id,
          canvasMeta.node_id,
          output.result,
          parsed.job_id,
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to apply agent result";
        await db.update(jobs).set({
          status: "failed",
          errorCode: "canvas.agent_result_persist_failed",
          errorMessage,
          finishedAt: new Date(),
        }).where(eq(jobs.id, parsed.job_id));
        await setNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "failed");
        broadcastNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "failed", null, parsed.job_id);
        broadcastJobEvent(parsed.job_id, {
          type: "failed",
          ts: parsed.ts,
          job_id: parsed.job_id,
          error_code: "canvas.agent_result_persist_failed",
          error_message: errorMessage,
          retryable: true,
        });
        return;
      }

      await db
        .update(jobs)
        .set({
          status: "succeeded",
          progress: 100,
          finishedAt: new Date(),
        })
        .where(eq(jobs.id, parsed.job_id));

      broadcastJobEvent(parsed.job_id, parsed);
      return;
    }

    let assetId: string | undefined;
    if (shouldCreateAsset(output)) {
      const [existingAsset] = await db
        .select()
        .from(assets)
        .where(eq(assets.storageKey, output.storage_key))
        .limit(1);

      assetId = existingAsset?.id;
      if (!assetId) {
        const [created] = await db
          .insert(assets)
          .values({
            kind: inferAssetKind(output.mime_type),
            mimeType: output.mime_type,
            storageKey: output.storage_key,
            sizeBytes: output.size_bytes,
            width: output.width,
            height: output.height,
            sha256: output.sha256,
            source: "generated",
          })
          .returning();
        assetId = created.id;
      }
    }

    await db
      .update(jobs)
      .set({
        status: "succeeded",
        progress: 100,
        outputAssetId: assetId,
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, parsed.job_id));

    if (canvasMeta?.canvas_id && canvasMeta?.node_id && assetId) {
      try {
        const snapshot = job?.inputSnapshot as Record<string, unknown> | undefined;

        // ── Voiceover TTS: attach audio to shot data, no visual cascade ──
        // The shot's visual output is unchanged, so neither outputAssetId
        // nor the dirty-cascade may fire.
        if (snapshot?._voiceover === true) {
          await updateNodeDataField(canvasMeta.canvas_id, canvasMeta.node_id, "voiceoverAssetId", assetId);
          await setNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "done");
          broadcastNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "done", null, parsed.job_id);

          await db
            .update(jobs)
            .set({
              status: "succeeded",
              progress: 100,
              outputAssetId: assetId,
              finishedAt: new Date(),
            })
            .where(eq(jobs.id, parsed.job_id));
          broadcastJobEvent(parsed.job_id, parsed);
          return;
        }

        // ── Variant jobs: gather into a gallery; no cascade until picked ──
        if (isVariantJob(snapshot)) {
          const index = (snapshot?._variant as { index?: number })?.index ?? 0;
          const entry: VariantEntry = { assetId, jobId: parsed.job_id, index };

          // Read the current gallery + output, append, and (if this is the
          // first variant) adopt it as the node's output so the node is
          // usable immediately.
          const [current] = await db
            .select({ data: canvasNodes.data, outputAssetId: canvasNodes.outputAssetId })
            .from(canvasNodes)
            .where(and(eq(canvasNodes.canvasId, canvasMeta.canvas_id), eq(canvasNodes.id, canvasMeta.node_id)))
            .limit(1);
          const currentData = (current?.data as Record<string, unknown> | undefined) ?? {};
          const gallery = appendVariant(
            currentData.variants as VariantEntry[] | undefined,
            entry,
          );
          await updateNodeDataField(canvasMeta.canvas_id, canvasMeta.node_id, "variants", gallery);

          if (!current?.outputAssetId) {
            await setNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "done", assetId);
          }
          // Broadcast the freshly-appended gallery so clients update live.
          broadcastNodeStatus(
            canvasMeta.canvas_id,
            canvasMeta.node_id,
            "done",
            current?.outputAssetId ?? assetId,
            parsed.job_id,
            gallery,
          );
        } else {
        await setNodeStatus(
          canvasMeta.canvas_id,
          canvasMeta.node_id,
          "done",
          assetId,
        );
        broadcastNodeStatus(
          canvasMeta.canvas_id,
          canvasMeta.node_id,
          "done",
          assetId,
          parsed.job_id,
        );
        await markDownstreamDirty(canvasMeta.canvas_id, canvasMeta.node_id);

        // ── Character three-view: update frontAssetId/sideAssetId/backAssetId ──
        const view = snapshot?._character_view as string | undefined;
        if (view === "front" || view === "side" || view === "back") {
          const field = `${view}AssetId` as "frontAssetId" | "sideAssetId" | "backAssetId";
          await updateNodeDataField(canvasMeta.canvas_id, canvasMeta.node_id, field, assetId);
        }

        // ── Reactive cascade: re-run dirty descendants now ready ──
        await runReadyDirtyChildren(canvasMeta.canvas_id, canvasMeta.node_id);

        // ── Evaluate flywheel: score + at most one auto-refine (async, non-blocking) ──
        if (snapshot?._evaluate === true && assetId) {
          void maybeEvaluateNode(canvasMeta.canvas_id, canvasMeta.node_id, parsed.job_id, assetId);
        }
        }
      } catch (err) {
        console.error(
          `[canvas hook] Failed to update node ${canvasMeta.node_id}:`,
          (err as Error).message,
        );
      }
    }
  }

  if (parsed.type === "failed") {
    await db
      .update(jobs)
      .set({
        status: "failed",
        errorCode: parsed.error_code,
        errorMessage: parsed.error_message,
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, parsed.job_id));

    // ── Canvas hook: mark canvas node as failed ──
    const [job] = await db
      .select({ inputSnapshot: jobs.inputSnapshot })
      .from(jobs)
      .where(eq(jobs.id, parsed.job_id))
      .limit(1);

    const canvasMeta = (job?.inputSnapshot as Record<string, unknown> | undefined)
      ?._canvas as { canvas_id?: string; node_id?: string } | undefined;

    if (canvasMeta?.canvas_id && canvasMeta?.node_id) {
      try {
        await setNodeStatus(canvasMeta.canvas_id, canvasMeta.node_id, "failed");
        broadcastNodeStatus(
          canvasMeta.canvas_id,
          canvasMeta.node_id,
          "failed",
          null,
          parsed.job_id,
        );
      } catch (err) {
        console.error(
          `[canvas hook] Failed to mark node ${canvasMeta.node_id} as failed:`,
          (err as Error).message,
        );
      }
    }
  }

  broadcastJobEvent(parsed.job_id, parsed);
}

export async function getJobEvents(jobId: string) {
  const db = getDb();
  return db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(asc(jobEvents.ts));
}

export async function getJobWithOutputUrl(jobId: string) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) {
    return null;
  }

  let outputUrl: string | undefined;
  if (job.outputAssetId) {
    const [asset] = await db.select().from(assets).where(eq(assets.id, job.outputAssetId)).limit(1);
    if (asset) {
      outputUrl = await createPresignedDownloadUrl(asset.storageKey);
    }
  }

  return { job, outputUrl };
}
