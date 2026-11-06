import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { canvasNodes, jobs } from "../../infrastructure/db/schema.js";
import { broadcastNodeStatus } from "../canvas/node-status.js";
import { setNodeStatus } from "../canvas/canvas.service.js";

// ── 僵尸任务清扫 ────────────────────────────────────────────────
// worker/宿主崩溃会把 job 永远留在 queued/running：它占着节点的在途
// 锁（重试只会报 job_in_flight），也会误导节点状态。超过阈值仍未见
// 终态的任务判定为僵尸，标记失败并同步节点状态，让重试重新可行。
// 2 小时远大于合法上限（视频重试预算收紧后单 job ≤ ~15 分钟）。

export const JOB_STALL_HOURS = 2;

export async function sweepStalledJobs(batchSize = 200) {
  const db = getDb();
  const cutoff = new Date(Date.now() - JOB_STALL_HOURS * 3600 * 1000);
  const stalled = await db
    .select({ id: jobs.id, snapshot: jobs.inputSnapshot })
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "running"]), lt(jobs.queuedAt, cutoff)))
    .limit(batchSize);

  let swept = 0;
  for (const job of stalled) {
    const message = "任务超时（worker 中断或长时间无进展），请重试";
    await db
      .update(jobs)
      .set({ status: "failed", errorCode: "job.stalled", errorMessage: message, finishedAt: new Date() })
      .where(eq(jobs.id, job.id));

    const meta = (job.snapshot as { _canvas?: { canvas_id?: string; node_id?: string } } | null)?._canvas;
    if (meta?.canvas_id && meta?.node_id) {
      await setNodeStatus(meta.canvas_id, meta.node_id, "failed");
      broadcastNodeStatus(meta.canvas_id, meta.node_id, "failed", null, job.id);
    }
    swept += 1;
  }
  return { swept };
}
