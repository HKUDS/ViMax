// ── Sandbox Service (user scripts + canvas-bound runs) ───────────────

import { desc, eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { sandboxRuns, sandboxScripts } from "../../infrastructure/db/schema.js";

export async function registerScript(input: {
  name: string;
  code: string;
  description?: string;
}): Promise<{ scriptId: string }> {
  const db = getDb();
  const [script] = await db
    .insert(sandboxScripts)
    .values({
      name: input.name,
      code: input.code,
      description: input.description ?? null,
    })
    .returning({ id: sandboxScripts.id });
  return { scriptId: script!.id };
}

export async function listScripts(limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(sandboxScripts)
    .orderBy(desc(sandboxScripts.createdAt))
    .limit(limit);
}

export async function createRun(input: {
  canvasId: string;
  scriptId?: string;
  code?: string;
  inputAssetIds: string[];
  name?: string;
}): Promise<{ runId: string; code: string; name: string; language: string }> {
  const db = getDb();

  let scriptId = input.scriptId;
  let code: string;
  let name: string;
  let language: string;

  if (scriptId) {
    const [script] = await db
      .select()
      .from(sandboxScripts)
      .where(eq(sandboxScripts.id, scriptId))
      .limit(1);
    if (!script) throw new Error("sandbox.script_not_found");
    code = script.code;
    name = input.name ?? script.name;
    language = script.language;
  } else {
    if (!input.code) throw new Error("sandbox.code_required");
    code = input.code;
    name = input.name ?? "sandbox-run";
    language = "python";
    const [script] = await db
      .insert(sandboxScripts)
      .values({ name, code })
      .returning({ id: sandboxScripts.id });
    scriptId = script!.id;
  }

  const [run] = await db
    .insert(sandboxRuns)
    .values({
      scriptId,
      canvasId: input.canvasId,
      status: "pending",
      inputAssetIds: input.inputAssetIds,
    })
    .returning({ id: sandboxRuns.id });
  return { runId: run!.id, code, name, language };
}

export async function completeRun(
  runId: string,
  result: { outputAssetIds?: string[]; error?: string },
): Promise<void> {
  const db = getDb();
  await db
    .update(sandboxRuns)
    .set({
      status: result.error ? "failed" : "completed",
      ...(result.outputAssetIds ? { outputAssetIds: result.outputAssetIds } : {}),
      ...(result.error ? { error: result.error } : {}),
    })
    .where(eq(sandboxRuns.id, runId));
}

export async function getRun(runId: string) {
  const db = getDb();
  const [run] = await db.select().from(sandboxRuns).where(eq(sandboxRuns.id, runId)).limit(1);
  return run ?? null;
}
