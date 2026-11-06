import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {readAgentConfig, saveAgentConfig} from './config-store.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vimax-config-'));
  roots.push(root);
  await mkdir(path.join(root, 'configs'), {recursive: true});
  await writeFile(path.join(root, 'configs', 'agent.local.yaml'), [
    'llm:',
    '  model_provider: openai',
    '  model: existing-model',
    '  base_url: https://example.test/v1',
    '  api_key: secret-value',
    '',
  ].join('\n'));
  return root;
}

describe('agent config store', () => {
  it('never returns stored API keys', async () => {
    const root = await fixture();
    const config = await readAgentConfig(root);
    expect(config.sections.llm).toMatchObject({model: 'existing-model', api_key: '', has_api_key: true});
    expect(JSON.stringify(config)).not.toContain('secret-value');
  });

  it('keeps a stored key when a blank key is saved', async () => {
    const root = await fixture();
    await saveAgentConfig(root, {sections: {llm: {model: 'new-model', api_key: ''}}});
    const saved = await readFile(path.join(root, 'configs', 'agent.local.yaml'), 'utf8');
    expect(saved).toContain('model: new-model');
    expect(saved).toContain('api_key: secret-value');
  });

  it('rejects invalid base URLs', async () => {
    const root = await fixture();
    await expect(saveAgentConfig(root, {sections: {llm: {base_url: 'file:///tmp/key'}}})).rejects.toThrow(/http/);
  });
});
