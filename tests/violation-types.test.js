import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadModules() {
  const ctx = {
    console,
    AktUtils: {
      uuid: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    },
    ViolationTemplates: {
      VIOLATION_TYPES: ['Пожарная безопасность', 'Пожароопасные работы', 'Электробезопасность'],
      MAPPING_SEED_TYPES: ['Нарушение требований пожарной безопасности', 'Прочие несоответствия'],
    },
  };
  vm.createContext(ctx);
  const expose = '\nthis.ViolationTypes = ViolationTypes;\n';
  vm.runInContext(readFileSync(join(root, 'js/violation-types.js'), 'utf8') + expose, ctx);
  return ctx.ViolationTypes;
}

describe('ViolationTypes', () => {
  let VT;

  beforeAll(() => {
    VT = loadModules();
  });

  it('ensureCatalog создаёт два реестра и сбрасывает сопоставления', () => {
    const catalog = {
      akts: [],
      violationTypes: [
        { id: 'a1', title: 'Пожароопасные работы', status: 'archived', replacedBy: 'a2' },
        { id: 'a2', title: 'Пожарная безопасность', status: 'active' },
      ],
      typeMappings: { a1: 'a2' },
    };
    VT.ensureCatalog(catalog);
    expect(catalog.violationTypesDualRegistriesV4).toBe(true);
    expect(catalog.typeMappings).toEqual({});
    expect(catalog.violationTypes.every((t) => !t.replacedBy)).toBe(true);
    expect(VT.getTypesByRegistry(catalog, VT.REGISTRY_LEGACY).some((t) => t.title === 'Пожароопасные работы')).toBe(true);
    expect(VT.getActiveTypes(catalog).some((t) => t.title === 'Нарушение требований пожарной безопасности')).toBe(true);
  });

  it('getVidSelectTitles: активные + сохранённый vid без resolve', () => {
    const catalog = { akts: [] };
    VT.ensureCatalog(catalog);
    VT.setMapping(
      catalog,
      VT.findByTitle(catalog, 'Пожароопасные работы').id,
      VT.findByTitle(catalog, 'Нарушение требований пожарной безопасности').id
    );
    const titles = VT.getVidSelectTitles(catalog, 'Пожароопасные работы');
    expect(titles).toContain('Пожароопасные работы');
    expect(titles).toContain('Нарушение требований пожарной безопасности');
    expect(titles.filter((t) => t === 'Пожароопасные работы')).toHaveLength(1);
  });

  it('resolveVid следует сопоставлению для отчётов', () => {
    const catalog = { akts: [] };
    VT.ensureCatalog(catalog);
    const from = VT.findByTitle(catalog, 'Пожароопасные работы');
    const to = VT.findByTitle(catalog, 'Нарушение требований пожарной безопасности');
    VT.setMapping(catalog, from.id, to.id);
    expect(VT.resolveVid(catalog, 'Пожароопасные работы')).toBe('Нарушение требований пожарной безопасности');
  });

  it('syncOrphanVids добавляет виды из актов в реестр from-data', () => {
    const catalog = {
      akts: [{ violations: [{ vid: 'Старый вид из акта' }] }],
      violationTypes: [],
      typeMappings: {},
    };
    VT.ensureCatalog(catalog);
    const orphan = VT.getTypesByRegistry(catalog, VT.REGISTRY_FROM_DATA).find(
      (t) => t.title === 'Старый вид из акта'
    );
    expect(orphan).toBeTruthy();
    expect(orphan.status).toBe('archived');
  });

  it('buildKindStats группирует по resolved vid', () => {
    const catalog = { akts: [] };
    VT.ensureCatalog(catalog);
    VT.setMapping(
      catalog,
      VT.findByTitle(catalog, 'Пожароопасные работы').id,
      VT.findByTitle(catalog, 'Нарушение требований пожарной безопасности').id
    );
    catalog.akts = [
      {
        violations: [
          { vid: 'Пожароопасные работы' },
          { vid: 'Нарушение требований пожарной безопасности' },
        ],
      },
    ];
    const stats = VT.buildKindStats(catalog, { resolve: true });
    expect(stats.get('Нарушение требований пожарной безопасности')).toBe(2);
  });

  it('setMapping и clearMapping', () => {
    const catalog = { akts: [] };
    VT.ensureCatalog(catalog);
    const from = VT.findByTitle(catalog, 'Пожароопасные работы');
    const to = VT.findByTitle(catalog, 'Нарушение требований пожарной безопасности');
    VT.setMapping(catalog, from.id, to.id);
    expect(VT.isMappedToActive(catalog, from)).toBe(true);
    VT.clearMapping(catalog, from.id);
    expect(VT.isMappedToActive(catalog, from)).toBe(false);
  });

  it('addType добавляет в активный реестр Smart Forms', () => {
    const catalog = { akts: [] };
    VT.ensureCatalog(catalog);
    const created = VT.addType(catalog, 'Мой новый вид');
    expect(created.status).toBe('active');
    expect(created.registryId).toBe(VT.REGISTRY_CURRENT);
  });
});
