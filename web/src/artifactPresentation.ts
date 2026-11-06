import type {Artifact, JsonValue} from './types';

export type StoryboardPreview = {
  id: string;
  description: string;
};

export type ReadinessStatus = 'ready' | 'partial' | 'missing' | 'inactive';

export type StoryboardReadiness = {
  overall: ReadinessStatus;
  readyToRender: boolean;
  storyboards: {status: ReadinessStatus; count: number};
  shotDescriptions: {status: ReadinessStatus; count: number; expected: number};
  cameraPlans: {status: ReadinessStatus; count: number; expected: number};
  render: {
    started: boolean;
    frames: {status: ReadinessStatus; count: number; expected: number};
    clips: {status: ReadinessStatus; count: number; expected: number};
    finalVideo: {status: ReadinessStatus; count: number; expected: number};
  };
};

export type RenderCheckpoint = 'frames' | 'clips' | 'finalVideo';

const FIELD_LABELS: Record<string, string> = {
  idx: 'Number',
  is_last: 'Final shot',
  cam_idx: 'Camera',
  visual_desc: 'Visual description',
  visual_description: 'Visual description',
  audio_desc: 'Audio',
  description: 'Description',
  ff_desc: 'First frame',
  lf_desc: 'Last frame',
  motion_desc: 'Motion',
  variation_type: 'Transition type',
  variation_reason: 'Transition notes',
  ff_vis_char_idxs: 'Characters in first frame',
  lf_vis_char_idxs: 'Characters in last frame',
  character_idx: 'Character',
  character_id: 'Character',
  shot_idx: 'Shot',
  scene_idx: 'Scene',
  camera_idx: 'Camera',
};

const FILE_TITLES: Record<string, string> = {
  'camera_tree.json': 'Camera plan',
  'characters.json': 'Characters',
  'script.json': 'Script',
  'shot_description.json': 'Shot description',
  'storyboard.json': 'Storyboard',
};

export function isJsonArtifact(artifact: Artifact): boolean {
  const name = artifact.name.toLowerCase();
  return name.endsWith('.json') && name !== 'render_status.json';
}

export function isStoryboardArtifact(artifact: Artifact): boolean {
  return artifact.name.toLowerCase() === 'storyboard.json';
}

export function relatedVisualArtifacts(documentArtifact: Artifact, artifacts: Artifact[]): Artifact[] {
  const media = artifacts.filter((artifact) => artifact.kind === 'image' || artifact.kind === 'video');
  const documentPath = normalizeArtifactPath(documentArtifact.path);
  const documentDirectory = parentArtifactPath(documentPath);
  const shotDirectory = documentPath.match(/^(.*\/shots\/\d+)(?:\/|$)/i)?.[1];
  const sceneDirectory = documentPath.match(/^(.*\/scene_\d+)(?:\/|$)/i)?.[1];
  const workflowRoot = documentPath.split('/')[0] || '';
  const name = documentArtifact.name.toLowerCase();

  const related = media.filter((artifact) => {
    const mediaPath = normalizeArtifactPath(artifact.path);
    if (shotDirectory) return parentArtifactPath(mediaPath) === shotDirectory;
    if (sceneDirectory) return mediaPath.startsWith(`${sceneDirectory}/`);
    if (name === 'characters.json' || name === 'character_portraits_registry.json') {
      return mediaPath.startsWith(`${workflowRoot}/character_portraits/`);
    }
    if (name === 'script.json') {
      return mediaPath.startsWith(`${workflowRoot}/scene_`) || mediaPath === `${workflowRoot}/final_video.mp4`;
    }
    return parentArtifactPath(mediaPath) === documentDirectory;
  });

  return related.sort((left, right) => left.path.localeCompare(right.path, undefined, {numeric: true}));
}

export function friendlyFieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function isArtifactPathField(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized.split('_').some((part) => part === 'path' || part === 'dir' || part === 'directory');
}

export function friendlyArtifactTitle(artifact: Artifact): string {
  const baseTitle = FILE_TITLES[artifact.name.toLowerCase()]
    || artifact.name.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  const sceneMatch = artifact.path.match(/(?:^|\/)scene_(\d+)(?:\/|$)/i);
  const shotMatch = artifact.path.match(/(?:^|\/)shots\/(\d+)(?:\/|$)/i);
  const context = [];
  if (sceneMatch) context.push(`Scene ${Number(sceneMatch[1]) + 1}`);
  if (shotMatch) context.push(`Shot ${Number(shotMatch[1]) + 1}`);
  return context.length ? `${context.join(' · ')} · ${baseTitle}` : baseTitle;
}

export function structuredRecordTitle(value: JsonValue, index: number, artifact: Artifact): string {
  if (isJsonObject(value)) {
    for (const key of ['name', 'title', 'character_name', 'scene_title']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    const explicitIndex = value.idx;
    if (typeof explicitIndex === 'number') return `${recordNoun(artifact)} ${explicitIndex + 1}`;
  }
  return `${recordNoun(artifact)} ${index + 1}`;
}

export function formatStructuredValue(value: JsonValue, key = ''): string {
  if (value === null) return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return isIndexKey(key) ? String(value + 1) : String(value);
  if (typeof value === 'string') return value.trim() || 'Not specified';
  if (Array.isArray(value) && value.every(isJsonPrimitive)) {
    if (value.length === 0) return 'None';
    return value.map((item) => typeof item === 'number' && isIndexListKey(key) ? item + 1 : formatStructuredValue(item)).join(', ');
  }
  return '';
}

export function extractStoryboardPreviews(document: JsonValue, sourcePath: string): StoryboardPreview[] {
  const previews: StoryboardPreview[] = [];

  function visit(value: JsonValue) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isJsonObject(value)) return;
    const description = ['visual_desc', 'visual_description', 'description']
      .map((key) => value[key])
      .find((candidate) => typeof candidate === 'string' && candidate.trim());
    if (typeof description === 'string') {
      previews.push({id: `${sourcePath}:${previews.length}`, description: description.trim()});
      return;
    }
    for (const key of ['storyboards', 'storyboard', 'shots', 'scenes', 'items']) {
      const nested = value[key];
      if (nested !== undefined) visit(nested);
    }
  }

  visit(document);
  return previews;
}

export function deriveStoryboardReadiness(artifacts: Artifact[], storyboardCount: number): StoryboardReadiness {
  const storyboardFiles = artifacts.filter(isStoryboardArtifact).length;
  const shotDescriptions = artifacts.filter((artifact) => artifact.name.toLowerCase() === 'shot_description.json').length;
  const cameraPlans = artifacts.filter((artifact) => artifact.name.toLowerCase() === 'camera_tree.json').length;
  const frames = artifacts.filter((artifact) => artifact.name.toLowerCase() === 'first_frame.png').length;
  const clips = artifacts.filter((artifact) => artifact.name.toLowerCase() === 'video.mp4').length;
  const finalVideos = artifacts.filter((artifact) => artifact.name.toLowerCase() === 'final_video.mp4').length;
  const storyboards = checkpointStatus(storyboardCount, Math.max(storyboardFiles, 1));
  const shots = checkpointStatus(shotDescriptions, storyboardCount);
  const cameras = checkpointStatus(cameraPlans, storyboardFiles);
  const readyToRender = storyboardCount > 0
    && storyboards === 'ready'
    && shots === 'ready'
    && cameras === 'ready';
  const hasPlanningOutput = storyboardCount > 0 || shotDescriptions > 0 || cameraPlans > 0;

  return {
    overall: readyToRender ? 'ready' : hasPlanningOutput ? 'partial' : 'missing',
    readyToRender,
    storyboards: {status: storyboards, count: storyboardCount},
    shotDescriptions: {status: shots, count: shotDescriptions, expected: storyboardCount},
    cameraPlans: {status: cameras, count: cameraPlans, expected: storyboardFiles},
    render: {
      started: frames > 0 || clips > 0 || finalVideos > 0,
      frames: {status: renderCheckpointStatus(frames, storyboardCount), count: frames, expected: storyboardCount},
      clips: {status: renderCheckpointStatus(clips, storyboardCount), count: clips, expected: storyboardCount},
      finalVideo: {status: renderCheckpointStatus(finalVideos, 1), count: finalVideos, expected: 1},
    },
  };
}

export function activeRenderCheckpoint(stage: string): RenderCheckpoint {
  const normalized = stage.toLowerCase();
  if (normalized.includes('video_clip')) return 'clips';
  if (normalized.includes('concat') || normalized.includes('final_video') || normalized === 'render_done') return 'finalVideo';
  return 'frames';
}

export function isJsonObject(value: JsonValue): value is {[key: string]: JsonValue} {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonPrimitive(value: JsonValue): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function recordNoun(artifact: Artifact): string {
  const name = artifact.name.toLowerCase();
  if (name === 'storyboard.json' || name === 'shot_description.json') return 'Shot';
  if (name === 'characters.json') return 'Character';
  if (name === 'script.json') return 'Scene';
  return 'Item';
}

function isIndexKey(key: string): boolean {
  return key === 'idx' || key.endsWith('_idx') || key.endsWith('_index');
}

function isIndexListKey(key: string): boolean {
  return key.endsWith('_idxs') || key.endsWith('_indices');
}

function checkpointStatus(count: number, expected: number): ReadinessStatus {
  if (expected <= 0 || count <= 0) return 'missing';
  return count >= expected ? 'ready' : 'partial';
}

function renderCheckpointStatus(count: number, expected: number): ReadinessStatus {
  if (count <= 0) return 'inactive';
  return expected > 0 && count >= expected ? 'ready' : 'partial';
}

function normalizeArtifactPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function parentArtifactPath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator >= 0 ? path.slice(0, separator) : '';
}
