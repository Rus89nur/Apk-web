import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadAppearance() {
  const ctx = {
    console,
    document: { readyState: 'loading', addEventListener() {} },
    window: {},
  };
  vm.createContext(ctx);
  const code = readFileSync(join(root, 'js/appearance.js'), 'utf8');
  vm.runInContext(`${code}\nthis.GazpromAppearance = GazpromAppearance;`, ctx);
  return ctx.GazpromAppearance;
}

describe('GazpromAppearance.resolveAppearance', () => {
  let resolveAppearance;

  beforeAll(() => {
    resolveAppearance = loadAppearance().resolveAppearance;
  });

  it('оставляет классический стиль, даже если система тёмная', () => {
    expect(resolveAppearance(null, true)).toEqual({ mode: 'classic', scheme: 'dark' });
    expect(resolveAppearance('classic', false)).toEqual({ mode: 'classic', scheme: 'light' });
  });

  it('день и ночь берёт светлую схему как день', () => {
    expect(resolveAppearance('system', false)).toEqual({ mode: 'system', scheme: 'light' });
  });

  it('день и ночь берёт тёмную схему как ночь', () => {
    expect(resolveAppearance('system', true)).toEqual({ mode: 'system', scheme: 'dark' });
  });
});
