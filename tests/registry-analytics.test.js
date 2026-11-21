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

  it('getViolationKind: vid → resolve; empty vid → title fallback (like reports)', () => {
    expect(RA.getViolationKind({ vid: 'Альфа', title: 'X' })).toBe('Альфа');
    expect(RA.getViolationKind({ vid: '', title: 'Нет каски' })).toBe('Нет каски');
    expect(RA.getViolationKind({ vid: null, title: 'Сокращённый: Нет СИЗ' })).toBe('Нет СИЗ');
    expect(RA.getViolationKind({ vid: '', title: '' })).toBe(RA.EMPTY_KIND);
  });

  it('groups by getViolationKind; empty vid uses title; sorts by count desc then name', () => {
    const items = [
      { title: 'A один', vid: 'Бета' },
      { title: 'B два', vid: 'Альфа' },
      { title: 'C три', vid: 'Альфа' },
      { title: 'D четыре', vid: '' },
      { title: 'E пять', vid: null },
      { title: 'F шесть', vid: 'Альфа' },
    ];
    const model = RA.buildAnalyticsModel(items, {
      generatedAt: '2026-11-21T12:00:00.000Z',
      period: { allPeriod: true },
    });

    expect(model.meta.total).toBe(6);
    expect(model.meta.period).toBe('весь период');
    expect(model.meta.registryName).toBeUndefined();
    expect(model.byVid.map((r) => r.vid)).toEqual(['Альфа', 'Бета', 'D четыре', 'E пять']);
    expect(model.byVid[0]).toMatchObject({ count: 3, sharePct: 50 });
    expect(model.byVid.find((r) => r.vid === 'D четыре')).toMatchObject({ count: 1 });
    expect(model.byVid.find((r) => r.vid === 'Бета')).toMatchObject({ count: 1, sharePct: 16.7 });
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

  it('formatPeriodLabel: year / month / quarter / all', () => {
    expect(RA.formatPeriodLabel({ allPeriod: true })).toBe('весь период');
    expect(RA.formatPeriodLabel({ year: 2025 })).toBe('2025');
    expect(RA.formatPeriodLabel({ year: 2025, month: 3 })).toBe('2025, март');
    expect(RA.formatPeriodLabel({ year: 2025, quarter: 2 })).toBe('2025, II квартал');
  });

  it('normalizePeriod: allPeriod ignores month/quarter; month wins over quarter', () => {
    expect(RA.normalizePeriod({ allPeriod: true, year: 2025, month: 3 })).toEqual({
      allPeriod: true,
    });
    expect(RA.normalizePeriod({ year: 2025, month: 3, quarter: 2 })).toEqual({
      allPeriod: false,
      year: 2025,
      month: 3,
      quarter: null,
    });
  });

  it('filterAktsByPeriod filters by akt.date year/month/quarter', () => {
    const akts = [
      { id: 'a1', date: '2025-03-10', violations: [{ title: 'v1', vid: 'A' }] },
      { id: 'a2', date: '2025-07-01', violations: [{ title: 'v2', vid: 'B' }] },
      { id: 'a3', date: '2024-03-15', violations: [{ title: 'v3', vid: 'C' }] },
      { id: 'a4', date: '2025-01-20', violations: [{ title: 'v4', vid: 'D' }] },
    ];

    expect(RA.filterAktsByPeriod(akts, { allPeriod: true })).toHaveLength(4);
    expect(RA.filterAktsByPeriod(akts, { year: 2025 }).map((a) => a.id)).toEqual([
      'a1',
      'a2',
      'a4',
    ]);
    expect(RA.filterAktsByPeriod(akts, { year: 2025, month: 3 }).map((a) => a.id)).toEqual(['a1']);
    expect(RA.filterAktsByPeriod(akts, { year: 2025, quarter: 1 }).map((a) => a.id)).toEqual([
      'a1',
      'a4',
    ]);
    expect(RA.filterAktsByPeriod(akts, { year: 2025, quarter: 3 }).map((a) => a.id)).toEqual([
      'a2',
    ]);
  });

  it('collectViolationsFromAkts flattens akt.violations', () => {
    const akts = [
      { violations: [{ title: 'a' }, { title: 'b' }] },
      { violations: [] },
      { violations: [{ title: 'c' }] },
      {},
    ];
    expect(RA.collectViolationsFromAkts(akts).map((v) => v.title)).toEqual(['a', 'b', 'c']);
  });

  it('model from akt violations: meta.total and byVid sharePct from acts total', () => {
    const akts = [
      {
        date: '2025-02-01',
        violations: [
          { title: 'Нет каски', vid: 'СИЗ' },
          { title: 'Открытый кабель', vid: 'Электробезопасность' },
        ],
      },
      {
        date: '2025-08-01',
        violations: [{ title: 'Нет перчаток', vid: 'СИЗ' }],
      },
    ];
    const filtered = RA.filterAktsByPeriod(akts, { year: 2025 });
    const items = RA.collectViolationsFromAkts(filtered);
    const model = RA.buildAnalyticsModel(items, {
      period: { year: 2025 },
      generatedAt: '2026-11-21T12:00:00.000Z',
    });

    expect(model.meta.total).toBe(3);
    expect(model.meta.period).toBe('2025');
    expect(model.byVid[0]).toMatchObject({ vid: 'СИЗ', count: 2, sharePct: 66.7 });
    expect(model.byVid[1]).toMatchObject({
      vid: 'Электробезопасность',
      count: 1,
      sharePct: 33.3,
    });
    expect(model.checklist).toHaveLength(9);
  });

  it('works on default registry sample as plain items (smoke grouping)', () => {
    const data = JSON.parse(
      readFileSync(join(root, 'assets/defaults/violation-registry.json'), 'utf8')
    );
    const model = RA.buildAnalyticsModel(data.items, { period: { allPeriod: true } });
    expect(model.meta.total).toBe(data.count);
    expect(model.meta.period).toBe('весь период');
    expect(model.byVid.length).toBeGreaterThan(5);
    expect(model.clusters.length).toBeGreaterThan(3);
    expect(model.checklist).toHaveLength(9);
    expect(model.byVid[0].count).toBeGreaterThanOrEqual(model.byVid[1].count);
  });
});
