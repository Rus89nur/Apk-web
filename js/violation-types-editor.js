/**
 * Виды нарушений — вариант 1: один экран, реестры-папки, inline-сопоставление.
 */
const ViolationTypesEditor = (() => {
  const FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'active', label: 'Активные' },
    { key: 'unmapped', label: 'Без пары' },
  ];

  let catalog = null;
  let listFilter = 'all';
  let screenQuery = '';
  let bound = false;
  const collapsedRegistries = new Set();

  function esc(s) {
    return AktUtils.escapeHtml(String(s ?? ''));
  }

  async function loadCatalog() {
    catalog = await GazpromStore.get();
    if (!catalog) {
      catalog = { akts: [], violationTypes: [], typeMappings: {}, violationTypeRegistries: [] };
    }
    if (ViolationTypes.ensureCatalog(catalog)) {
      await GazpromStore.set(catalog);
      GazpromStore.invalidateCache();
    }
    return catalog;
  }

  async function saveCatalog(message) {
    await GazpromStore.set(catalog);
    GazpromStore.invalidateCache();
    await GazpromUI.refreshAll();
    if (message) GazpromToast.success(message);
  }

  function filterByQuery(items) {
    const q = screenQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) => t.title.toLowerCase().includes(q));
  }

  function matchesListFilter(type) {
    if (listFilter === 'active') return type.status === ViolationTypes.STATUS_ACTIVE;
    if (listFilter === 'unmapped') {
      return (
        type.status === ViolationTypes.STATUS_ARCHIVED &&
        !ViolationTypes.isMappedToActive(catalog, type)
      );
    }
    return true;
  }

  function activeMapOptions(selectedId) {
    const items = ViolationTypes.getActiveTypes(catalog);
    const opts = [`<option value="">— выберите новый вид —</option>`];
    for (const t of items) {
      opts.push(
        `<option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.title)}</option>`
      );
    }
    return opts.join('');
  }

  function renderTypeRow(type, { showMap = false } = {}) {
    const n = ViolationTypes.usageCount(catalog, type);
    const isActive = type.status === ViolationTypes.STATUS_ACTIVE;
    const mapped = ViolationTypes.isMappedToActive(catalog, type);
    const mappedId = type.replacedBy || ViolationTypes.getMappings(catalog)[type.id] || '';

    const statusBadge = isActive
      ? '<span class="vt-badge vt-badge--active">активный</span>'
      : '<span class="vt-badge vt-badge--archived">архив</span>';
    const mapBadge = !isActive
      ? mapped
        ? '<span class="vt-badge vt-badge--ok">сопоставлен</span>'
        : '<span class="vt-badge vt-badge--warn">нет пары</span>'
      : '';

    const mapBlock =
      showMap && !isActive
        ? `<label class="vt-inline-map-label">Сопоставить с новым видом</label>
           <select class="form-control vt-inline-map-select" data-vt-map-from="${esc(type.id)}" aria-label="Сопоставление для ${esc(type.title)}">
             ${activeMapOptions(mappedId)}
           </select>`
        : '';

    const actions = isActive
      ? `<button type="button" class="btn-ghost btn-sm" data-vt-archive="${esc(type.id)}" title="В архив">📦</button>
         <button type="button" class="btn-ghost btn-sm modal-btn-danger" data-vt-delete="${esc(type.id)}" title="Удалить">🗑</button>`
      : mapped
        ? `<button type="button" class="btn-ghost btn-sm" data-vt-clear-map="${esc(type.id)}" title="Снять сопоставление">✕</button>
           <button type="button" class="btn-ghost btn-sm modal-btn-danger" data-vt-delete="${esc(type.id)}" title="Удалить">🗑</button>`
        : `<button type="button" class="btn-ghost btn-sm modal-btn-danger" data-vt-delete="${esc(type.id)}" title="Удалить">🗑</button>`;

    return `<article class="vt-folder-item ${isActive ? 'vt-folder-item--active' : 'vt-folder-item--archived'}">
      <div class="vt-folder-item__head">
        <div class="vt-folder-item__title">${esc(type.title)} ${statusBadge}${mapBadge}</div>
        <div class="vt-folder-item__meta">
          <span class="vt-badge vt-badge--count">${n || 0} в данных</span>
          <span class="vt-folder-item__actions btn-row">${actions}</span>
        </div>
      </div>
      ${mapBlock}
    </article>`;
  }

  function renderRegistrySection(registry, types) {
    const filtered = filterByQuery(types).filter(matchesListFilter);
    if (!filtered.length && screenQuery.trim()) return '';

    const isCollapsed = collapsedRegistries.has(registry.id);
    const unmappedN = types.filter(
      (t) => t.status === ViolationTypes.STATUS_ARCHIVED && !ViolationTypes.isMappedToActive(catalog, t)
    ).length;
    const isCurrent = registry.id === ViolationTypes.REGISTRY_CURRENT;
    const warn =
      !isCurrent && unmappedN > 0
        ? ` <span class="vt-badge vt-badge--warn">${unmappedN} без пары</span>`
        : '';

    const body =
      filtered.length === 0
        ? `<p class="vt-empty vt-empty--inline">Нет видов в этом разделе</p>`
        : filtered.map((t) => renderTypeRow(t, { showMap: !isCurrent })).join('');

    return `<section class="vt-folder" data-vt-registry="${esc(registry.id)}">
      <button type="button" class="vt-folder__head" data-vt-toggle-registry="${esc(registry.id)}" aria-expanded="${!isCollapsed}">
        <span class="vt-folder__icon">${isCurrent ? '📂' : '📁'}</span>
        <span class="vt-folder__title">${esc(registry.title)}${warn}</span>
        <span class="vt-folder__count">${types.length}</span>
        <span class="vt-folder__chevron">${isCollapsed ? '▸' : '▾'}</span>
      </button>
      <div class="vt-folder__body" ${isCollapsed ? 'hidden' : ''}>${body}</div>
    </section>`;
  }

  function renderHeader() {
    const host = document.getElementById('vtScreenHost');
    if (!host) return;

    const unmapped = ViolationTypes.getUnmappedArchived(catalog).length;
    const alert =
      unmapped > 0
        ? `<div class="vt-alert vt-alert--warn" role="status">
            <span>⚠️</span>
            <span>${unmapped} ${unmapped === 1 ? 'устаревший вид' : 'устаревших видов'} без сопоставления — отчёты покажут их отдельно</span>
          </div>`
        : '';

    const filterBtns = FILTERS.map((f) => {
      const active = listFilter === f.key ? ' active' : '';
      const count =
        f.key === 'active'
          ? ViolationTypes.getActiveTypes(catalog).length
          : f.key === 'unmapped'
            ? unmapped
            : ViolationTypes.getTypes(catalog).length;
      return `<button type="button" class="vt-filter-btn${active}" data-vt-filter="${f.key}">${esc(f.label)} (${count})</button>`;
    }).join('');

    host.innerHTML = `
      <div class="violations-screen-header card">
        <div class="violations-screen-nav">
          <button class="btn-ghost btn-sm" type="button" data-go="settings">← Настройки</button>
          <span class="violations-screen-breadcrumb">/ Виды нарушений</span>
        </div>
        <p class="vt-screen-hint">В актах сохраняется исходный вид. Сопоставление нужно для отчётов и «Результатов проверок».</p>
        ${alert}
        <div class="vt-toolbar">
          <input type="search" class="form-control" id="vtSearch" placeholder="Поиск по названию…" value="${esc(screenQuery)}" autocomplete="off">
          <button type="button" class="btn-primary btn-sm" id="vtAddTypeBtn">+ Новый вид</button>
        </div>
        <div class="vt-filter-row" role="group" aria-label="Фильтр списка">${filterBtns}</div>
      </div>
      <div class="card card--flush" id="vtTabBody"></div>
    `;

    document.getElementById('vtSearch')?.addEventListener('input', (e) => {
      screenQuery = e.target.value;
      renderBody();
    });
    document.getElementById('vtAddTypeBtn')?.addEventListener('click', () => handleAddType());
    host.querySelectorAll('[data-vt-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        listFilter = btn.dataset.vtFilter;
        renderScreen();
      });
    });
  }

  function renderBody() {
    const body = document.getElementById('vtTabBody');
    if (!body || !catalog) return;

    const registries = ViolationTypes.getRegistries(catalog);
    const sections = registries
      .map((reg) => {
        const types = ViolationTypes.getTypesByRegistry(catalog, reg.id);
        return renderRegistrySection(reg, types);
      })
      .filter(Boolean)
      .join('');

    body.innerHTML = sections || `<p class="vt-empty">Ничего не найдено</p>`;

    body.querySelectorAll('[data-vt-toggle-registry]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.vtToggleRegistry;
        if (collapsedRegistries.has(id)) collapsedRegistries.delete(id);
        else collapsedRegistries.add(id);
        renderBody();
      });
    });

    body.querySelectorAll('[data-vt-map-from]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const fromId = sel.dataset.vtMapFrom;
        const toId = sel.value;
        if (!toId) {
          ViolationTypes.clearMapping(catalog, fromId);
          await saveCatalog('Сопоставление снято');
        } else {
          ViolationTypes.setMapping(catalog, fromId, toId);
          await saveCatalog('Сопоставление сохранено');
        }
        renderScreen();
      });
    });

    body.querySelectorAll('[data-vt-archive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.vtArchive;
        const t = ViolationTypes.findById(catalog, id);
        if (!t) return;
        const n = ViolationTypes.usageCount(catalog, t);
        if (n > 0) {
          const ok = await GazpromToast.confirm(
            `Вид «${t.title}» используется в ${n} записях. Перенести в архив реестра?`
          );
          if (!ok) return;
        }
        ViolationTypes.archiveType(catalog, id);
        await saveCatalog('Вид перенесён в архив');
        renderScreen();
      });
    });

    body.querySelectorAll('[data-vt-clear-map]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        ViolationTypes.clearMapping(catalog, btn.dataset.vtClearMap);
        await saveCatalog('Сопоставление снято');
        renderScreen();
      });
    });

    body.querySelectorAll('[data-vt-delete]').forEach((btn) => {
      btn.addEventListener('click', () => void handleDeleteType(btn.dataset.vtDelete));
    });
  }

  async function handleDeleteType(id) {
    const t = ViolationTypes.findById(catalog, id);
    if (!t) return;

    const usage = ViolationTypes.usageCount(catalog, t);
    if (usage > 0) {
      GazpromToast.error(`Вид «${t.title}» используется в ${usage} записях. Удаление невозможно.`);
      return;
    }

    const ok = await GazpromToast.confirm(`Удалить вид «${t.title}»?`);
    if (!ok) return;

    const result = ViolationTypes.deleteType(catalog, id);
    if (!result.ok) {
      GazpromToast.error('Не удалось удалить вид');
      return;
    }
    await saveCatalog('Вид удалён');
    renderScreen();
  }

  async function handleAddType() {
    const title = await GazpromToast.prompt('Название нового вида нарушения', '');
    if (title === null) return;
    const trimmed = String(title).trim();
    if (!trimmed) {
      GazpromToast.error('Введите название вида');
      return;
    }
    ViolationTypes.addType(catalog, trimmed);
    await saveCatalog('Вид добавлен в активный реестр');
    listFilter = 'active';
    collapsedRegistries.delete(ViolationTypes.REGISTRY_CURRENT);
    renderScreen();
  }

  async function renderScreen() {
    await loadCatalog();
    renderHeader();
    renderBody();
    updateSettingsTileBadge();
  }

  function updateSettingsTileBadge() {
    if (!catalog) return;
    const unmapped = ViolationTypes.getUnmappedArchived(catalog).length;
    document.querySelectorAll('[data-vt-unmapped]').forEach((el) => {
      el.textContent = unmapped > 0 ? String(unmapped) : '';
      el.hidden = unmapped <= 0;
    });
  }

  function bindScreen() {
    if (bound) return;
    bound = true;
    document.querySelector('.settings-tile--violation-types')?.addEventListener('click', () => {
      if (typeof goTo === 'function') goTo('violation-types');
    });
    document.querySelector('.settings-tile--violation-types')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (typeof goTo === 'function') goTo('violation-types');
      }
    });
  }

  function init() {
    bindScreen();
  }

  return {
    init,
    renderScreen,
    maybePromptAfterImport: async () => {},
  };
})();
