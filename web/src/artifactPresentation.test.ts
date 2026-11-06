import {describe, expect, it} from 'vitest';
import {activeRenderCheckpoint, deriveStoryboardReadiness, extractStoryboardPreviews, formatStructuredValue, friendlyArtifactTitle, friendlyFieldLabel, isArtifactPathField, isJsonArtifact, relatedVisualArtifacts} from './artifactPresentation';
import type {Artifact} from './types';

const artifact: Artifact = {
  path: 'idea2video/scene_0/storyboard.json',
  name: 'storyboard.json',
  kind: 'document',
  size: 1200,
  updatedAt: '2026-07-19T00:00:00Z',
  url: '/api/artifact',
};

describe('artifact presentation', () => {
  it('extracts only storyboard descriptions', () => {
    const previews = extractStoryboardPreviews([
      {idx: 0, visual_desc: 'Wide beach shot', audio_desc: 'Waves'},
      {idx: 1, visual_desc: 'Close portrait', audio_desc: 'Dialogue'},
    ], artifact.path);
    expect(previews.map((preview) => preview.description)).toEqual(['Wide beach shot', 'Close portrait']);
  });

  it('creates readable artifact and field labels', () => {
    expect(friendlyArtifactTitle(artifact)).toBe('Scene 1 · Storyboard');
    expect(friendlyFieldLabel('motion_desc')).toBe('Motion');
    expect(friendlyFieldLabel('custom_camera_note')).toBe('Custom Camera Note');
  });

  it('presents indexes and booleans for non-technical readers', () => {
    expect(formatStructuredValue(0, 'cam_idx')).toBe('1');
    expect(formatStructuredValue([0, 2], 'ff_vis_char_idxs')).toBe('1, 3');
    expect(formatStructuredValue(false, 'is_last')).toBe('No');
  });

  it('identifies filesystem metadata that should stay hidden in artifacts', () => {
    expect(isArtifactPathField('path')).toBe(true);
    expect(isArtifactPathField('image_path')).toBe(true);
    expect(isArtifactPathField('working_dir')).toBe(true);
    expect(isArtifactPathField('reference_image_path_and_text_pairs')).toBe(true);
    expect(isArtifactPathField('visual_desc')).toBe(false);
  });

  it('keeps internal render status out of the artifact document list', () => {
    expect(isJsonArtifact(makeArtifact('render_status.json'))).toBe(false);
    expect(isJsonArtifact(makeArtifact('idea2video/script.json'))).toBe(true);
  });

  it('marks a complete storyboard package ready to render', () => {
    const readiness = deriveStoryboardReadiness([
      artifact,
      makeArtifact('idea2video/scene_0/camera_tree.json'),
      makeArtifact('idea2video/scene_0/shots/0/shot_description.json'),
      makeArtifact('idea2video/scene_0/shots/1/shot_description.json'),
      makeArtifact('idea2video/scene_0/shots/2/shot_description.json'),
    ], 3);
    expect(readiness.readyToRender).toBe(true);
    expect(readiness.overall).toBe('ready');
  });

  it('keeps incomplete shot files out of render-ready state', () => {
    const readiness = deriveStoryboardReadiness([
      artifact,
      makeArtifact('idea2video/scene_0/shots/0/shot_description.json'),
    ], 3);
    expect(readiness.readyToRender).toBe(false);
    expect(readiness.overall).toBe('partial');
    expect(readiness.shotDescriptions.status).toBe('partial');
    expect(readiness.cameraPlans.status).toBe('missing');
  });

  it('marks an empty project as missing', () => {
    expect(deriveStoryboardReadiness([], 0).overall).toBe('missing');
  });

  it('keeps render lights inactive before rendering starts', () => {
    const readiness = deriveStoryboardReadiness([
      artifact,
      makeArtifact('idea2video/scene_0/camera_tree.json'),
      makeArtifact('idea2video/scene_0/shots/0/shot_description.json'),
    ], 1);
    expect(readiness.readyToRender).toBe(true);
    expect(readiness.render.started).toBe(false);
    expect(readiness.render.frames.status).toBe('inactive');
    expect(readiness.render.clips.status).toBe('inactive');
    expect(readiness.render.finalVideo.status).toBe('inactive');
  });

  it('tracks partial and completed render output separately', () => {
    const readiness = deriveStoryboardReadiness([
      artifact,
      makeArtifact('idea2video/scene_0/shots/0/first_frame.png'),
      makeArtifact('idea2video/scene_0/shots/0/video.mp4'),
      makeArtifact('idea2video/scene_0/shots/1/video.mp4'),
      makeArtifact('idea2video/final_video.mp4'),
    ], 2);
    expect(readiness.render.started).toBe(true);
    expect(readiness.render.frames.status).toBe('partial');
    expect(readiness.render.clips.status).toBe('ready');
    expect(readiness.render.finalVideo.status).toBe('ready');
  });

  it('maps live render stages to the light that should animate', () => {
    expect(activeRenderCheckpoint('frame_start')).toBe('frames');
    expect(activeRenderCheckpoint('video_clip_waiting_for_frames')).toBe('clips');
    expect(activeRenderCheckpoint('concat_start')).toBe('finalVideo');
  });

  it('pairs shot documents with visual output from the same shot', () => {
    const shotDocument = makeArtifact('idea2video/scene_0/shots/1/shot_description.json');
    const visuals = relatedVisualArtifacts(shotDocument, [
      makeMediaArtifact('idea2video/scene_0/shots/0/first_frame.png', 'image'),
      makeMediaArtifact('idea2video/scene_0/shots/1/first_frame.png', 'image'),
      makeMediaArtifact('idea2video/scene_0/shots/1/video.mp4', 'video'),
      makeMediaArtifact('idea2video/scene_1/shots/1/first_frame.png', 'image'),
    ]);
    expect(visuals.map((item) => item.path)).toEqual([
      'idea2video/scene_0/shots/1/first_frame.png',
      'idea2video/scene_0/shots/1/video.mp4',
    ]);
  });

  it('pairs scene planning documents with every visual in that scene', () => {
    const visuals = relatedVisualArtifacts(artifact, [
      makeMediaArtifact('idea2video/scene_0/shots/0/first_frame.png', 'image'),
      makeMediaArtifact('idea2video/scene_0/shots/1/video.mp4', 'video'),
      makeMediaArtifact('idea2video/scene_1/shots/0/first_frame.png', 'image'),
    ]);
    expect(visuals).toHaveLength(2);
  });

  it('pairs character documents with generated portraits', () => {
    const visuals = relatedVisualArtifacts(makeArtifact('idea2video/characters.json'), [
      makeMediaArtifact('idea2video/character_portraits/alex/front.png', 'image'),
      makeMediaArtifact('idea2video/scene_0/shots/0/first_frame.png', 'image'),
    ]);
    expect(visuals.map((item) => item.path)).toEqual(['idea2video/character_portraits/alex/front.png']);
  });
});

function makeArtifact(path: string): Artifact {
  const name = path.split('/').at(-1) || path;
  return {...artifact, path, name};
}

function makeMediaArtifact(path: string, kind: 'image' | 'video'): Artifact {
  return {...makeArtifact(path), kind};
}
