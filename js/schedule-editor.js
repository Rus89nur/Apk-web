/**
 * Редактор графика проверок (scheduleItems) — сетка по месяцам.
 */
const ScheduleEditor = (() => {
  const MONTH_NAMES = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ];

  let currentYear = new Date().getFullYear();
  let escListener = null;

  function getPlanDate(item) {
    if (!item) return null;
    return item.scheduledDate || item.plannedDate || null;
  }

  function getItemMonth(item) {
    if (!item) return null;
    if (item.month != null && item.month !== '') return Number(item.month);
    const d = getPlanDate(item);
    if (!d) return null;
    return new Date(d).getMonth() + 1;
  }

  function getItemYear(item) {
    if (!item) return null;
    if (item.year != null && item.year !== '') return Number(item.year);
    const d = getPlanDate(item);
    if (!d) return null;
    return new Date(d).getFullYear();
  }

  function getItemTitle(item, catalog) {
    if (!item) return '—';
    if (item.objectCheck?.title) {
      const sub = item.objectCheck.subTitle;
      return sub ? `${item.objectCheck.title}, ${sub}` : item.objectCheck.title;
    }
    if (item.organizationTitle) return item.organizationTitle;
    const org = (catalog.organizations || []).find((o) => o.id === item.organizationId);
    return org?.title || '—';
  }

  function formatPlanDateShort(item) {
    if (!item) return '';
    const d = getPlanDate(item);
    if (!d) return '';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  function itemsForYear(catalog, year) {
    return (catalog.scheduleItems || []).filter((i) => i && getItemYear(i) === year);
  }

  function itemsForMonth(catalog, year, month) {
    return itemsForYear(catalog, year).filter((i) => getItemMonth(i) === month);
  }

  function ensureRoot() {
    let root = document.getElementById('scheduleEditorRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'scheduleEditorRoot';
      root.className = 'catalog-editor-root';
      root.hidden = true;
      document.body.appendChild(root);
    }
    return root;
  }

  function closeEditorForms() {
    document.querySelectorAll('.schedule-form-overlay, .catalog-form-overlay.schedule-form-overlay').forEach((overlay) => {
      overlay.remove();
      GazpromMobileOverlay.unlock();
    });
  }

  function close() {
    closeEditorForms();
    const root = document.getElementById('scheduleEditorRoot');
    const wasOpen = root && !root.hidden;
    if (root) {
      root.hidden = true;
      root.innerHTML = '';
    }
    if (wasOpen) GazpromMobileOverlay.unlock();
    if (escListener) {
      document.removeEventListener('keydown', escListener);
      escListener = null;
    }
    GazpromMobileOverlay.scheduleRecoverViewportLayout?.();
  }

  function addEscListener() {
    if (escListener) document.removeEventListener('keydown', escListener);
    escListener = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escListener);
  }

  function bindClose(root, onClose) {
    root.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', onClose);
    });
  }

  function open() {
    GazpromStore.get().then((catalog) => {
      if (!GazpromStore.hasData(catalog)) {
        GazpromToast.error('Сначала загрузите данные');
        return;
      }
      showYearGrid(catalog);
    });
  }

  function capitalizeMonth(name) {
    if (!name) return '';
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function showYearGrid(catalog) {
    const root = ensureRoot();
    const alreadyOpen = !root.hidden;
    root.hidden = false;
    /* Повторный lock при смене года / «← Год» оставлял gazprom-scroll-lock и блокировал меню. */
    if (!alreadyOpen) GazpromMobileOverlay.lock();
    addEscListener();

    const year = currentYear;
    const yearItems = itemsForYear(catalog, year);
    const now = new Date();
    const yearDone = yearItems.filter((i) => i?.actualDate).length;
    const yearTotal = yearItems.length;
    const yearPct = yearTotal > 0 ? Math.round((yearDone / yearTotal) * 100) : 0;
    const kpiText = yearTotal > 0
      ? `${yearTotal} проверок · ${yearDone} выполнено · ${yearPct}%`
      : 'План на год не задан';

    const cells = MONTH_NAMES.map((name, idx) => {
      const month = idx + 1;
      const monthItems = yearItems.filter((i) => getItemMonth(i) === month);
      const count = monthItems.length;
      const doneCount = monthItems.filter((i) => i?.actualDate).length;
      const label = capitalizeMonth(name);
      const isNow = year === now.getFullYear() && month === now.getMonth() + 1;
      const isEmpty = count === 0;
      const isComplete = count > 0 && doneCount === count;
      const pct = count > 0 ? Math.round((doneCount / count) * 100) : 0;

      let countClass = 'schedule-month-count';
      let countText = '0';
      if (isEmpty) {
        countClass += ' schedule-month-count--empty';
      } else if (isComplete) {
        countClass += ' schedule-month-count--ok';
        countText = `${doneCount}/${count}`;
      } else if (doneCount === 0) {
        countClass += ' schedule-month-count--wait';
        countText = `${doneCount}/${count}`;
      } else {
        countText = `${doneCount}/${count}`;
      }

      const lines = isEmpty
        ? '<p class="schedule-month-empty">Нет проверок. Нажмите, чтобы добавить.</p>'
        : `<ul class="schedule-month-list">${monthItems.map((item) => {
            const title = AktUtils.escapeHtml(getItemTitle(item, catalog));
            const dateStr = formatPlanDateShort(item);
            const done = item.actualDate ? ' schedule-month-line--done' : '';
            return `<li class="schedule-month-line${done}">${title}${dateStr ? ` · ${dateStr}` : ''}</li>`;
          }).join('')}</ul>`;

      const bar = isEmpty
        ? ''
        : `<div class="schedule-month-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>`;

      const cardMods = [
        isEmpty ? ' schedule-month-card--empty' : '',
        isNow ? ' schedule-month-card--now' : '',
        isComplete ? ' schedule-month-card--done' : '',
      ].join('');

      const aria = isEmpty
        ? `${label}, нет проверок`
        : `${label}, ${doneCount} из ${count} выполнено`;

      return `
        <article class="schedule-month-card schedule-month-cell${cardMods}"
                 role="button" tabindex="0" data-month="${month}" aria-label="${aria}">
          <div class="schedule-month-card__top">
            <strong class="schedule-month-card__name">${label}</strong>
            <span class="${countClass}">${countText}</span>
          </div>
          ${lines}
          ${bar}
        </article>`;
    }).join('');

    root.innerHTML = `
      <div class="catalog-editor-backdrop" data-close></div>
      <div class="catalog-editor-panel catalog-editor-panel--schedule card">
        <div class="catalog-editor-header catalog-editor-header--schedule catalog-editor-header--year">
          <h3 class="schedule-header-title">График проверок</h3>
          <div class="schedule-year-controls">
            <button type="button" class="btn-ghost btn-sm" data-year-prev aria-label="Предыдущий год">‹</button>
            <span class="schedule-year-label">${year}</span>
            <button type="button" class="btn-ghost btn-sm" data-year-next aria-label="Следующий год">›</button>
          </div>
          <button type="button" class="modal-close schedule-header-close" data-close aria-label="Закрыть">×</button>
        </div>
        <div class="catalog-editor-body schedule-editor-body">
          <p class="schedule-editor-hint">Год целиком. В карточке — сколько запланировано и выполнено. Нажмите месяц, чтобы править объекты.</p>
          <div class="schedule-year-kpi" aria-label="Итог года">${AktUtils.escapeHtml(kpiText)}</div>
          <div class="schedule-year-grid">${cells}</div>
        </div>
        <div class="catalog-editor-footer">
          <button type="button" class="btn-ghost" data-close>Закрыть</button>
        </div>
      </div>
    `;

    bindClose(root, close);

    root.querySelector('[data-year-prev]')?.addEventListener('click', () => {
      currentYear -= 1;
      showYearGrid(catalog);
    });
    root.querySelector('[data-year-next]')?.addEventListener('click', () => {
      currentYear += 1;
      showYearGrid(catalog);
    });

    root.querySelectorAll('.schedule-month-cell').forEach((cell) => {
      const month = parseInt(cell.dataset.month, 10);
      const openMonth = () => showMonthDetail(catalog, year, month);
      cell.addEventListener('click', openMonth);
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openMonth();
        }
      });
    });
  }

  function factDateIso(item) {
    const plan = getPlanDate(item);
    if (plan) {
      const d = new Date(plan);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).toISOString();
  }

  function updateMonthCardDoneState(card, item, done) {
    if (!card || !item) return;
    card.classList.toggle('schedule-item-card--done', done);
    const badge = card.querySelector('.schedule-item-card__badge');
    if (badge) {
      badge.textContent = done ? 'Выполнено' : 'План';
      badge.classList.toggle('is-done', done);
    }
    const btn = card.querySelector('[data-toggle-done]');
    if (btn) {
      btn.classList.toggle('is-on', done);
      btn.setAttribute('aria-pressed', done ? 'true' : 'false');
    }
    const meta = card.querySelector('.schedule-item-card__meta');
    if (meta) {
      const plan = getPlanDate(item);
      const planStr = plan ? AktUtils.formatDateShort(plan) : '—';
      const factStr = done && item.actualDate ? AktUtils.formatDateShort(item.actualDate) : 'нет';
      meta.textContent = `План ${planStr} · Факт ${factStr}`;
    }
  }

  function updateMonthKpi(root) {
    const kpi = root?.querySelector('.schedule-month-body .schedule-year-kpi');
    if (!kpi) return;
    const cards = root.querySelectorAll('.schedule-item-card');
    const total = cards.length;
    const doneCount = root.querySelectorAll('.schedule-item-card--done').length;
    kpi.textContent = total
      ? `${total} проверки · ${doneCount} выполнено`
      : 'Нет запланированных проверок';
  }

  async function toggleItemDone(itemId, year, month) {
    const fresh = await GazpromStore.get();
    const item = (fresh.scheduleItems || []).find((x) => x?.id === itemId);
    if (!item) {
      GazpromToast.error('Запись не найдена');
      return;
    }
    const wasDone = !!item.actualDate;
    item.actualDate = wasDone ? null : factDateIso(item);
    await GazpromStore.set(fresh);
    GazpromStore.invalidateCache();
    await GazpromUI.refreshAll();

    const root = document.getElementById('scheduleEditorRoot');
    const card = root
      ? [...root.querySelectorAll('.schedule-item-card')].find((el) => el.dataset.id === String(itemId))
      : null;
    if (card) {
      updateMonthCardDoneState(card, item, !wasDone);
      updateMonthKpi(root);
    } else {
      showMonthDetail(await GazpromStore.get(), year, month);
    }
    GazpromToast.success(wasDone ? 'Отметка снята' : 'Отмечено выполненным');
  }

  function showMonthDetail(catalog, year, month) {
    const root = ensureRoot();
    root.hidden = false;
    addEscListener();
    const monthItems = itemsForMonth(catalog, year, month);
    const monthName = capitalizeMonth(MONTH_NAMES[month - 1]);
    const doneCount = monthItems.filter((i) => i?.actualDate).length;
    const kpiText = monthItems.length
      ? `${monthItems.length} проверки · ${doneCount} выполнено`
      : 'Нет запланированных проверок';

    const cards = monthItems
      .map((item) => {
        const title = AktUtils.escapeHtml(getItemTitle(item, catalog));
        const plan = getPlanDate(item);
        const fact = item.actualDate;
        const done = !!fact;
        const planStr = plan ? AktUtils.formatDateShort(plan) : '—';
        const factStr = fact ? AktUtils.formatDateShort(fact) : 'нет';
        return `
          <article class="schedule-item-card${done ? ' schedule-item-card--done' : ''}" data-id="${item.id}">
            <div class="schedule-item-card__top">
              <strong class="schedule-item-card__title">${title}</strong>
              <span class="schedule-item-card__badge${done ? ' is-done' : ''}">${done ? 'Выполнено' : 'План'}</span>
            </div>
            <p class="schedule-item-card__meta">План ${planStr} · Факт ${factStr}</p>
            <div class="schedule-item-card__actions">
              <button type="button" class="schedule-done-btn${done ? ' is-on' : ''}"
                      data-toggle-done="${item.id}"
                      aria-pressed="${done ? 'true' : 'false'}">Выполнено</button>
              <button type="button" class="btn-ghost btn-sm" data-edit="${item.id}">Изменить</button>
              <button type="button" class="btn-ghost btn-sm modal-btn-danger" data-del="${item.id}" aria-label="Удалить">×</button>
            </div>
          </article>`;
      })
      .join('');

    root.innerHTML = `
      <div class="catalog-editor-backdrop" data-close></div>
      <div class="catalog-editor-panel catalog-editor-panel--schedule card">
        <div class="catalog-editor-header catalog-editor-header--schedule">
          <button type="button" class="btn-ghost btn-sm schedule-back-btn" data-back aria-label="Назад">← Год</button>
          <h3 class="schedule-header-title">${monthName} ${year}</h3>
          <button type="button" class="modal-close schedule-header-close" data-back aria-label="Назад к графику">×</button>
        </div>
        <div class="catalog-editor-body schedule-month-body">
          <div class="schedule-year-kpi" aria-label="Итог месяца">${AktUtils.escapeHtml(kpiText)}</div>
          <div class="schedule-item-list">
            ${cards || '<p class="schedule-item-empty">Нет проверок. Нажмите «Добавить объект».</p>'}
          </div>
        </div>
        <div class="catalog-editor-footer">
          <button type="button" class="btn-primary" data-add>+ Добавить объект</button>
          <button type="button" class="btn-ghost" data-back>Закрыть</button>
        </div>
      </div>
    `;

    const goBack = async () => {
      const fresh = await GazpromStore.get();
      showYearGrid(fresh);
    };

    bindClose(root, close);
    root.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
      goBack().catch((err) => GazpromToast.error(err?.message || 'Ошибка'));
    }));

    root.querySelector('[data-add]')?.addEventListener('click', async () => {
      const fresh = await GazpromStore.get();
      openObjectPicker(fresh, { year, month });
    });

    root.querySelectorAll('[data-toggle-done]').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleItemDone(btn.dataset.toggleDone, year, month).catch((err) => {
          GazpromToast.error(err?.message || 'Ошибка');
        });
      });
    });

    root.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const fresh = await GazpromStore.get();
        const item = (fresh.scheduleItems || []).find((x) => x?.id === btn.dataset.edit);
        if (!item) {
          GazpromToast.error('Запись не найдена');
          return;
        }
        openForm(fresh, item, { year, month });
      });
    });

    root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await GazpromToast.confirm('Удалить запись графика?');
        if (!ok) return;
        const fresh = await GazpromStore.get();
        fresh.scheduleItems = (fresh.scheduleItems || []).filter((x) => x.id !== btn.dataset.del);
        await GazpromStore.set(fresh);
        GazpromStore.invalidateCache();
        await GazpromUI.refreshAll();
        showMonthDetail(await GazpromStore.get(), year, month);
      });
    });
  }

  function findObject(catalog, objectId) {
    return collectObjects(catalog).find((o) => String(o.id) === String(objectId)) || null;
  }

  async function persistScheduleItem(catalog, record, viewYear, viewMonth) {
    const fresh = await GazpromStore.get();
    const list = [...(fresh.scheduleItems || [])];
    const idx = list.findIndex((x) => x.id === record.id);
    if (idx >= 0) list[idx] = record;
    else list.push(record);
    fresh.scheduleItems = list;

    await GazpromStore.set(fresh);
    GazpromStore.invalidateCache();
    await GazpromUI.refreshAll();

    const updated = await GazpromStore.get();
    showMonthDetail(updated, Number(viewYear), Number(viewMonth));
    return record;
  }

  function buildScheduleRecord(catalog, { item, objectId, orgId, plan }) {
    const orgs = catalog.organizations || [];
    const planDate = new Date(plan + 'T12:00:00');
    if (Number.isNaN(planDate.getTime())) {
      throw new Error('Некорректная дата');
    }

    const record = item ? { ...item } : { id: AktUtils.uuid() };
    record.scheduledDate = planDate.toISOString();
    record.plannedDate = record.scheduledDate;
    record.year = planDate.getFullYear();
    record.month = planDate.getMonth() + 1;

    const resolvedObjectId = objectId || item?.objectCheck?.id || '';
    const resolvedOrgId = orgId || item?.organizationId || '';

    if (resolvedObjectId) {
      const obj = findObject(catalog, resolvedObjectId);
      if (!obj) throw new Error('Объект не найден');
      record.objectCheck = { id: obj.id, title: obj.title, subTitle: obj.subTitle || '' };
    } else {
      delete record.objectCheck;
    }

    if (resolvedOrgId) {
      const org = orgs.find((o) => String(o.id) === String(resolvedOrgId));
      record.organizationId = resolvedOrgId;
      record.organizationTitle = org?.title || '';
    } else {
      record.organizationId = null;
      record.organizationTitle = '';
    }

    if (!record.objectCheck && !record.organizationId) {
      throw new Error('Выберите объект или организацию');
    }

    return record;
  }

  function mountOverlay(html) {
    const overlay = document.createElement('div');
    overlay.className = 'catalog-form-overlay schedule-form-overlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    GazpromMobileOverlay.lock();
    return overlay;
  }

  function collectObjects(catalog) {
    const byId = new Map();
    (catalog.objects || []).forEach((o) => {
      if (o?.id) byId.set(o.id, o);
    });
    (catalog.scheduleItems || []).forEach((item) => {
      if (item?.objectCheck?.id) byId.set(item.objectCheck.id, item.objectCheck);
    });
    (catalog.akts || []).forEach((akt) => {
      (akt.objectsCheck || []).forEach((o) => {
        if (o?.id) byId.set(o.id, o);
      });
    });
    return [...byId.values()].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', 'ru')
    );
  }

  function getSelectionTitle(catalog, { objectId, orgId, item }) {
    if (objectId) {
      const obj = findObject(catalog, objectId);
      if (!obj) return '—';
      return AktUtils.formatObjectDisplay(obj);
    }
    if (orgId) {
      const org = (catalog.organizations || []).find((o) => String(o.id) === String(orgId));
      return org?.title || '—';
    }
    if (item) return getItemTitle(item, catalog);
    return '—';
  }

  function objectMatchesPickerSearch(item, q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return true;
    const hay = `${item?.title || ''} ${item?.subTitle || ''}`.toLowerCase();
    return hay.includes(needle);
  }

  function openObjectPicker(catalog, context) {
    const objects = collectObjects(catalog);
    const { year, month } = context;
    const monthName = capitalizeMonth(MONTH_NAMES[month - 1]);
    let searchQuery = '';

    const overlay = mountOverlay(`
      <div class="catalog-form-dialog card schedule-object-picker">
        <header class="schedule-object-picker__head">
          <h3>Объект проверки</h3>
          <p class="schedule-object-picker__sub">${monthName} ${year}</p>
          <button type="button" class="modal-close" data-cancel aria-label="Отмена">×</button>
        </header>
        <div class="wizard-org-select-block schedule-picker-filter-block">
          <p class="wizard-hint wizard-org-hint wizard-object-filter wizard-object-filter--empty"
             id="scheduleObjectFilter"
             contenteditable="true"
             role="searchbox"
             spellcheck="false"
             data-placeholder="Поиск объекта в справочнике"
             aria-label="Поиск объекта в справочнике"></p>
        </div>
        <div class="schedule-picker-catalog" id="scheduleObjectChips" role="list" aria-label="Объекты проверки"></div>
        <div class="catalog-form-actions schedule-object-picker__foot">
          <button type="button" class="btn-ghost" data-cancel>Отмена</button>
        </div>
      </div>
    `);

    const filterEl = overlay.querySelector('#scheduleObjectFilter');
    const objectHost = overlay.querySelector('#scheduleObjectChips');

    const remove = () => {
      overlay.remove();
      GazpromMobileOverlay.unlock();
    };

    const pickObject = async (objectId) => {
      remove();
      const fresh = await GazpromStore.get();
      openDateForm(fresh, { year, month, objectId });
    };

    const renderCards = () => {
      const filteredObjects = objects.filter((o) => objectMatchesPickerSearch(o, searchQuery));

      if (!objects.length) {
        objectHost.innerHTML = '<p class="schedule-picker-empty">Справочник объектов пуст. Добавьте объекты в разделе «Объекты» в настройках.</p>';
        return;
      }

      if (!filteredObjects.length) {
        objectHost.innerHTML = '<p class="schedule-picker-empty">Ничего не найдено</p>';
        return;
      }

      objectHost.innerHTML = filteredObjects
        .map((o) => {
          const title = AktUtils.escapeHtml(o.title || '—');
          const sub = o.subTitle && o.subTitle !== o.title
            ? `<span class="schedule-object-card__sub">${AktUtils.escapeHtml(o.subTitle)}</span>`
            : '';
          return `<button type="button" class="schedule-object-card" data-object-id="${o.id}" role="listitem">
            <strong class="schedule-object-card__title">${title}</strong>
            ${sub}
          </button>`;
        })
        .join('');

      objectHost.querySelectorAll('[data-object-id]').forEach((card) => {
        card.addEventListener('click', () => {
          pickObject(card.dataset.objectId).catch((err) => GazpromToast.error(err?.message || 'Ошибка'));
        });
      });
    };

    const syncFilterEmpty = () => {
      if (!filterEl) return;
      const text = (filterEl.textContent || '').replace(/\u00a0/g, ' ').trim();
      filterEl.classList.toggle('wizard-object-filter--empty', !text);
    };

    filterEl?.addEventListener('input', () => {
      searchQuery = filterEl.textContent || '';
      syncFilterEmpty();
      renderCards();
    });
    filterEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });

    overlay.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.onclick = remove;
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) remove();
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') remove();
    });

    renderCards();
    setTimeout(() => filterEl?.focus(), 50);
  }

  function openDateForm(catalog, context) {
    const { year, month, objectId, orgId, item } = context;
    const y = year || getItemYear(item) || currentYear;
    const m = month || getItemMonth(item) || 1;
    const planVal = AktUtils.toDateInputValue(getPlanDate(item));
    const factVal = AktUtils.toDateInputValue(item?.actualDate);
    const defaultPlan = planVal || `${y}-${String(m).padStart(2, '0')}-15`;
    const title = getSelectionTitle(catalog, { objectId, orgId, item });
    const isEdit = !!item;

    const form = mountOverlay(`
      <div class="catalog-form-dialog card">
        <h3>${isEdit ? 'Изменить' : 'Добавить'} проверку</h3>
        <div class="form-group">
          <label>Объект</label>
          <div class="schedule-selected-object">${AktUtils.escapeHtml(title)}</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>План (дата)</label>
            <input type="date" class="form-control" data-plan value="${defaultPlan}">
          </div>
          <div class="form-group">
            <label>Факт (дата)</label>
            <input type="date" class="form-control" data-fact value="${factVal}">
          </div>
        </div>
        <div class="catalog-form-actions">
          <button type="button" class="btn-ghost" data-cancel>Отмена</button>
          <button type="button" class="btn-primary" data-save>Сохранить</button>
        </div>
      </div>
    `);

    const remove = () => {
      form.remove();
      GazpromMobileOverlay.unlock();
    };
    form.querySelector('[data-cancel]').onclick = remove;
    form.addEventListener('click', (e) => {
      if (e.target === form) remove();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') remove();
    });

    form.querySelector('[data-save]').onclick = async () => {
      const plan = form.querySelector('[data-plan]')?.value || '';
      if (!plan) {
        GazpromToast.error('Укажите плановую дату');
        return;
      }

      try {
        const fresh = await GazpromStore.get();
        const record = buildScheduleRecord(fresh, {
          item,
          objectId,
          orgId,
          plan,
        });
        const fact = form.querySelector('[data-fact]')?.value || '';
        record.actualDate = fact ? new Date(fact + 'T12:00:00').toISOString() : null;

        await persistScheduleItem(fresh, record, record.year, record.month);
        remove();
        GazpromToast.success(isEdit ? 'Запись обновлена' : 'Объект добавлен в график');
      } catch (err) {
        GazpromToast.error(err?.message || 'Ошибка сохранения');
      }
    };

    setTimeout(() => form.querySelector('[data-plan]')?.focus(), 50);
  }

  function openForm(catalog, item, context) {
    openDateForm(catalog, {
      year: context?.year,
      month: context?.month,
      objectId: context?.objectId || item?.objectCheck?.id,
      orgId: context?.orgId || item?.organizationId,
      item,
    });
  }

  return { open };
})();
