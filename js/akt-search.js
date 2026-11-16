/** Поиск и фильтрация актов (история, глобальный поиск). */
const AktSearch = (() => {
  function isDraft(akt) {
    return AktUtils.isDraft(akt);
  }

  function getOrgTitle(akt) {
    return akt.organization?.shortTitle || akt.organization?.title || '';
  }

  /** Календарный локальный год, как в списке («Проверка: …»). Невалидная дата — года нет. */
  function getAktYear(akt) {
    const iso = akt?.date;
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.getFullYear();
  }

  function normalizeYearList(values) {
    const out = [];
    for (const value of values || []) {
      const y = parseInt(value, 10);
      if (!Number.isNaN(y)) out.push(y);
    }
    return out;
  }

  function collectYears(akts) {
    const years = new Set();
    for (const akt of akts || []) {
      const y = getAktYear(akt);
      if (y != null) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }

  function filterAkts(
    akts,
    {
      query = '',
      year = null,
      years = null,
      violationsOnly = false,
      draftsOnly = false,
      completedOnly = false,
      shortOnly = false,
      fullOnly = false,
    } = {}
  ) {
    let list = [...(akts || [])];

    const yearSet =
      years != null && years.length
        ? normalizeYearList(years)
        : year != null
          ? normalizeYearList([year])
          : null;
    if (yearSet?.length) {
      const coversAllKnown = collectYears(list).every((y) => yearSet.includes(y));
      if (!coversAllKnown) {
        list = list.filter((a) => {
          const y = getAktYear(a);
          return y != null && yearSet.includes(y);
        });
      }
    }

    if (violationsOnly) {
      list = list.filter((a) => (a.violations || []).length > 0);
    }

    if (draftsOnly) {
      list = list.filter(isDraft);
    }

    if (completedOnly) {
      list = list.filter((a) => !isDraft(a));
    }

    if (shortOnly || fullOnly) {
      list = list.filter((a) => {
        const short = AktUtils.isShortFormat(a);
        const full = AktUtils.isFullFormat(a);
        if (shortOnly && fullOnly) return short || full;
        if (shortOnly) return short;
        return full;
      });
    }

    const q = String(query).trim().toLowerCase();
    if (q) {
      list = list.filter((a) => {
        const haystack = [
          String(a.number),
          getOrgTitle(a),
          a.description,
          ...(a.objectsCheck || []).map((o) => `${o.title} ${o.subTitle}`),
          ...(a.violations || []).map((v) => `${v.title} ${v.mesto}`),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return list;
  }

  function compareAkts(a, b, key) {
    switch (key) {
      case 'number': {
        const na = parseInt(a.number, 10);
        const nb = parseInt(b.number, 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return String(a.number).localeCompare(String(b.number), 'ru', { numeric: true });
      }
      case 'date': {
        const da = new Date(a.date).getTime() || 0;
        const db = new Date(b.date).getTime() || 0;
        return da - db;
      }
      case 'organization':
        return getOrgTitle(a).localeCompare(getOrgTitle(b), 'ru');
      case 'violations':
        return (a.violations || []).length - (b.violations || []).length;
      default:
        return 0;
    }
  }

  function sortAkts(list, key, direction = 'desc') {
    const mul = direction === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => mul * compareAkts(a, b, key));
  }

  function parseFilterPill(label) {
    const t = String(label).trim();
    if (t === 'Все') {
      return {
        years: [],
        violationsOnly: false,
        draftsOnly: false,
        shortOnly: false,
        fullOnly: false,
      };
    }
    if (t === 'С нарушениями') {
      return { years: [], violationsOnly: true, draftsOnly: false, shortOnly: false, fullOnly: false };
    }
    if (t === 'Черновики') {
      return { years: [], draftsOnly: true, shortOnly: false, fullOnly: false };
    }
    if (t === 'Сокращённые') {
      return { years: [], shortOnly: true, draftsOnly: false, fullOnly: false };
    }
    if (t === 'Полные') {
      return { years: [], fullOnly: true, draftsOnly: false, shortOnly: false };
    }
    const y = parseInt(t, 10);
    if (!Number.isNaN(y) && y > 2000) {
      return { years: [y], violationsOnly: false, draftsOnly: false, shortOnly: false, fullOnly: false };
    }
    return {};
  }

  function filterFromActivePills(pills) {
    const years = [];
    let violationsOnly = false;
    let draftsOnly = false;
    let shortOnly = false;
    let fullOnly = false;

    for (const btn of pills) {
      if (!btn.classList.contains('active')) continue;
      const kind = btn.dataset.filter;
      if (!kind || kind === 'all') continue;
      if (kind === 'year') {
        const y = parseInt(btn.dataset.filterValue, 10);
        if (!Number.isNaN(y)) years.push(y);
        continue;
      }
      if (kind === 'violations') violationsOnly = true;
      if (kind === 'drafts') draftsOnly = true;
      if (kind === 'short') shortOnly = true;
      if (kind === 'full') fullOnly = true;
    }

    return { years, violationsOnly, draftsOnly, shortOnly, fullOnly };
  }

  return {
    filterAkts,
    sortAkts,
    parseFilterPill,
    filterFromActivePills,
    isDraft,
    getOrgTitle,
    getAktYear,
    collectYears,
  };
})();
