import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadDeepseek({ proxyUrl = '', enabled = true, offline = false } = {}) {
  const fetchMock = vi.fn();
  const ctx = {
    console,
    Object,
    JSON,
    String,
    Number,
    Array,
    Math,
    setTimeout,
    clearTimeout,
    AbortController,
    Image: class Image {},
    document: undefined,
    fetch: fetchMock,
    DeepseekConfig: {
      PROXY_URL: proxyUrl,
      MODEL: 'deepseek-flash',
      TIMEOUT_MS: 25000,
      ENABLED: enabled,
    },
    GazpromOffline: {
      isOffline: () => offline,
    },
  };
  vm.createContext(ctx);
  const expose =
    '\nif (typeof DeepseekService !== "undefined") this.DeepseekService = DeepseekService;\n';
  vm.runInContext(readFileSync(join(root, 'js/deepseek-service.js'), 'utf8') + expose, ctx);
  return { DeepseekService: ctx.DeepseekService, fetchMock };
}

describe('DeepseekService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('isAvailable is false when PROXY_URL empty', () => {
    const { DeepseekService } = loadDeepseek({ proxyUrl: '', offline: false });
    expect(DeepseekService.isAvailable()).toBe(false);
  });

  it('isAvailable is false when offline', () => {
    const { DeepseekService } = loadDeepseek({
      proxyUrl: 'https://example.workers.dev',
      offline: true,
    });
    expect(DeepseekService.isAvailable()).toBe(false);
  });

  it('isAvailable is true when online and PROXY_URL set', () => {
    const { DeepseekService } = loadDeepseek({
      proxyUrl: 'https://example.workers.dev',
      offline: false,
    });
    expect(DeepseekService.isAvailable()).toBe(true);
  });

  it('parseModelJson strips markdown fences', () => {
    const { DeepseekService } = loadDeepseek({ proxyUrl: 'https://x' });
    const parsed = DeepseekService.parseModelJson('```json\n{"title":"А"}\n```');
    expect(parsed).toEqual({ title: 'А' });
  });

  it('parseModelJson returns null on garbage', () => {
    const { DeepseekService } = loadDeepseek({ proxyUrl: 'https://x' });
    expect(DeepseekService.parseModelJson('not-json')).toBeNull();
  });

  it('chat is not called when offline', async () => {
    const { DeepseekService, fetchMock } = loadDeepseek({
      proxyUrl: 'https://example.workers.dev',
      offline: true,
    });
    const result = await DeepseekService.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chat is not called when PROXY_URL empty', async () => {
    const { DeepseekService, fetchMock } = loadDeepseek({ proxyUrl: '' });
    const result = await DeepseekService.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
