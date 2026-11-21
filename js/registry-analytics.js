/**
 * RegistryAnalytics — детерминированная аналитическая справка по реестру нарушений.
 * Без LLM/сети: группировка по vid, фиксированные кластеры, статический чек-лист.
 */
const RegistryAnalytics = (() => {
  const EMPTY_VID = 'Без вида';
  const SAMPLE_LIMIT = 3;
  const SAMPLE_MAX_LEN = 140;

  /** Кластеры без совпадений опускаются (count > 0). */
  const CLUSTER_RULES = [
    {
      id: 'height',
      title: 'Работы на высоте и средства подмащивания',
      keywords: ['высот', 'привяз', 'лестниц', 'стремян', 'подмащив', 'леса ', 'анкер', 'страховоч'],
    },
    {
      id: 'fire',
      title: 'Пожарная безопасность и огневые работы',
      keywords: ['пожарн', 'огнетуш', 'огневы', 'сварк', 'горюч', 'эвакуац', 'противопож', 'огнеопас'],
    },
    {
      id: 'gas',
      title: 'Газ и газовые баллоны',
      keywords: ['газ', 'баллон', 'редуктор', 'пропанов', 'кислород'],
    },
    {
      id: 'ppe',
      title: 'СИЗ и спецодежда',
      keywords: ['сиз', 'каск', 'перчат', 'спецодежд', 'спецобув', 'очк'],
    },
    {
      id: 'electro',
      title: 'Электробезопасность',
      keywords: ['электр', 'кабел', 'заземл', 'розетк', 'узо', 'токоведущ', 'удлинител'],
    },
    {
      id: 'earthworks',
      title: 'Земляные работы',
      keywords: ['землян', 'котлован', 'транше', 'выемк', 'колодц'],
    },
    {
      id: 'machines',
      title: 'Машины, механизмы и подъёмные сооружения',
      keywords: ['машин', 'механизм', 'кран', 'подъём', 'подъем', 'строп', 'грузоподъём', 'грузоподъем'],
    },
    {
      id: 'docs',
      title: 'Документация и организация контроля',
      keywords: ['обучен', 'инструктаж', 'журнал', 'наряд', 'контрол', 'допуск', 'инструкци'],
    },
    {
      id: 'sanitary',
      title: 'Санитарно-бытовые условия и прочее',
      keywords: ['санитар', 'бытов', 'склад', 'погруз', 'перевозк', 'дорожн'],
    },
  ];

  /** Статический чек-лист (9 направлений). Синхронизирован с assets/defaults/registry-analytics-checklist.json */
  const DEFAULT_CHECKLIST = [
    {
      direction: 'Работы на высоте',
      questions: [
        'Есть ли ограждения, страховка и анкерные точки на рабочих местах на высоте?',
        'Применяются ли страховочные привязи и удерживающие системы при работах на высоте?',
        'Исправны ли лестницы, стремянки и средства подмащивания?',
        'Оформлены ли наряды-допуски и проведены ли целевые инструктажи на высотные работы?',
        'Есть ли обозначение опасных зон возможного падения предметов?',
      ],
    },
    {
      direction: 'Пожарная безопасность и огневые работы',
      questions: [
        'Исправны ли и доступны ли огнетушители, щиты и средства пожаротушения?',
        'Свободны ли эвакуационные пути, проезды и подъезды для пожарной техники?',
        'Оформлены ли наряды-допуски на огневые работы и соблюдаются ли меры при сварке/резке?',
        'Исправна ли автоматическая пожарная сигнализация и система оповещения?',
        'Нет ли захламления горючими материалами и нарушений хранения ЛВЖ?',
      ],
    },
    {
      direction: 'Газовые баллоны и работы с газом',
      questions: [
        'Правильно ли хранятся и закреплены газовые баллоны (крышки, вентили, расстояние до источников тепла)?',
        'Исправны ли редукторы, шланги и соединения газового оборудования?',
        'Есть ли предупреждающие знаки и раздельное хранение полных/пустых баллонов?',
        'Соблюдаются ли требования при перевозке и перемещении баллонов?',
        'Проведен ли инструктаж по безопасному обращению с газом?',
      ],
    },
    {
      direction: 'СИЗ и спецодежда',
      questions: [
        'Обеспечены ли работники необходимыми СИЗ по видам работ?',
        'Применяют ли работники каски, очки, перчатки, спецобувь на рабочих местах?',
        'Исправны ли и своевременно заменяются ли СИЗ с истёкшим сроком?',
        'Есть ли учёт выдачи СИЗ и контроль их применения?',
        'Соответствует ли спецодежда условиям работ (высота, сварка, электро)?',
      ],
    },
    {
      direction: 'Электробезопасность',
      questions: [
        'Исправны ли кабели, удлинители, розетки и отсутствует ли повреждение изоляции?',
        'Есть ли защитное заземление/зануление электроустановок и оборудования?',
        'Применяются ли УЗО, автоматические выключатели и средства защиты от поражения током?',
        'Допущены ли к работам электротехнический персонал с действующей группой?',
        'Нет ли самодельных соединений и открытых токоведущих частей?',
      ],
    },
    {
      direction: 'Земляные работы',
      questions: [
        'Оформлены ли разрешения/наряды на земляные работы и согласованы ли коммуникации?',
        'Есть ли ограждение котлованов, траншей и обозначение опасных зон?',
        'Соблюдаются ли откосы, крепление стенок и безопасные спуски в выемки?',
        'Обеспечена ли вентиляция и контроль газов в колодцах/траншеях при необходимости?',
        'Организовано ли складирование грунта без угрозы обрушения и перекрытия проездов?',
      ],
    },
    {
      direction: 'Машины, механизмы и подъёмные сооружения',
      questions: [
        'Исправны ли грузоподъёмные механизмы, стропы и съёмные грузозахватные приспособления?',
        'Есть ли действующие удостоверения у машинистов/крановщиков и стропальщиков?',
        'Соблюдаются ли зоны работы крана, сигнализация и присутствие стропальщика?',
        'Исправны ли ограждения вращающихся частей и блокировки оборудования?',
        'Ведётся ли учёт техобслуживания и не используются ли неисправные машины?',
      ],
    },
    {
      direction: 'Документация и организация контроля',
      questions: [
        'Ведутся ли журналы инструктажей, нарядов-допусков и учёта проверок?',
        'Актуальны ли инструкции по охране труда и производственной безопасности на объекте?',
        'Назначены ли ответственные за ПБ и внутренний контроль на ОРП?',
        'Проводятся ли плановые проверки и фиксируются ли устранения замечаний?',
        'Есть ли схемы эвакуации, планы производства работ и необходимые разрешения?',
      ],
    },
    {
      direction: 'Санитарно-бытовые условия и прочее',
      questions: [
        'Обеспечены ли бытовые помещения, вода, места для приёма пищи и отдыха?',
        'Содержится ли территория в порядке (чистота, освещение, проходы)?',
        'Организованы ли погрузочно-разгрузочные работы и складирование материалов безопасно?',
        'Соблюдаются ли требования БДД при перевозке пассажиров и грузов на объекте?',
        'Устранены ли прочие выявленные несоответствия из реестра по объекту?',
      ],
    },
  ];

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е');
  }

  function shortSample(title) {
    const t = String(title ?? '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    if (t.length <= SAMPLE_MAX_LEN) return t;
    return `${t.slice(0, SAMPLE_MAX_LEN - 1)}…`;
  }

  function resolveItemVid(item, catalog) {
    const raw = item?.vid;
    if (catalog && typeof ViolationTypes !== 'undefined' && typeof ViolationTypes.resolveVid === 'function') {
      const resolved = ViolationTypes.resolveVid(catalog, raw);
      const t = String(resolved || raw || '').trim();
      return t || EMPTY_VID;
    }
    const t = String(raw || '').trim();
    return t || EMPTY_VID;
  }

  function itemSearchBlob(item, resolvedVid) {
    return normalizeText([item?.title, item?.description, item?.vid, resolvedVid].filter(Boolean).join(' '));
  }

  function pickSamples(items) {
    const out = [];
    for (const item of items) {
      const s = shortSample(item?.title);
      if (!s) continue;
      out.push(s);
      if (out.length >= SAMPLE_LIMIT) break;
    }
    return out;
  }

  function buildByVid(items, catalog) {
    const map = new Map();
    for (const item of items) {
      const vid = resolveItemVid(item, catalog);
      if (!map.has(vid)) map.set(vid, []);
      map.get(vid).push(item);
    }
    const total = items.length || 1;
    const rows = [...map.entries()].map(([vid, list]) => {
      const count = list.length;
      return {
        vid,
        count,
        sharePct: Math.round((count / total) * 1000) / 10,
        samples: pickSamples(list),
      };
    });
    rows.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.vid).localeCompare(String(b.vid), 'ru');
    });
    return rows;
  }

  function buildClusters(items, catalog, rules = CLUSTER_RULES) {
    const clusters = [];
    for (const rule of rules) {
      const keywords = (rule.keywords || []).map((k) => normalizeText(k)).filter(Boolean);
      const matched = [];
      const matchedKeywords = new Set();
      for (const item of items) {
        const vid = resolveItemVid(item, catalog);
        const blob = itemSearchBlob(item, vid);
        const hits = keywords.filter((kw) => blob.includes(kw));
        if (!hits.length) continue;
        matched.push(item);
        hits.forEach((h) => matchedKeywords.add(h));
      }
      if (!matched.length) continue; // пустые кластеры опускаем
      clusters.push({
        id: rule.id,
        title: rule.title,
        count: matched.length,
        keywordsMatched: [...matchedKeywords],
        samples: pickSamples(matched),
      });
    }
    return clusters;
  }

  function buildChecklist(template = DEFAULT_CHECKLIST) {
    return (template || []).map((row) => ({
      direction: String(row.direction || '').trim(),
      questions: (row.questions || []).map((q) => String(q || '').trim()).filter(Boolean),
    }));
  }

  /**
   * @param {Array} items — записи реестра (ViolationRegistry.getAll())
   * @param {{ catalog?: object, registryName?: string, generatedAt?: string|Date, checklist?: Array, clusters?: Array }} [options]
   */
  function buildAnalyticsModel(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const catalog = options.catalog;
    const generatedAt = options.generatedAt
      ? new Date(options.generatedAt).toISOString()
      : new Date().toISOString();
    const checklist = buildChecklist(options.checklist || DEFAULT_CHECKLIST);
    const clusterRules = options.clusters || CLUSTER_RULES;

    return {
      meta: {
        registryName: options.registryName || undefined,
        total: list.length,
        generatedAt,
      },
      byVid: buildByVid(list, catalog),
      clusters: buildClusters(list, catalog, clusterRules),
      checklist,
    };
  }

  function formatDateForFile(iso) {
    const d = iso ? new Date(iso) : new Date();
    const src = Number.isNaN(d.getTime()) ? new Date() : d;
    return `${src.getUTCFullYear()}-${String(src.getUTCMonth() + 1).padStart(2, '0')}-${String(src.getUTCDate()).padStart(2, '0')}`;
  }

  function analyticsFileName(model) {
    return `Analiticheskaya_spravka_reestr_${formatDateForFile(model?.meta?.generatedAt)}.docx`;
  }

  return {
    EMPTY_VID,
    CLUSTER_RULES,
    DEFAULT_CHECKLIST,
    buildAnalyticsModel,
    analyticsFileName,
    formatDateForFile,
  };
})();

if (typeof window !== 'undefined') {
  window.RegistryAnalytics = RegistryAnalytics;
}
