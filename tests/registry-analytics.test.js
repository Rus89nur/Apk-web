import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadRegistryAnalytics() {
  const ctx = { console, Date, Math, JSON, String, Number, Array, Map, Set };
  vm.createContext(ctx);
  vm.runInContext(
    readFileSync(join(root, 'js/registry-analytics.js'), 'utf8') +
      '\nif (typeof RegistryAnalytics !== "undefined") this.RegistryAnalytics = RegistryAnalytics;\n',
    ctx
  );
  return ctx.RegistryAnalytics;
}

describe('RegistryAnalytics', () => {
  let RA;
  let checklistJson;

  beforeAll(() => {
    RA = loadRegistryAnalytics();
    checklistJson = JSON.parse(
      readFileSync(join(root, 'assets/defaults/registry-analytics-checklist.json'), 'utf8')
    );
  });

  it('checklist length === 9 and matches defaults JSON', () => {
    const model = RA.buildAnalyticsModel([], { generatedAt: '2026-11-21T12:00:00.000Z' });
    expect(model.checklist).toHaveLength(9);
    expect(RA.DEFAULT_CHECKLIST).toHaveLength(9);
    expect(checklistJson.directions).toHaveLength(9);
    expect(model.checklist.map((c) => c.direction)).toEqual(
      checklistJson.directions.map((c) => c.direction)
    );
    model.checklist.forEach((block) => {
      expect(block.questions.length).toBeGreaterThanOrEqual(3);
      expect(block.questions.length).toBeLessThanOrEqual(6);
    });
  });

  it('groups by vid, empty vid → Без вида, sorts by count desc then name', () => {
    const items = [
      { title: 'A один', vid: 'Бета' },
      { title: 'B два', vid: 'Альфа' },
      { title: 'C три', vid: 'Альфа' },
      { title: 'D четыре', vid: '' },
      { title: 'E пять', vid: null },
      { title: 'F шесть', vid: 'Альфа' },
    ];
    const model = RA.buildAnalyticsModel(items, {
      registryName: 'Тест',
      generatedAt: '2026-11-21T12:00:00.000Z',
    });

    expect(model.meta.total).toBe(6);
    expect(model.meta.registryName).toBe('Тест');
    expect(model.byVid.map((r) => r.vid)).toEqual(['Альфа', RA.EMPTY_VID, 'Бета']);
    expect(model.byVid[0]).toMatchObject({ count: 3, sharePct: 50 });
    expect(model.byVid[1]).toMatchObject({ vid: 'Без вида', count: 2 });
    expect(model.byVid[2]).toMatchObject({ count: 1, sharePct: 16.7 });
    expect(model.byVid[0].samples).toHaveLength(3);
    expect(model.byVid[0].samples[0]).toBe('B два');
  });

  it('stable tie-break by name when counts equal', () => {
    const items = [
      { title: 'x', vid: 'Яблоко' },
      { title: 'y', vid: 'Абрикос' },
    ];
    const model = RA.buildAnalyticsModel(items);
    expect(model.byVid.map((r) => r.vid)).toEqual(['Абрикос', 'Яблоко']);
  });

  it('clusters match keywords case-insensitive; empty clusters omitted', () => {
    const items = [
      { title: 'Работы на высоте без привязи', description: '', vid: 'Работы на высоте' },
      { title: 'Нет огнетушителя', description: 'пожарный щит', vid: 'Пожарная безопасность' },
      { title: 'Прочее без ключевых слов', description: 'zzz', vid: 'Прочие работы' },
    ];
    const model = RA.buildAnalyticsModel(items, {
      clusters: [
        { id: 'height', title: 'Высота', keywords: ['высот', 'привяз'] },
        { id: 'fire', title: 'Пожар', keywords: ['огнетуш', 'пожарн'] },
        { id: 'ghost', title: 'Пустой', keywords: ['несуществующий_токен_xyz'] },
      ],
    });

    expect(model.clusters.map((c) => c.id)).toEqual(['height', 'fire']);
    expect(model.clusters.find((c) => c.id === 'ghost')).toBeUndefined();
    expect(model.clusters[0].count).toBe(1);
    expect(model.clusters[1].count).toBe(1);
    expect(model.clusters[0].samples[0]).toContain('высоте');
  });

  it('one item can match several clusters', () => {
    const items = [{ title: 'Каска и электрокабель на высоте', vid: 'Прочие работы' }];
    const model = RA.buildAnalyticsModel(items, {
      clusters: [
        { id: 'ppe', title: 'СИЗ', keywords: ['каск'] },
        { id: 'electro', title: 'Электро', keywords: ['электр', 'кабел'] },
        { id: 'height', title: 'Высота', keywords: ['высот'] },
      ],
    });
    expect(model.clusters).toHaveLength(3);
    expect(model.clusters.every((c) => c.count === 1)).toBe(true);
  });

  it('analyticsFileName uses YYYY-MM-DD', () => {
    const model = RA.buildAnalyticsModel([], { generatedAt: '2026-03-05T10:00:00.000Z' });
    expect(RA.analyticsFileName(model)).toBe('Analiticheskaya_spravka_reestr_2026-03-05.docx');
  });

  it('works on default registry sample (smoke)', () => {
    const data = JSON.parse(
      readFileSync(join(root, 'assets/defaults/violation-registry.json'), 'utf8')
    );
    const model = RA.buildAnalyticsModel(data.items, { registryName: data.name });
    expect(model.meta.total).toBe(data.count);
    expect(model.byVid.length).toBeGreaterThan(5);
    expect(model.clusters.length).toBeGreaterThan(3);
    expect(model.checklist).toHaveLength(9);
    expect(model.byVid[0].count).toBeGreaterThanOrEqual(model.byVid[1].count);
  });
});
