// ── Agent Registry ──────────────────────────────────────────────────
// Registry of available agents and their capabilities.

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  type: "decision" | "execution" | "supervision";
  tools: string[];
  systemPromptFile?: string;
}

export const AGENT_REGISTRY: AgentDefinition[] = [
  // ── Decision Agents ──
  {
    id: "productionAgent:decisionAgent",
    name: "制作决策 Agent",
    description: "分析用户意图，路由到合适的制作子 Agent",
    type: "decision",
    tools: [
      "generate_script",
      "generate_storyboard",
      "extract_characters",
      "generate_image",
      "activate_skill",
      "create_canvas_nodes",
      "run_node",
    ],
    systemPromptFile: "production_agent_decision.md",
  },
  {
    id: "scriptAgent:decisionAgent",
    name: "剧本决策 Agent",
    description: "分析用户意图，路由到合适的编剧子 Agent",
    type: "decision",
    tools: [
      "generate_script",
      "extract_characters",
      "activate_skill",
      "create_canvas_nodes",
    ],
    systemPromptFile: "script_agent_decision.md",
  },

  // ── Execution Agents ──
  {
    id: "productionAgent:deriveAssetsAgent",
    name: "资产分析 Agent",
    description: "从剧本中分析并提取衍生资产",
    type: "execution",
    tools: [],
    systemPromptFile: "production_execution_derive_assets.md",
  },
  {
    id: "productionAgent:generateAssetsAgent",
    name: "资产生成 Agent",
    description: "生成角色/场景/道具的参考图",
    type: "execution",
    tools: [],
    systemPromptFile: "production_execution_generate_assets.md",
  },
  {
    id: "productionAgent:directorPlanAgent",
    name: "导演规划 Agent",
    description: "制定拍摄计划和导演方案",
    type: "execution",
    tools: [],
    systemPromptFile: "production_execution_director_plan.md",
  },
  {
    id: "productionAgent:storyboardGenAgent",
    name: "分镜生成 Agent",
    description: "生成分镜图像",
    type: "execution",
    tools: [],
    systemPromptFile: "production_execution_storyboard_gen.md",
  },
  {
    id: "productionAgent:storyboardPanelAgent",
    name: "分镜面板 Agent",
    description: "生成分镜面板内容",
    type: "execution",
    tools: [],
    systemPromptFile: "production_execution_storyboard_panel.md",
  },
  {
    id: "productionAgent:storyboardTableAgent",
    name: "分镜表 Agent",
    description: "生成分镜表格",
    type: "execution",
    tools: [],
    systemPromptFile: "production_execution_storyboard_table.md",
  },

  // ── Supervision Agents ──
  {
    id: "productionAgent:supervisionAgent",
    name: "监制 Agent",
    description: "审核制作质量，提供反馈",
    type: "supervision",
    tools: [],
    systemPromptFile: "production_agent_supervision.md",
  },
  {
    id: "scriptAgent:supervisionAgent",
    name: "编辑 Agent",
    description: "审核剧本质量，提供反馈",
    type: "supervision",
    tools: [],
    systemPromptFile: "script_agent_supervision.md",
  },
];

/**
 * Look up an agent definition by ID.
 */
export function getAgentDefinition(agentId: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => a.id === agentId);
}

/**
 * Get all agents of a given type.
 */
export function getAgentsByType(type: AgentDefinition["type"]): AgentDefinition[] {
  return AGENT_REGISTRY.filter((a) => a.type === type);
}
