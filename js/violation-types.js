/**
 * Классификатор видов нарушений: реестры (папки), активные, архив, сопоставления.
 * В актах хранится исходный vid; resolveVid — только для отчётов и дашбордов.
 */
const ViolationTypes = (() => {
  const STATUS_ACTIVE = 'active';
  const STATUS_ARCHIVED = 'archived';
  const STATUS_PENDING = 'pending';

  const REGISTRY_CURRENT = 'smart-forms';
  const REGISTRY_LEGACY = 'legacy-ios';
  const REGISTRY_FROM_DATA = 'from-data';

  function getTypes(catalog) {
    return catalog?.violationTypes || [];
  }

  function getMappings(catalog) {
    return catalog?.typeMappings && typeof catalog.typeMappings === 'object'
      ? catalog.typeMappings
      : {};
  }

  function defaultRegistries() {
    return [
      { id: REGISTRY_CURRENT, title: 'Новые виды (Smart Forms)', order: 1 },
      { id: REGISTRY_LEGACY, title: 'Старые виды (iOS)', order: 2 },
      { id: REGISTRY_FROM_DATA, title: 'Прочие из актов', order: 3 },
    ];
  }

  function getRegistries(catalog) {
    ensureCatalog(catalog);
    const list = catalog?.violationTypeRegistries;
    return Array.isArray(list) && list.length ? [...list].sort((a, b) => (a.order || 0) - (b.order || 0)) : defaultRegistries();
  }

  function findRegistry(catalog, registryId) {
    return getRegistries(catalog).find((r) => r.id === registryId) || null;
  }

  function findById(catalog, id) {
    if (!id) return null;
    return getTypes(catalog).find((t) => t.id === id) || null;
  }

  function findByTitle(catalog, title) {
    const t = String(title || '').trim();
    if (!t) return null;
    return getTypes(catalog).find((x) => x.title === t) || null;
  }

  function legacyBuiltinTitles() {
    const legacy =
      typeof ViolationTemplates !== 'undefined' && Array.isArray(ViolationTemplates.VIOLATION_TYPES)
        ? ViolationTemplates.VIOLATION_TYPES
        : [];
    return new Set(legacy.map((t) => String(t || '').trim()).filter(Boolean));
  }

  function currentBuiltinTitles() {
    return new Set(mappingSeedTypes().map((t) => String(t || '').trim()).filter(Boolean));
  }

  function mappingSeedTypes() {
    return typeof ViolationTemplates !== 'undefined' &&
      Array.isArray(ViolationTemplates.MAPPING_SEED_TYPES)
      ? ViolationTemplates.MAPPING_SEED_TYPES
      : [];
  }

  function isLegacyBuiltinVidTitle(vid) {
    const s = String(vid || '').trim();
    return s ? legacyBuiltinTitles().has(s) : false;
  }

  /** Однократно: два реестра (старые archived + новые active), сброс сопоставлений. */
  function bootstrapDualRegistriesV4(catalog) {
    if (!catalog || catalog.violationTypesDualRegistriesV4) return false;

    const legacy = [...legacyBuiltinTitles()];
    const current = mappingSeedTypes();
    const legacySet = legacyBuiltinTitles();
    const currentSet = currentBuiltinTitles();

    catalog.violationTypeRegistries = defaultRegistries();

    const oldByTitle = new Map(getTypes(catalog).map((t) => [t.title, t]));
    const next = [];
    const usedIds = new Set();

    const pushType = (title, status, registryId) => {
      const prev = oldByTitle.get(title);
      const id = prev?.id && !usedIds.has(prev.id) ? prev.id : AktUtils.uuid();
      usedIds.add(id);
      next.push({ id, title, status, registryId });
      oldByTitle.delete(title);
    };

    legacy.forEach((title) => pushType(title, STATUS_ARCHIVED, REGISTRY_LEGACY));
    current.forEach((title) => pushType(title, STATUS_ACTIVE, REGISTRY_CURRENT));

    for (const t of oldByTitle.values()) {
      let registryId = REGISTRY_FROM_DATA;
      if (legacySet.has(t.title)) registryId = REGISTRY_LEGACY;
      else if (currentSet.has(t.title)) registryId = REGISTRY_CURRENT;
      next.push({
        id: t.id || AktUtils.uuid(),
        title: t.title,
        status: STATUS_ARCHIVED,
        registryId,
      });
    }

    catalog.violationTypes = next;
    catalog.typeMappings = {};
    catalog.violationTypes.forEach((t) => {
      delete t.replacedBy;
      delete t.standalone;
    });
    catalog.dismissedMappingSeeds = [];
    catalog.violationTypesDualRegistriesV4 = true;
    return true;
  }

  function resolveVidChain(catalog, vid) {
    const raw = String(vid || '').trim();
    if (!raw) return '';
    if (!catalog) return raw;

    let current = findByTitle(catalog, raw);
    if (!current) return raw;

    const mappings = getMappings(catalog);
    const visited = new Set();
    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);

      if (current.status === STATUS_ACTIVE) return current.title;

      const nextId = current.replacedBy || mappings[current.id];
      if (!nextId) return current.title;

      current = findById(catalog, nextId);
      if (!current) return raw;
    }
    return raw;
  }

  function collectVidCounts(catalog) {
    const counts = new Map();
    const add = (value) => {
      const s = String(value || '').trim();
      if (!s) return;
      counts.set(s, (counts.get(s) || 0) + 1);
    };
    const scanAkts = (akts) => {
      (akts || []).forEach((akt) => {
        (akt.violations || []).forEach((v) => add(v.vid));
      });
    };
    scanAkts(catalog?.akts);
    scanAkts(catalog?.trash);
    if (catalog?.editableAkt?.akt) scanAkts([catalog.editableAkt.akt]);
    (catalog?.violationRegistry || []).forEach((r) => add(r.vid));
    return counts;
  }

  function syncOrphanVids(catalog) {
    const counts = collectVidCounts(catalog);
    const types = getTypes(catalog);
    const titles = new Set(types.map((t) => t.title));
    let changed = false;

    for (const vid of counts.keys()) {
      if (titles.has(vid)) continue;
      types.push({
        id: AktUtils.uuid(),
        title: vid,
        status: STATUS_ARCHIVED,
        registryId: REGISTRY_FROM_DATA,
      });
      titles.add(vid);
      changed = true;
    }

    if (changed) catalog.violationTypes = types;
    return changed;
  }

  function syncMappingsFromTypes(catalog) {
    const mappings = { ...getMappings(catalog) };
    let changed = false;
    for (const t of getTypes(catalog)) {
      if (t.replacedBy && mappings[t.id] !== t.replacedBy) {
        mappings[t.id] = t.replacedBy;
        changed = true;
      }
    }
    if (changed) catalog.typeMappings = mappings;
    return changed;
  }

  function ensureCatalog(catalog) {
    if (!catalog) return false;
    let changed = false;

    if (!Array.isArray(catalog.violationTypes)) {
      catalog.violationTypes = [];
      changed = true;
    }
    if (!catalog.typeMappings || typeof catalog.typeMappings !== 'object') {
      catalog.typeMappings = {};
      changed = true;
    }
    if (!Array.isArray(catalog.violationTypeRegistries)) {
      catalog.violationTypeRegistries = defaultRegistries();
      changed = true;
    }

    if (bootstrapDualRegistriesV4(catalog)) changed = true;
    if (syncOrphanVids(catalog)) changed = true;
    if (syncMappingsFromTypes(catalog)) changed = true;

    return changed;
  }

  function getActiveTypes(catalog) {
    ensureCatalog(catalog);
    return getTypes(catalog).filter((t) => t.status === STATUS_ACTIVE);
  }

  function getPendingTypes(catalog) {
    ensureCatalog(catalog);
    return getTypes(catalog).filter((t) => t.status === STATUS_PENDING);
  }

  function getMapTargetTypes(catalog) {
    return getActiveTypes(catalog);
  }

  function getArchivedTypes(catalog) {
    ensureCatalog(catalog);
    return getTypes(catalog).filter((t) => t.status === STATUS_ARCHIVED);
  }

  function getTypesByRegistry(catalog, registryId) {
    ensureCatalog(catalog);
    return getTypes(catalog).filter((t) => (t.registryId || REGISTRY_FROM_DATA) === registryId);
  }

  function getActiveTitles(catalog) {
    return getActiveTypes(catalog)
      .map((t) => t.title)
      .sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function isMappedToActive(catalog, type) {
    if (!type) return false;
    const targetId = type.replacedBy || getMappings(catalog)[type.id];
    if (!targetId) return false;
    const target = findById(catalog, targetId);
    return !!(target && target.status === STATUS_ACTIVE);
  }

  function getUnmappedArchived(catalog) {
    ensureCatalog(catalog);
    return getArchivedTypes(catalog).filter((t) => !isMappedToActive(catalog, t));
  }

  function resolveVid(catalog, vid) {
    const raw = String(vid || '').trim();
    if (!raw) return '';
    if (!catalog) return raw;
    ensureCatalog(catalog);
    return resolveVidChain(catalog, vid);
  }

  function usageCount(catalog, typeOrId) {
    ensureCatalog(catalog);
    let type = null;
    if (typeof typeOrId === 'object' && typeOrId?.title) {
      type = typeOrId;
    } else {
      type = findById(catalog, typeOrId) || findByTitle(catalog, typeOrId);
    }
    if (!type) return 0;
    return collectVidCounts(catalog).get(type.title) || 0;
  }

  function addType(catalog, title, { registryId = REGISTRY_CURRENT } = {}) {
    const t = String(title || '').trim();
    if (!t) return null;
    ensureCatalog(catalog);
    const existing = findByTitle(catalog, t);
    if (existing) {
      if (existing.status === STATUS_ARCHIVED) {
        existing.status = STATUS_ACTIVE;
        existing.registryId = registryId || REGISTRY_CURRENT;
        delete existing.replacedBy;
        const mappings = { ...getMappings(catalog) };
        delete mappings[existing.id];
        catalog.typeMappings = mappings;
      }
      return existing;
    }
    const item = {
      id: AktUtils.uuid(),
      title: t,
      status: STATUS_ACTIVE,
      registryId: registryId || REGISTRY_CURRENT,
    };
    catalog.violationTypes = [...getTypes(catalog), item];
    return item;
  }

  function deleteType(catalog, id) {
    const t = findById(catalog, id);
    if (!t) return { ok: false, reason: 'not_found' };

    const usage = usageCount(catalog, t);
    if (usage > 0) {
      return { ok: false, reason: 'in_use', count: usage };
    }

    const types = getTypes(catalog).filter((x) => x.id !== id);
    for (const item of types) {
      if (item.replacedBy === id) delete item.replacedBy;
    }

    const mappings = { ...getMappings(catalog) };
    delete mappings[id];
    for (const key of Object.keys(mappings)) {
      if (mappings[key] === id) delete mappings[key];
    }

    catalog.violationTypes = types;
    catalog.typeMappings = mappings;
    return { ok: true };
  }

  function archiveType(catalog, id) {
    const t = findById(catalog, id);
    if (!t || t.status === STATUS_ARCHIVED) return false;
    t.status = STATUS_ARCHIVED;
    if (!t.registryId) t.registryId = REGISTRY_FROM_DATA;
    return true;
  }

  function countMappedFrom(catalog, toId) {
    if (!toId) return 0;
    const mappings = getMappings(catalog);
    return getArchivedTypes(catalog).filter(
      (t) => t.replacedBy === toId || mappings[t.id] === toId
    ).length;
  }

  function getMappedFromTitles(catalog, toId) {
    if (!toId) return [];
    const mappings = getMappings(catalog);
    return getArchivedTypes(catalog)
      .filter((t) => t.replacedBy === toId || mappings[t.id] === toId)
      .map((t) => t.title);
  }

  function setMapping(catalog, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return false;
    ensureCatalog(catalog);
    const from = findById(catalog, fromId);
    const to = findById(catalog, toId);
    if (!from || !to) return false;
    if (to.status !== STATUS_ACTIVE) {
      to.status = STATUS_ACTIVE;
    }
    delete to.standalone;

    from.status = STATUS_ARCHIVED;
    from.replacedBy = toId;
    catalog.typeMappings = { ...getMappings(catalog), [fromId]: toId };
    return true;
  }

  function clearMapping(catalog, fromId) {
    const from = findById(catalog, fromId);
    if (!from) return false;
    delete from.replacedBy;
    const mappings = { ...getMappings(catalog) };
    delete mappings[fromId];
    catalog.typeMappings = mappings;
    return true;
  }

  function buildKindStats(catalog, { resolve = true } = {}) {
    const stats = new Map();
    const addViolation = (v) => {
      const raw = String(v?.vid || '').trim();
      if (!raw) return;
      const kind = resolve ? resolveVid(catalog, raw) : raw;
      if (!kind) return;
      stats.set(kind, (stats.get(kind) || 0) + 1);
    };
    const scan = (akts) => {
      (akts || []).forEach((akt) => {
        (akt.violations || []).forEach(addViolation);
      });
    };
    scan(catalog?.akts);
    scan(catalog?.trash);
    if (catalog?.editableAkt?.akt) scan([catalog.editableAkt.akt]);
    return stats;
  }

  function formatVidDisplay(catalog, vid) {
    const raw = String(vid || '').trim();
    if (!raw) return { display: '', original: '', migrated: false };
    const resolved = resolveVid(catalog, raw);
    return {
      display: resolved || raw,
      original: raw,
      migrated: !!(resolved && resolved !== raw),
    };
  }

  function getRegistryVidTitles(catalog) {
    ensureCatalog(catalog);
    const titles = new Set();
    (catalog?.violationRegistry || []).forEach((r) => {
      const v = resolveVid(catalog, r.vid);
      if (v) titles.add(v);
    });
    return [...titles].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  /** Select: только активные + сохранённое значение при редактировании (без подмены). */
  function getVidSelectTitles(catalog, rawVid) {
    ensureCatalog(catalog);
    const raw = String(rawVid || '').trim();
    const merged = new Set(getActiveTitles(catalog));
    if (raw) merged.add(raw);
    return [...merged].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function ensureActiveType(catalog, title) {
    const t = String(title || '').trim();
    if (!t) return null;
    return addType(catalog, t);
  }

  return {
    STATUS_ACTIVE,
    STATUS_ARCHIVED,
    STATUS_PENDING,
    REGISTRY_CURRENT,
    REGISTRY_LEGACY,
    REGISTRY_FROM_DATA,
    ensureCatalog,
    getTypes,
    getMappings,
    getRegistries,
    findRegistry,
    getActiveTypes,
    getPendingTypes,
    getMapTargetTypes,
    getArchivedTypes,
    getTypesByRegistry,
    getActiveTitles,
    getUnmappedArchived,
    findById,
    findByTitle,
    resolveVid,
    usageCount,
    collectVidCounts,
    addType,
    deleteType,
    archiveType,
    setMapping,
    clearMapping,
    countMappedFrom,
    getMappedFromTitles,
    isMappedToActive,
    buildKindStats,
    formatVidDisplay,
    getRegistryVidTitles,
    getVidSelectTitles,
    ensureActiveType,
    bootstrapDualRegistriesV4,
    isLegacyBuiltinVidTitle,
    legacyBuiltinTitles,
  };
})();
