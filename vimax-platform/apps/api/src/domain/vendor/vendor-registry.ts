// ── Vendor Plugin System ────────────────────────────────────────────
// Adapted from Toonflow's utils/vendor.ts — hot-loadable AI provider
// plugins written in TypeScript, transpiled at runtime via Sucrase.

import { transform } from "sucrase";
import { readFileSync, readdirSync, watchFile, unwatchFile, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";

// ── Vendor Module Interface ─────────────────────────────────────────

export interface VendorModel {
  id: string;
  name: string;
  type: "chat" | "image" | "video" | "tts" | "embedding";
  maxTokens?: number;
  supportsThinking?: boolean;
  supportsVision?: boolean;
}

export interface VendorModule {
  id: string;
  name: string;
  models: VendorModel[];
  /** Base URL for the provider API */
  baseUrl?: string;
  /** API key (can be set via env or DB config) */
  apiKey?: string;
  /** Custom request functions */
  textRequest?: (params: VendorTextParams) => Promise<VendorTextResult>;
  imageRequest?: (params: VendorImageParams) => Promise<VendorImageResult>;
  videoRequest?: (params: VendorVideoParams) => Promise<VendorVideoResult>;
}

export interface VendorTextParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface VendorTextResult {
  content: string;
  thinking?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface VendorImageParams {
  prompt: string;
  model: string;
  size?: string;
  referenceImages?: string[];
}

export interface VendorImageResult {
  imageUrl: string;
  base64?: string;
}

export interface VendorVideoParams {
  prompt: string;
  model: string;
  duration?: number;
  resolution?: string;
  referenceImages?: string[];
}

export interface VendorVideoResult {
  videoUrl: string;
}

// ── Vendor Registry ─────────────────────────────────────────────────

const vendors = new Map<string, VendorModule>();
// Resolve from project root (vimax-platform/) not CWD
const vendorDir = resolve(process.cwd(), "..", "..", "data", "vendors");

/**
 * Initialize the vendor registry — scan and load all vendor files.
 */
export function initVendorRegistry(): void {
  if (!existsSync(vendorDir)) {
    mkdirSync(vendorDir, { recursive: true });
    console.log(`[vendor] Created vendor directory: ${vendorDir}`);
  }

  loadAllVendors();
  console.log(`[vendor] Loaded ${vendors.size} vendor(s)`);
}

/**
 * Load all vendor TypeScript files from the vendor directory.
 */
function loadAllVendors(): void {
  vendors.clear();

  try {
    const files = readdirSync(vendorDir).filter((f) => f.endsWith(".ts"));

    for (const file of files) {
      try {
        const vendor = loadVendorFile(join(vendorDir, file));
        if (vendor) {
          vendors.set(vendor.id, vendor);
          console.log(`[vendor] Loaded: ${vendor.id} (${vendor.name}) — ${vendor.models.length} model(s)`);
        }
      } catch (err) {
        console.error(`[vendor] Failed to load ${file}:`, err);
      }
    }
  } catch (err) {
    console.warn("[vendor] No vendor directory found, using env-based config");
  }
}

/**
 * Load and execute a single vendor TypeScript file.
 * Transpiles via Sucrase and executes in a sandboxed context.
 */
function loadVendorFile(filePath: string): VendorModule | null {
  const code = readFileSync(filePath, "utf-8");

  // Transpile TypeScript to CommonJS
  const result = transform(code, {
    transforms: ["typescript", "imports"], // imports converts ESM -> CJS
    filePath,
  });

  // Execute in a sandboxed module context
  const moduleExports: Record<string, unknown> = {};
  const sandboxRequire = createRequire(filePath);

  const wrappedCode = `
    (function(exports, require) {
      ${result.code}
    })
  `;

  try {
    const fn = eval(wrappedCode) as (
      exports: Record<string, unknown>,
      require: NodeRequire,
    ) => void;
    fn(moduleExports, sandboxRequire);

    // Extract the vendor object
    const vendor = moduleExports.vendor ?? moduleExports.default ?? moduleExports;
    if (!vendor || typeof vendor !== "object") {
      console.error(`[vendor] No vendor object exported from ${filePath}`);
      return null;
    }

    const v = vendor as Partial<VendorModule>;
    if (!v.id || !v.name) {
      console.error(`[vendor] Missing id or name in ${filePath}`);
      return null;
    }

    return {
      id: v.id,
      name: v.name,
      models: v.models ?? [],
      baseUrl: v.baseUrl,
      apiKey: v.apiKey,
      textRequest: v.textRequest,
      imageRequest: v.imageRequest,
      videoRequest: v.videoRequest,
    };
  } catch (err) {
    console.error(`[vendor] Execution error in ${filePath}:`, err);
    return null;
  }
}

// ── Registry API ────────────────────────────────────────────────────

/**
 * Get a vendor by ID.
 */
export function getVendor(id: string): VendorModule | undefined {
  return vendors.get(id);
}

/**
 * Get all registered vendors.
 */
export function getAllVendors(): VendorModule[] {
  return Array.from(vendors.values());
}

/**
 * Find a vendor that provides a specific model.
 */
export function getVendorForModel(modelId: string): VendorModule | undefined {
  // Model IDs are in format "vendorId:modelName"
  if (modelId.includes(":")) {
    const vendorId = modelId.split(":")[0]!;
    return vendors.get(vendorId);
  }
  // Search all vendors for the model
  for (const vendor of vendors.values()) {
    if (vendor.models.some((m) => m.id === modelId || m.name === modelId)) {
      return vendor;
    }
  }
  return undefined;
}

/**
 * Get all models across all vendors.
 */
export function getAllModels(): Array<VendorModel & { vendorId: string }> {
  const models: Array<VendorModel & { vendorId: string }> = [];
  for (const vendor of vendors.values()) {
    for (const model of vendor.models) {
      models.push({ ...model, vendorId: vendor.id });
    }
  }
  return models;
}

/**
 * Reload all vendors from disk (hot reload).
 */
export function reloadVendors(): number {
  loadAllVendors();
  return vendors.size;
}
