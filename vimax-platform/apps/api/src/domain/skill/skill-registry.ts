// ── Skill System ───────────────────────────────────────────────────
// Adapted from Toonflow's skillsTools.ts — loads Markdown skill files
// with frontmatter that define agent behavior prompts.

import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Skill Types ────────────────────────────────────────────────────

export interface SkillPromptTemplates {
  character?: string;
  scene?: string;
  storyboard?: string;
  prop?: string;
  script?: string;
  [key: string]: string | undefined;
}

export interface Skill {
  id: string;
  type: "art" | "story" | "agent";
  name: string;
  description: string;
  /** Prompt templates for different generation tasks */
  prompts: SkillPromptTemplates;
  /** Full markdown body (guidelines, rules, etc.) */
  body: string;
}

// ── Skill Registry ─────────────────────────────────────────────────

const skills = new Map<string, Skill>();
// Resolve from project root (vimax-platform/) not CWD
const skillDirs = [
  resolve(process.cwd(), "..", "..", "data", "skills", "art"),
  resolve(process.cwd(), "..", "..", "data", "skills", "story"),
];

/**
 * Initialize the skill registry — scan and load all skill Markdown files.
 */
export function initSkillRegistry(): void {
  for (const dir of skillDirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    loadSkillsFromDir(dir);
  }
  console.log(`[skill] Loaded ${skills.size} skill(s)`);
}

/**
 * Load all .md skill files from a directory.
 */
function loadSkillsFromDir(dir: string): void {
  const type = dir.endsWith("art") ? "art" : "story";

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      try {
        const skill = parseSkillFile(join(dir, file), type);
        if (skill) {
          skills.set(skill.id, skill);
        }
      } catch (err) {
        console.error(`[skill] Failed to load ${file}:`, err);
      }
    }
  } catch {
    // Directory doesn't exist yet, that's fine
  }
}

/**
 * Parse a Markdown skill file with YAML-like frontmatter.
 *
 * Format:
 * ---
 * id: anime
 * type: art
 * name: "日式动漫风格"
 * description: "Japanese animation art style"
 * prompts:
 *   character: "prompt text..."
 *   scene: "prompt text..."
 * ---
 *
 * # Body content
 * Guidelines and rules here...
 */
function parseSkillFile(filePath: string, defaultType: "art" | "story"): Skill | null {
  const content = readFileSync(filePath, "utf-8");

  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    console.warn(`[skill] No frontmatter in ${filePath}`);
    return null;
  }

  const [, frontmatter, body] = frontmatterMatch;

  // Parse frontmatter (simple YAML-like parsing)
  const meta: Record<string, unknown> = {};
  const prompts: SkillPromptTemplates = {};
  let currentKey = "";
  let inPrompts = false;

  for (const line of frontmatter!.split("\n")) {
    // Check for nested prompts section
    if (line.trim() === "prompts:") {
      inPrompts = true;
      continue;
    }

    // Indented line under prompts:
    if (inPrompts && line.startsWith("  ")) {
      const promptMatch = line.trim().match(/^(\w+):\s*["'](.*)["']/);
      if (promptMatch) {
        prompts[promptMatch[1]!] = promptMatch[2]!;
      }
      continue;
    }

    // Top-level key-value
    inPrompts = false;
    const kvMatch = line.match(/^(\w+):\s*["']?(.*?)["']?\s*$/);
    if (kvMatch) {
      currentKey = kvMatch[1]!;
      meta[currentKey] = kvMatch[2]!;
    }
  }

  const id = meta.id as string;
  if (!id) {
    console.warn(`[skill] Missing id in ${filePath}`);
    return null;
  }

  return {
    id,
    type: (meta.type as "art" | "story") ?? defaultType,
    name: (meta.name as string) ?? id,
    description: (meta.description as string) ?? "",
    prompts,
    body: body!.trim(),
  };
}

// ── Registry API ────────────────────────────────────────────────────

/**
 * Get a skill by ID.
 */
export function getSkill(id: string): Skill | undefined {
  return skills.get(id);
}

/**
 * Get all skills, optionally filtered by type.
 */
export function getSkills(type?: "art" | "story"): Skill[] {
  const all = Array.from(skills.values());
  if (type) return all.filter((s) => s.type === type);
  return all;
}

/**
 * Get all art style skills.
 */
export function getArtSkills(): Skill[] {
  return getSkills("art");
}

/**
 * Get all story genre skills.
 */
export function getStorySkills(): Skill[] {
  return getSkills("story");
}

/**
 * Build a prompt augmentation string from active skills.
 * Prepends skill prompts to the agent's system prompt.
 */
export function buildSkillPrompt(
  skillIds: string[],
  taskType: string,
): string {
  const parts: string[] = [];

  for (const id of skillIds) {
    const skill = skills.get(id);
    if (!skill) continue;

    parts.push(`## 技能: ${skill.name}\n${skill.description}`);

    // Add task-specific prompt if available
    const taskPrompt = skill.prompts[taskType];
    if (taskPrompt) {
      parts.push(`### ${taskType} 提示词\n${taskPrompt}`);
    }

    // Add body guidelines
    if (skill.body) {
      parts.push(skill.body);
    }
  }

  return parts.join("\n\n");
}
