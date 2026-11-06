export interface StoryboardCharacterInput {
  name: string;
  description: string;
}

export function mapCanvasCharactersToPayload(
  nodes: Array<{ type?: string; data: Record<string, unknown> }>,
): StoryboardCharacterInput[] {
  return nodes
    .filter((node) => node.type === "character")
    .map((node) => ({
      name: String(node.data.name ?? "角色"),
      description: String(node.data.description ?? ""),
    }));
}

export function buildStoryboardUserRequirement(mode?: string): string {
  if (mode === "script") {
    return "Professional cinematic storyboard. Follow the script closely, use varied shot sizes, and keep camera positions efficient.";
  }
  return "Professional cinematic storyboard for an AI video pipeline. Establish the scene first, then build emotional beats with clear visual descriptions.";
}
