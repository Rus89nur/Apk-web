import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeAll } from 'vitest';
import PizZip from 'pizzip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadDocGenerator() {
  const ctx = { console, Date, Math, JSON, parseInt, String, Number, isNaN: Number.isNaN };
  vm.createContext(ctx);
  const expose = '\nif (typeof AktUtils !== "undefined") this.AktUtils = AktUtils;\n';
  vm.runInContext(readFileSync(join(root, 'js/akt-utils.js'), 'utf8') + expose, ctx);
  vm.runInContext(
    readFileSync(join(root, 'js/doc-generator.js'), 'utf8') +
      '\nif (typeof DocGenerator !== "undefined") this.DocGenerator = DocGenerator;\n',
    ctx
  );
  return ctx.DocGenerator;
}

function loadDocGeneratorWithDom({ shareFiles = false, shareAbort = false } = {}) {
  const downloads = [];
  const openCalls = [];
  const shareCalls = [];

  const fakeAnchor = () => ({
    href: '',
    download: '',
    type: '',
    rel: '',
    click() {},
  });

  const ctx = {
    console,
    Date,
    Math,
    JSON,
    parseInt,
    String,
    Number,
    isNaN: Number.isNaN,
    Blob,
    File,
    Uint8Array,
    ArrayBuffer,
    URL: {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL() {},
    },
    PizZip,
    document: {
      createElement(tag) {
        if (tag === 'a') return fakeAnchor();
        if (tag === 'script') return { src: '', onload: null, onerror: null };
        return {};
      },
      body: { appendChild() {}, removeChild() {} },
      head: { appendChild() {} },
    },
    navigator: {},
    window: {
      open(...args) {
        openCalls.push(args);
        return null;
      },
    },
    GazpromFileUtils: {
      downloadBlob(blob, fileName) {
        downloads.push({ blob, fileName });
      },
    },
    RegistryAnalytics: {
      analyticsFileName(model) {
        const iso = String(model?.meta?.generatedAt || '').slice(0, 10) || '1970-01-01';
        return `Analiticheskaya_spravka_reestr_${iso}.docx`;
      },
    },
  };

  if (shareFiles) {
    ctx.navigator.canShare = () => true;
    ctx.navigator.share = async (payload) => {
      if (shareAbort) {
        const err = new Error('Abort');
        err.name = 'AbortError';
        throw err;
      }
      shareCalls.push(payload);
    };
  }

  vm.createContext(ctx);
  vm.runInContext(
    readFileSync(join(root, 'js/doc-generator.js'), 'utf8') +
      '\nif (typeof DocGenerator !== "undefined") this.DocGenerator = DocGenerator;\n',
    ctx
  );
  return { DocGenerator: ctx.DocGenerator, downloads, openCalls, shareCalls };
}

describe('DocGenerator.buildTemplateData', () => {
  let DocGenerator;

  beforeAll(() => {
    DocGenerator = loadDocGenerator();
  });

  it('strips quotes from object name and formats signatures and attendees', () => {
    const data = DocGenerator.buildTemplateData({
      number: '1',
      date: '2026-06-01T12:00:00.000Z',
      objectsCheck: [{ title: '«Котельная №2»' }],
      organization: { title: 'ООО Тест' },
      comission: [{ fio: 'Иванов Иван Иванович', jobTitle: 'Председатель' }],
      predstavitelyComission: [
        { fio: 'Петров Пётр Петрович', jobTitle: 'Директор' },
        { fio: 'Сидоров Сидор Сидорович', jobTitle: 'Инженер' },
      ],
      violations: [],
    });

    expect(data.NameObject).toBe('Котельная №2');
    expect(data.Pedstav).toBe('директор - Петров Пётр Петрович, инженер - Сидоров Сидор Сидорович');
    expect(data.predVoiceLines).toEqual(['Председатель И.И. Иванов']);
    expect(data.pedstavVoiceLines).toEqual(['Директор П.П. Петров', 'Инженер С.С. Сидоров']);
  });

  it('preserves violation text with line breaks and spaces in template data', () => {
    const data = DocGenerator.buildTemplateData({
      number: '2',
      date: '2026-06-01T12:00:00.000Z',
      violations: [
        {
          title: '  Первая строка\nВторая строка  ',
          mesto: 'Лестница\n2 этаж',
          urlToPravilo: 'п. 1\nп. 2',
          formulaFromRules: 'Формула\nс переносом',
        },
      ],
    });

    expect(data.violations[0].ddescrVi).toBe('  Первая строка\nВторая строка  ');
    expect(data.violations[0].TitleViolatation).toBe('Лестница\n2 этаж');
    expect(data.violations[0].urlDoc).toBe('п. 1\nп. 2');
    expect(data.violations[0].formula).toBe('Формула\nс переносом');
  });

  it('converts line breaks to Word XML breaks for table cells', () => {
    expect(DocGenerator.toWordMultilineTextXml('строка 1\nстрока 2')).toBe(
      'строка 1</w:t><w:br/><w:t>строка 2'
    );
    expect(DocGenerator.toWordMultilineTextXml('одна строка')).toBe('одна строка');
    expect(DocGenerator.toWordMultilineTextXml('a<b\n&c')).toBe(
      'a&lt;b</w:t><w:br/><w:t>&amp;c'
    );
  });

  it('blank template includes marker guide groups', () => {
    const guide = DocGenerator.getMarkerGuide();
    expect(guide.length).toBeGreaterThan(3);
    expect(guide.some((g) => g.items.some((i) => i.key === 'Number'))).toBe(true);
    expect(guide.some((g) => g.items.some((i) => i.key === 'PoradNum'))).toBe(true);
    expect(guide[0].items[0]).toMatchObject({ key: expect.any(String), label: expect.any(String) });
  });

  it('blank template download filenames are ASCII .docx', () => {
    expect(DocGenerator.BLANK_TEMPLATE_FILENAME).toBe('Blank_akt_template.docx');
    expect(DocGenerator.BLANK_SPRAVKA_TEMPLATE_FILENAME).toBe('Blank_spravka_template.docx');
    expect(DocGenerator.BLANK_TEMPLATE_FILENAME).toMatch(/^[\x20-\x7E]+\.docx$/);
    expect(DocGenerator.BLANK_SPRAVKA_TEMPLATE_FILENAME).toMatch(/^[\x20-\x7E]+\.docx$/);
  });

  it('toAsciiDocxFileName strips non-ASCII and keeps .docx', () => {
    expect(DocGenerator.toAsciiDocxFileName('Шаблон_акта_пустой.docx')).toMatch(
      /^[\x20-\x7E]+\.docx$/
    );
    expect(DocGenerator.toAsciiDocxFileName('Analiticheskaya_spravka_reestr_2026-03-05.docx')).toBe(
      'Analiticheskaya_spravka_reestr_2026-03-05.docx'
    );
  });
});

describe('DocGenerator registry analytics docx', () => {
  it('downloadRegistryAnalyticsDocx yields valid zip with analytics title and Latin filename', async () => {
    const { DocGenerator, downloads, openCalls } = loadDocGeneratorWithDom();
    const model = {
      meta: { total: 1, generatedAt: '2026-03-05T10:00:00.000Z', registryName: 'Тест' },
      byVid: [{ vid: 'Альфа', count: 1, sharePct: 100, samples: ['Пример'] }],
      clusters: [],
      checklist: [{ direction: 'Направление', questions: ['Вопрос?'] }],
    };

    const result = await DocGenerator.downloadRegistryAnalyticsDocx(model);
    expect(result).toBe('download');
    expect(openCalls).toHaveLength(0);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName).toBe('Analiticheskaya_spravka_reestr_2026-03-05.docx');
    expect(downloads[0].fileName).toMatch(/^[\x20-\x7E]+\.docx$/);

    const blob = downloads[0].blob;
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');

    const zip = new PizZip(bytes);
    const xml = zip.files['word/document.xml']?.asText() || '';
    expect(xml).toContain('Аналитическая справка');
  });

  it('openDocxBlob download path never calls window.open', async () => {
    const { DocGenerator, downloads, openCalls } = loadDocGeneratorWithDom();
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: mime });

    const result = await DocGenerator.openDocxBlob(blob, 'Analiticheskaya_spravka_reestr_2026-03-05.docx');
    expect(result).toBe('download');
    expect(openCalls).toHaveLength(0);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName).toBe('Analiticheskaya_spravka_reestr_2026-03-05.docx');
  });

  it('openDocxBlob uses navigator.share when canShare(files) and skips window.open', async () => {
    const { DocGenerator, downloads, openCalls, shareCalls } = loadDocGeneratorWithDom({
      shareFiles: true,
    });
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const blob = new Blob([new Uint8Array([0x50, 0x4b])], { type: mime });

    const result = await DocGenerator.openDocxBlob(
      blob,
      'Analiticheskaya_spravka_reestr_2026-03-05.docx'
    );
    expect(result).toBe('shared');
    expect(shareCalls).toHaveLength(1);
    expect(shareCalls[0].title).toBe('Analiticheskaya_spravka_reestr_2026-03-05.docx');
    expect(shareCalls[0].files[0].name).toBe('Analiticheskaya_spravka_reestr_2026-03-05.docx');
    expect(shareCalls[0].files[0].type).toBe(mime);
    expect(downloads).toHaveLength(0);
    expect(openCalls).toHaveLength(0);
  });

  it('openDocxBlob AbortError from share returns cancelled without download', async () => {
    const { DocGenerator, downloads, openCalls } = loadDocGeneratorWithDom({
      shareFiles: true,
      shareAbort: true,
    });
    const blob = new Blob([new Uint8Array([0x50, 0x4b])], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const result = await DocGenerator.openDocxBlob(blob, 'doc.docx');
    expect(result).toBe('cancelled');
    expect(downloads).toHaveLength(0);
    expect(openCalls).toHaveLength(0);
  });
});
