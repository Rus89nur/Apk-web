/**
 * CRUD-редакторы справочников в настройках.
 * Плитки открываются через атрибут data-catalog на элементе.
 */
const CatalogEditor = (() => {
  const TYPES = {
    commission: {
      title: 'Комиссия',
      icon: '👥',
      fields: [
        { key: 'fio',      label: 'ФИО',       required: true, placeholder: 'И. И. Иванов' },
        { key: 'jobTitle', label: 'Должность',  placeholder: 'Инженер по охране труда' },
      ],
      listKey: 'comissionPeople',
      label: (r) => `${r.fio}${r.jobTitle ? ' — ' + r.jobTitle : ''}`,
      searchText: (r) => `${r.fio} ${r.jobTitle || ''}`.toLowerCase(),
    },
    organizations: {
      title: 'Организации',
      icon: '🏢',
      fields: [
        { key: 'title',      label: 'Наименование', required: true, placeholder: 'ООО «Название»' },
        { key: 'shortTitle', label: 'Краткое',       placeholder: 'ООО «Назв.»' },
      ],
      listKey: 'organizations',
      label: (r) => {
        const short = String(r.shortTitle || '').trim();
        const title = String(r.title || '').trim();
        if (!title) return short;
        if (!short || short === title) return title;
        return `${title} (${short})`;
      },
      searchText: (r) => `${r.title} ${r.shortTitle || ''}`.toLowerCase(),
    },
    objects: {
      title: 'Объекты проверки',
      icon: '📍',
      fields: [
        { key: 'title',    label: 'Объект',             required: true, placeholder: 'Компрессорная станция' },
        { key: 'subTitle', label: 'Адрес / примечание', placeholder: 'г. Надым, ул. Промышленная, 5' },
      ],
      listKey: 'objects',
      label: (r) => AktUtils.formatObjectDisplay(r),
      searchText: (r) => `${r.title} ${r.subTitle || ''}`.toLowerCase(),
    },
    predstavitely: {
      title: 'Представители',
      icon: '👤',
      fields: [
        { key: 'fio',          label: 'ФИО',          required: true, placeholder: 'И. И. Иванов' },
        { key: 'jobTitle',     label: 'Должность',    placeholder: 'Директор' },
        { key: 'organization', label: 'Организация',  placeholder: 'ООО «…»' },
      ],
      listKey: 'predstavitely',
      label: (r) => `${r.fio}${r.organization ? ' (' + r.organization + ')' : ''}`,
      searchText: (r) => `${r.fio} ${r.jobTitle || ''} ${r.organization || ''}`.toLowerCase(),
    },
    violations: {
      title: 'Нарушения',
      icon: '⚠️',
      readonly: true, // особый режим: только просмотр
    },
  };

  let root = null;
  let escListener = null;
  let chromeResizeListener = null;

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'catalogEditorRoot';
    root.className = 'catalog-editor-root';
    root.hidden = true;
    document.body.appendChild(root);
    return root;
  }

  function closeEditorForms() {
    document.querySelectorAll('.catalog-form-overlay[data-catalog-editor-form]').forEach((form) => {
      form.remove();
      GazpromMobileOverlay.unlock();
    });
  }

  function close() {
    closeEditorForms();
    const wasOpen = root && !root.hidden;
    if (chromeResizeListener) {
      window.removeEventListener('resize', chromeResizeListener);
      chromeResizeListener = null;
    }
    if (root) {
      root.hidden = true;
      root.innerHTML = '';
    }
    if (wasOpen) GazpromMobileOverlay.unlock();
    if (escListener) {
      document.removeEventListener('keydown', escListener);
      escListener = null;
    }
  }

  function addEscListener() {
    if (escListener) document.removeEventListener('keydown', escListener);
    escListener = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escListener);
  }

  async function saveList(catalog, listKey, list) {
    catalog[listKey] = list;
    await GazpromStore.set(catalog);
    GazpromStore.invalidateCache();
    await GazpromUI.refreshAll();
  }

  function open(typeKey) {
    const cfg = TYPES[typeKey];
    if (!cfg) return;

    if (typeKey === 'violations') {
      if (typeof DefaultsBootstrap !== 'undefined' && typeof DefaultsBootstrap.openRegistryModal === 'function') {
        DefaultsBootstrap.openRegistryModal();
      } else {
        ViolationRegistry.open();
      }
      return;
    }

    GazpromStore.get().then((catalog) => {
      if (!catalog) {
        GazpromToast.error('Нет данных в базе');
        return;
      }
      renderList(cfg, catalog, '');
    });
  }

  /* ——— Стандартный CRUD список ——— */

  function buildRowsHtml(cfg, fields, items, emptyMsg) {
    if (!items.length) {
      return `<tr class="catalog-row-empty"><td colspan="${fields.length + 1}" class="catalog-empty-cell">${emptyMsg}</td></tr>`;
    }
    return items.map((item) => `
      <tr data-id="${item.id}" class="catalog-row">
        ${fields.map((f) => `<td data-label="${escHtml(f.label)}">${escHtml(item[f.key] || '—')}</td>`).join('')}
        <td class="btn-row">
          <button type="button" class="btn-ghost btn-sm" data-edit="${item.id}">Изменить</button>
          <button type="button" class="btn-ghost btn-sm modal-btn-danger" data-del="${item.id}">Удалить</button>
        </td>
      </tr>`).join('');
  }

  function bindRowButtons(el, all, cfg, catalog, getQuery) {
    el.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = all.find((x) => x.id === btn.dataset.edit);
        openForm(cfg, catalog, item, getQuery());
      });
    });

    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = all.find((x) => x.id === btn.dataset.del);
        const ok = await GazpromToast.confirm(
          `Удалить запись?\n«${cfg.label(item)}»`,
          { confirmLabel: 'Удалить', danger: true }
        );
        if (!ok) return;
        const next = all.filter((x) => x.id !== btn.dataset.del);
        await saveList(catalog, cfg.listKey, next);
        const fresh = await GazpromStore.get();
        renderList(cfg, fresh, getQuery());
      });
    });
  }

  function renderList(cfg, catalog, query) {
    const el = ensureRoot();
    const alreadyOpen = !el.hidden;
    el.hidden = false;
    /* Повторный lock после «Добавить» оставлял gazprom-scroll-lock и блокировал меню. */
    if (!alreadyOpen) GazpromMobileOverlay.lock();
    addEscListener();

    const all = [...(catalog[cfg.listKey] || [])];
    const fields = cfg.fields || [];

    const filterItems = (q) => {
      const lq = q.toLowerCase();
      return lq
        ? all.filter((item) => (cfg.searchText ? cfg.searchText(item) : cfg.label(item).toLowerCase()).includes(lq))
        : all;
    };

    const filtered = filterItems(query);
    const countHint = (q, f) => q ? `${f.length} из ${all.length}` : `${all.length} записей`;

    el.innerHTML = `
      <div class="catalog-editor-backdrop" data-close></div>
      <div class="catalog-editor-panel card">
        <div class="catalog-editor-top">
          <div class="catalog-editor-header">
            <div>
              <h3>${cfg.icon || ''} ${cfg.title}</h3>
              <small class="catalog-editor-count" style="color:var(--text-muted);">${countHint(query, filtered)}</small>
            </div>
            <button type="button" class="modal-close" data-close>×</button>
          </div>
          <div class="catalog-editor-search-bar">
            <input type="search" class="form-control catalog-search-input" placeholder="🔍 Поиск…" value="${escHtml(query)}" autocomplete="off">
          </div>
        </div>
        <div class="catalog-editor-body">
          <table class="list-table catalog-list-table">
            <thead><tr>${fields.map((f) => `<th>${escHtml(f.label)}</th>`).join('')}<th></th></tr></thead>
            <tbody>${buildRowsHtml(cfg, fields, filtered, query ? 'Ничего не найдено' : 'Нет записей — нажмите «+ Добавить»')}</tbody>
          </table>
        </div>
        <div class="catalog-editor-footer">
          <button type="button" class="btn-primary" data-add>+ Добавить</button>
          <button type="button" class="btn-ghost" data-close>Закрыть</button>
        </div>
      </div>
    `;

    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

    const panel = el.querySelector('.catalog-editor-panel');
    const bodyEl = el.querySelector('.catalog-editor-body');
    const topEl = el.querySelector('.catalog-editor-top');
    const footerEl = el.querySelector('.catalog-editor-footer');
    const syncChromeInsets = () => {
      if (!bodyEl) return;
      const topH = topEl ? Math.ceil(topEl.getBoundingClientRect().height) : 0;
      const footH = footerEl ? Math.ceil(footerEl.getBoundingClientRect().height) : 0;
      bodyEl.style.paddingTop = `${topH}px`;
      bodyEl.style.paddingBottom = `${footH}px`;
      panel?.style.setProperty('--catalog-chrome-top', `${topH}px`);
      panel?.style.setProperty('--catalog-chrome-bottom', `${footH}px`);
    };
    if (chromeResizeListener) {
      window.removeEventListener('resize', chromeResizeListener);
    }
    chromeResizeListener = syncChromeInsets;
    requestAnimationFrame(syncChromeInsets);
    window.addEventListener('resize', syncChromeInsets, { passive: true });

    const tbody = el.querySelector('tbody');
    const countEl = el.querySelector('.catalog-editor-count');
    const searchInput = el.querySelector('.catalog-search-input');

    searchInput?.addEventListener('input', (e) => {
      const q = e.target.value;
      const f = filterItems(q);
      tbody.innerHTML = buildRowsHtml(cfg, fields, f, q ? 'Ничего не найдено' : 'Нет записей — нажмите «+ Добавить»');
      countEl.textContent = countHint(q, f);
      bindRowButtons(tbody, all, cfg, catalog, () => searchInput.value);
      requestAnimationFrame(syncChromeInsets);
    });

    el.querySelector('[data-add]')?.addEventListener('click', () => openForm(cfg, catalog, null, searchInput?.value ?? query));

    bindRowButtons(el, all, cfg, catalog, () => searchInput?.value ?? query);
  }

  /* ——— Форма добавления / редактирования ——— */

  function openForm(cfg, catalog, item, prevQuery = '') {
    const isPred = cfg.listKey === 'predstavitely';
    const isCommission = cfg.listKey === 'comissionPeople';
    const suggestKeys = isPred ? new Set(['jobTitle', 'organization']) : new Set();

    const fieldsHtml = cfg.fields
      .map((f) => {
        let value = item?.[f.key] || '';
        if ((isPred || isCommission) && f.key === 'fio' && value) {
          value = AktUtils.normalizeRepresentativeFio(value);
        }
        const suggestWrap = suggestKeys.has(f.key);
        const inputHtml = `
        <input class="form-control" data-field="${f.key}"
               value="${escHtml(value)}"
               placeholder="${escHtml(f.placeholder || '')}"
               ${suggestWrap ? 'autocomplete="off"' : ''}
               ${f.required ? 'required' : ''}>`;
        if (!suggestWrap) {
          return `
      <div class="form-group">
        <label class="form-label">${f.label}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
        ${inputHtml}
      </div>`;
        }
        return `
      <div class="form-group">
        <label class="form-label">${f.label}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>
        <div class="field-suggest-wrap">
          ${inputHtml}
          <div class="mesto-suggestions" data-suggest-for="${f.key}" hidden></div>
        </div>
      </div>`;
      })
      .join('');

    const form = document.createElement('div');
    form.className = 'catalog-form-overlay';
    form.setAttribute('data-catalog-editor-form', '');
    form.innerHTML = `
      <div class="catalog-form-dialog card">
        <h3>${item ? 'Изменить запись' : 'Добавить запись'}</h3>
        ${fieldsHtml}
        <div class="catalog-form-actions">
          <button type="button" class="btn-ghost" data-cancel>Отмена</button>
          <button type="button" class="btn-primary" data-save>${item ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(form);
    GazpromMobileOverlay.lock();

    const firstInput = form.querySelector('input');
    setTimeout(() => firstInput?.focus(), 50);

    if (isPred || isCommission) {
      const fioInput = form.querySelector('[data-field="fio"]');
      AktUtils.bindRepresentativeFioInput(fioInput);
    }

    if (isPred) {
      const jobInput = form.querySelector('[data-field="jobTitle"]');
      const jobList = form.querySelector('[data-suggest-for="jobTitle"]');
      if (jobInput && jobList) {
        AktUtils.bindFieldSuggestions(jobInput, jobList, () => AktUtils.collectJobTitleSuggestions(catalog), {
          originalValue: item?.jobTitle || '',
        });
      }
      const orgInput = form.querySelector('[data-field="organization"]');
      const orgList = form.querySelector('[data-suggest-for="organization"]');
      if (orgInput && orgList) {
        AktUtils.bindFieldSuggestions(orgInput, orgList, () => AktUtils.collectOrganizationSuggestions(catalog), {
          originalValue: item?.organization || '',
        });
      }
    }

    const remove = () => {
      if (!form.isConnected) return;
      form.remove();
      GazpromMobileOverlay.unlock();
    };
    form.querySelector('[data-cancel]').onclick = remove;

    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') remove();
      if (e.key === 'Enter' && !e.shiftKey) {
        const t = e.target;
        if (t && t.closest && t.closest('.mesto-suggestions')) return;
        form.querySelector('[data-save]')?.click();
      }
    });

    form.querySelector('[data-save]').onclick = async () => {
      const record = item ? { ...item } : { id: AktUtils.uuid() };
      for (const f of cfg.fields) {
        const input = form.querySelector(`[data-field="${f.key}"]`);
        let val = input?.value?.trim() || '';
        if ((isPred || isCommission) && f.key === 'fio') {
          val = AktUtils.normalizeRepresentativeFio(val);
          if (input) input.value = val;
        }
        record[f.key] = val;
        if (f.required && !record[f.key]) {
          GazpromToast.error(`Заполните поле: ${f.label}`);
          input?.focus();
          return;
        }
      }
      const list = [...(catalog[cfg.listKey] || [])];
      const idx = list.findIndex((x) => x.id === record.id);
      if (idx >= 0) list[idx] = record;
      else list.push(record);
      const saveBtn = form.querySelector('[data-save]');
      if (saveBtn) saveBtn.disabled = true;
      try {
        await saveList(catalog, cfg.listKey, list);
        remove();
        const fresh = await GazpromStore.get();
        renderList(cfg, fresh, prevQuery);
      } catch (err) {
        if (saveBtn) saveBtn.disabled = false;
        GazpromToast.error(err?.message || 'Не удалось сохранить запись');
      }
    };
  }

  /* ——— Привязка тайлов через data-catalog ——— */

  function bindSettingsTiles() {
    document.querySelectorAll('[data-catalog]').forEach((tile) => {
      if (tile.classList.contains('settings-tile--registry')) return;
      const key = tile.dataset.catalog;
      tile.addEventListener('click', () => open(key));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(key); }
      });
    });
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { open, bindSettingsTiles, TYPES };
})();
