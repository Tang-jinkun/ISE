import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

const apiRoot = resolve(__dirname, '..');
const distRoot = resolve(apiRoot, 'dist');
const nakedRuntimeContractsRequire =
  /require\s*\(\s*(['"])@ise\/runtime-contracts(?:\/node)?\1\s*\)/;

describe('production bundle runtime contracts', () => {
  beforeAll(() => {
    const result = spawnSync('npm run build', {
      cwd: apiRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
      shell: true,
    });
    if (result.status !== 0) {
      throw new Error(`Production build failed:\n${result.stdout}\n${result.stderr}`);
    }
  }, 60_000);

  it('contains no naked runtime-contracts require', () => {
    for (const artifact of ['main.js', 'runtime-contracts-smoke.js']) {
      const source = readFileSync(resolve(distRoot, artifact), 'utf8');
      expect(source).not.toMatch(nakedRuntimeContractsRequire);
    }
  });

  it('loads bundled runtime contracts in an isolated smoke entry', () => {
    const smokePath = resolve(distRoot, 'runtime-contracts-smoke.js');
    expect(existsSync(smokePath)).toBe(true);

    const result = spawnSync(process.execPath, [smokePath], {
      cwd: apiRoot,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('runtime-contracts:ok');
  });
});
