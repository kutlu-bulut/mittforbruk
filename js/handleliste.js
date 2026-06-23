// ============================================================
// Handleliste — delt handlelistefunksjonalitet
// ============================================================

import {
    collection, addDoc, updateDoc, deleteDoc, doc,
    onSnapshot, getDocs, writeBatch, increment, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';
import { showToast } from './ui.js';

let produkterCache    = [];   // { id, name, count }
let handlelisteCache  = [];   // { id, name, quantity, checked, group, listId, sortOrder, addedBy, addedAt }
let sortableInstances = [];
let suppressRender    = false;
let pendingRenderItems = null;
let selectedAddGroup  = '';   // group pre-selected in the add form
let suppressTimer     = null; // for suppressHold cleanup
let groupOrderMemory  = [];   // stable group insertion order (never reordered by drag)
let selectedListId    = (() => { try { return sessionStorage.getItem('mittforbruk_list') || 'main'; } catch { return 'main'; } })();
let listsCache        = [{ id: 'main', name: 'Handleliste', emoji: '🛒', sortOrder: 0 }];
let viewMode          = 'overview'; // 'overview' | 'detail'
let selectedGroupFilter = null;    // null = groups overview, string = group name, '' = ungrouped, '__checked__' = checked items
let showChecked       = false;     // hidden by default, toggled per-group

// ---- Group color palette ----
const GROUP_COLORS = [
    { dot: '#818cf8', bg: '#eef2ff', text: '#4338ca', darkBg: '#312e81', darkText: '#a5b4fc' }, // indigo
    { dot: '#f87171', bg: '#fff1f2', text: '#be123c', darkBg: '#4c0519', darkText: '#fca5a5' }, // rose
    { dot: '#fbbf24', bg: '#fffbeb', text: '#b45309', darkBg: '#451a03', darkText: '#fcd34d' }, // amber
    { dot: '#34d399', bg: '#ecfdf5', text: '#065f46', darkBg: '#022c22', darkText: '#6ee7b7' }, // emerald
    { dot: '#38bdf8', bg: '#f0f9ff', text: '#0369a1', darkBg: '#082f49', darkText: '#7dd3fc' }, // sky
    { dot: '#c084fc', bg: '#faf5ff', text: '#6d28d9', darkBg: '#2e1065', darkText: '#d8b4fe' }, // violet
    { dot: '#fb923c', bg: '#fff7ed', text: '#c2410c', darkBg: '#431407', darkText: '#fdba74' }, // orange
    { dot: '#2dd4bf', bg: '#f0fdfa', text: '#0f766e', darkBg: '#042f2e', darkText: '#5eead4' }, // teal
];

function getGroupColor(groupName) {
    if (!groupName) return GROUP_COLORS[0];
    let h = 0;
    for (let i = 0; i < groupName.length; i++) h = (h * 31 + groupName.charCodeAt(i)) | 0;
    return GROUP_COLORS[Math.abs(h) % GROUP_COLORS.length];
}

// ============================================================
// Listeners
// ============================================================

export function initHandlelisteListener() {
    if (!state.currentHid) return;

    initSwipeNavigation();

    // No orderBy — sort in JS to avoid needing a composite index
    onSnapshot(
        collection(db, "households", state.currentHid, "handleliste"),
        (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            handlelisteCache = items;
            if (suppressRender) {
                pendingRenderItems = items;
            } else {
                renderHandleliste(items);
            }
        },
        (err) => { console.error("Handleliste listener error:", err); }
    );
}

export function initProdukterListener() {
    if (!state.currentHid) return;

    onSnapshot(
        collection(db, "households", state.currentHid, "produkter"),
        (snap) => {
            produkterCache = [];
            snap.forEach(d => produkterCache.push({ id: d.id, ...d.data() }));
            produkterCache.sort((a, b) => (b.count || 0) - (a.count || 0));
            state.masterProducts = produkterCache;
        },
        (err) => { console.error("Produkter listener error:", err); }
    );
}

export function initShoppingListsListener() {
    if (!state.currentHid) return;
    const ref = doc(db, "households", state.currentHid, "settings", "shoppingLists");
    onSnapshot(ref, async (snap) => {
        if (!snap.exists()) {
            await setDoc(ref, { lists: [{ id: 'main', name: 'Handleliste', emoji: '🛒', sortOrder: 0 }] });
            return;
        }
        listsCache = (snap.data().lists || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        if (listsCache.length === 0) listsCache = [{ id: 'main', name: 'Handleliste', emoji: '🛒', sortOrder: 0 }];
        if (!listsCache.find(l => l.id === selectedListId)) selectedListId = listsCache[0].id;
        try { sessionStorage.setItem('mittforbruk_list', selectedListId); } catch {}
        renderHandleliste(handlelisteCache);
        // Oppdater startliste-velgeren i Innstillinger når listene endres
        window.renderDefaultListSetting?.();
    }, err => console.error("ShoppingLists listener error:", err));
}

// Eksponer listene til startliste-velgeren (preferences.js)
window.getShoppingLists = () => listsCache.slice();

// ============================================================
// Render
// ============================================================

function sortedItems(items) {
    return [...items].sort((a, b) =>
        (a.sortOrder ?? 999999) - (b.sortOrder ?? 999999) ||
        (a.addedAt || 0) - (b.addedAt || 0)
    );
}

function renderHandleliste(items) {
    if (viewMode === 'overview') {
        renderListsOverview();
        return;
    }

    const list = document.getElementById('handlelisteList');
    const emptyState = document.getElementById('handlelisteEmpty');
    if (!list) return;

    // Show detail, clear overview
    const overviewEl = document.getElementById('listsOverviewContent');
    const detailEl   = document.getElementById('listDetailContent');
    if (overviewEl) overviewEl.innerHTML = '';
    if (detailEl)   detailEl.classList.remove('hidden');

    renderDetailNav();

    // Filter to the active list (items without listId belong to 'main')
    const listItems = items.filter(i => (i.listId || 'main') === selectedListId);

    // Groups overview — show group cards instead of flat item list
    if (selectedGroupFilter === null) {
        const hasNamedGroups = listItems.some(i => !i.checked && i.group && i.group !== '');
        if (!hasNamedGroups) {
            selectedGroupFilter = '';
        } else {
            renderGroupsOverview(listItems);
            return;
        }
    }

    // Group detail — filter to selected group
    const isCurvedView = selectedGroupFilter === '__checked__';
    const scopedItems = isCurvedView
        ? listItems.filter(i => i.checked)
        : listItems.filter(i => (i.group || '') === selectedGroupFilter);

    // Tear down old SortableJS instances before rebuilding DOM
    sortableInstances.forEach(s => { try { s.destroy(); } catch (_) {} });
    sortableInstances = [];

    list.innerHTML = '';

    const unchecked = isCurvedView ? [] : sortedItems(scopedItems.filter(i => !i.checked));
    const checked   = sortedItems(scopedItems.filter(i => i.checked));

    if (emptyState) {
        emptyState.classList.toggle('hidden', scopedItems.length > 0);
        const nameEl = emptyState.querySelector('p.font-bold');
        if (nameEl) nameEl.textContent = isCurvedView ? 'Ingen varer i kurven'
            : selectedGroupFilter ? `Ingen varer i «${selectedGroupFilter}»`
            : 'Ingen varer uten gruppe';
    }
    if (unchecked.length === 0 && checked.length === 0) {
        updateGroupPills();
        return;
    }

    updateGroupPills();

    // ---- Items (flat list — group header not needed in group detail view) ----
    if (unchecked.length > 0) {
        const container = document.createElement('div');
        container.className = 'space-y-2';
        container.dataset.group = isCurvedView ? '' : selectedGroupFilter;
        unchecked.forEach(item => container.appendChild(buildItemEl(item)));
        list.appendChild(container);
        if (typeof Sortable !== 'undefined') {
            sortableInstances.push(Sortable.create(container, {
                group:       'handleliste-items',
                handle:      '.drag-handle',
                animation:   150,
                ghostClass:  'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass:   'sortable-drag',
                onEnd:       handleDragEnd,
            }));
        }
    }

    // ---- Checked section (hidden by default, toggled via button) ----
    if (checked.length > 0) {
        if (!showChecked) {
            const toggle = document.createElement('button');
            toggle.className = 'w-full mt-4 py-2.5 text-xs font-bold text-slate-400 flex items-center justify-center gap-1.5 active:opacity-50 transition-opacity';
            toggle.innerHTML = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>${checked.length} i kurven`;
            toggle.onclick = () => { showChecked = true; renderHandleliste(handlelisteCache); };
            list.appendChild(toggle);
        } else {
            const divider = document.createElement('div');
            divider.className = 'flex items-center gap-3 mt-5 mb-3';
            divider.innerHTML = `
                <div class="h-px flex-1 bg-slate-200 dark-divider"></div>
                <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">I kurven (${checked.length})</span>
                <button onclick="window.clearCheckedItems()" class="text-[11px] font-bold text-rose-400 active:text-rose-500 whitespace-nowrap transition-colors">Fjern alle</button>
                <button onclick="window.hideChecked()" class="text-[11px] font-bold text-slate-300 active:text-slate-500 whitespace-nowrap transition-colors">Skjul</button>
                <div class="h-px flex-1 bg-slate-200 dark-divider"></div>
            `;
            list.appendChild(divider);
            checked.forEach(item => list.appendChild(buildItemEl(item)));
        }
    }
}

// ---- Group pill row in add form — hidden; new items always go to no-group ----
function updateGroupPills() {
    const row   = document.getElementById('handlelisteGroupRow');
    const pills = document.getElementById('handlelisteGroupPills');
    if (!row || !pills) return;

    // Keep row hidden — group selection is not exposed in the add form
    row.classList.add('hidden');
    pills.innerHTML = '';
    // Only reset group if not inside a named group view
    if (!selectedGroupFilter || selectedGroupFilter === '__checked__') {
        selectedAddGroup = '';
    }
    return;

    const groups = [...new Set(
        handlelisteCache
            .filter(i => i.group && (i.listId || 'main') === selectedListId)
            .map(i => i.group)
    )].sort();

    const dark = document.body.classList.contains('dark-mode');

    if (groups.length > 0) {
        // "Ingen gruppe" pill
        const noneBtn = document.createElement('button');
        noneBtn.className = selectedAddGroup === ''
            ? 'hl-group-pill hl-group-pill-active'
            : 'hl-group-pill hl-group-pill-inactive';
        noneBtn.textContent = 'Ingen gruppe';
        noneBtn.onclick = () => { selectedAddGroup = ''; updateGroupPills(); };
        pills.appendChild(noneBtn);

        // Existing group pills
        groups.forEach(g => {
            const btn = document.createElement('button');
            const pillColor = getGroupColor(g);
            if (selectedAddGroup === g) {
                btn.className = 'hl-group-pill';
                btn.style.backgroundColor = dark ? pillColor.darkBg : pillColor.bg;
                btn.style.color = dark ? pillColor.darkText : pillColor.text;
                btn.style.border = `1.5px solid ${pillColor.dot}`;
            } else {
                btn.className = 'hl-group-pill hl-group-pill-inactive';
            }
            btn.textContent = g;
            btn.onclick = () => {
                selectedAddGroup = selectedAddGroup === g ? '' : g;
                updateGroupPills();
            };
            pills.appendChild(btn);
        });
    }

    // "Ny gruppe" pill — always shown
    const newBtn = document.createElement('button');
    newBtn.className = 'hl-group-pill hl-group-pill-new';
    newBtn.innerHTML = '<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> Ny gruppe';
    newBtn.onclick = () => showNewGroupSheet();
    pills.appendChild(newBtn);
}

function showNewGroupInput(pills, existingGroups) {
    // Replace the "+" button with an inline input
    const last = pills.lastChild;
    if (last) last.remove();

    const wrap = document.createElement('div');
    wrap.className = 'flex items-center gap-1';

    const inp = document.createElement('input');
    inp.placeholder = 'Gruppenavn...';
    inp.className = 'text-xs font-bold bg-slate-50 border border-slate-200 rounded-full px-3 py-1 outline-none focus:border-indigo-400 w-28 transition-colors';
    inp.style.minWidth = '0';

    const confirm = document.createElement('button');
    confirm.className = 'hl-group-pill hl-group-pill-active';
    confirm.textContent = 'OK';

    const doConfirm = () => {
        const name = inp.value.trim();
        if (name) selectedAddGroup = name;
        updateGroupPills();
    };

    inp.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); if (e.key === 'Escape') updateGroupPills(); });
    confirm.onclick = doConfirm;

    wrap.appendChild(inp);
    wrap.appendChild(confirm);
    pills.appendChild(wrap);
    inp.focus();
}

// ---- Group header ----
function buildGroupHeader(groupName, groupItems) {
    const header = document.createElement('div');
    header.className = 'flex items-center gap-2 mb-2 mt-1 px-1';

    if (groupName) {
        const color = getGroupColor(groupName);
        const dark = document.body.classList.contains('dark-mode');

        const dot = document.createElement('div');
        dot.className = 'w-2 h-2 rounded-full shrink-0';
        dot.style.backgroundColor = color.dot;

        const nameEl = document.createElement('span');
        nameEl.className = 'text-xs font-bold uppercase tracking-wider flex-1 truncate';
        nameEl.style.color = dark ? color.darkText : color.text;
        nameEl.textContent = groupName;

        const editBtn = document.createElement('button');
        editBtn.className = 'text-[10px] text-slate-300 font-semibold px-2 py-0.5 rounded-full border border-slate-200 active:border-indigo-300 active:text-indigo-500 transition-colors shrink-0';
        editBtn.textContent = 'Gi nytt navn';
        editBtn.onclick = () => inlineRenameGroup(groupName, nameEl, groupItems.map(i => i.id));

        header.appendChild(dot);
        header.appendChild(nameEl);
        header.appendChild(editBtn);
    } else {
        // Ungrouped label — only shown when there are also named groups
        const nameEl = document.createElement('span');
        nameEl.className = 'text-xs font-semibold text-slate-300 uppercase tracking-wider';
        nameEl.textContent = 'Uten gruppe';
        header.appendChild(nameEl);
    }

    return header;
}

// ---- Item element ----
function buildItemEl(item) {
    const el = document.createElement('div');
    el.dataset.id = item.id;
    el.className = [
        'flex items-center gap-3 p-3 bg-white rounded-2xl border shadow-sm transition-all',
        item.checked ? 'border-slate-100 handleliste-item-checked' : 'border-slate-200',
    ].join(' ');

    // Colored left border for group (unchecked only, no extra space)
    if (!item.checked && item.group) {
        const gc = getGroupColor(item.group);
        el.style.borderLeftColor = gc.dot;
        el.style.borderLeftWidth = '3px';
    }

    // Drag handle (unchecked only)
    if (!item.checked) {
        const handle = document.createElement('div');
        handle.className = 'drag-handle flex flex-col items-center gap-[3px] cursor-grab active:cursor-grabbing shrink-0 px-0.5 rounded-md active:bg-slate-100 transition-colors';
        handle.innerHTML = `
            <div class="w-3 h-[2px] bg-slate-300 rounded-full"></div>
            <div class="w-3 h-[2px] bg-slate-300 rounded-full"></div>
            <div class="w-3 h-[2px] bg-slate-300 rounded-full"></div>
        `;
        el.appendChild(handle);
    }

    // Checkbox
    const checkbox = document.createElement('button');
    checkbox.className = [
        'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
        item.checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 active:border-indigo-400',
    ].join(' ');
    checkbox.innerHTML = item.checked
        ? '<svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'
        : '';
    checkbox.onclick = (e) => { e.stopPropagation(); window.toggleHandlelisteItem(item.id, !item.checked); };
    el.appendChild(checkbox);

    // Text + meta
    const textWrap = document.createElement('div');
    textWrap.className = 'flex-1 min-w-0';

    const isUrl = /^https?:\/\//i.test(item.name);
    let urlHost = '';
    if (isUrl) {
        try { urlHost = new URL(item.name).hostname.replace(/^www\./, ''); } catch { urlHost = item.name; }
    }

    const nameEl = document.createElement('span');
    if (isUrl) {
        const displayText = item.pageTitle || urlHost;
        nameEl.className = 'flex items-center gap-1.5 font-bold text-sm leading-tight text-indigo-500 min-w-0';

        const fav = document.createElement('img');
        fav.src = `https://www.google.com/s2/favicons?domain=${urlHost}&sz=32`;
        fav.className = 'w-4 h-4 rounded shrink-0';
        fav.onerror = () => { fav.style.display = 'none'; };

        const titleSpan = document.createElement('span');
        titleSpan.className = 'truncate';
        titleSpan.textContent = displayText;

        nameEl.appendChild(fav);
        nameEl.appendChild(titleSpan);
    } else {
        nameEl.className = `block font-bold text-sm leading-tight ${item.checked ? 'text-slate-400 line-through' : 'text-slate-900'}`;
        nameEl.textContent = item.name;
    }
    textWrap.appendChild(nameEl);

    // Domain subtitle for URL items when we have a fetched page title
    if (isUrl && item.pageTitle) {
        const domainEl = document.createElement('span');
        domainEl.className = 'block text-[10px] text-slate-400 font-medium leading-tight mt-0.5';
        domainEl.textContent = urlHost;
        textWrap.appendChild(domainEl);
    }

    if (item.checked && item.addedBy) {
        const byEl = document.createElement('span');
        byEl.className = 'text-[10px] text-slate-400 font-medium';
        byEl.textContent = item.addedBy;
        textWrap.appendChild(byEl);
    }

    // Notes preview (unchecked only)
    if (!item.checked && item.notes) {
        const noteEl = document.createElement('p');
        noteEl.className = 'text-[10px] text-slate-400 mt-0.5 leading-tight';
        noteEl.style.cssText = 'display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden';
        noteEl.textContent = item.notes;
        textWrap.appendChild(noteEl);
    }

    // Assigned-to badge
    if (!item.checked && item.assignedTo) {
        const member = (state.householdMembers || []).find(m => m.name === item.assignedTo);
        const badge = document.createElement('span');
        badge.className = 'inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white';
        badge.style.backgroundColor = member?.color || '#4f46e5';
        badge.textContent = '→ ' + item.assignedTo;
        textWrap.appendChild(badge);
    }

    if (!item.checked && !item.group) {
        const chip = document.createElement('button');
        chip.className = 'mt-0.5 inline-flex items-center text-[10px] text-slate-300 hover:text-slate-400 transition-colors';
        chip.innerHTML = `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`;
        chip.onclick = (e) => { e.stopPropagation(); showGroupPicker(item.id); };
        textWrap.appendChild(chip);
    }

    el.appendChild(textWrap);

    // Open-link button for URL items (unchecked only)
    if (isUrl && !item.checked) {
        const linkBtn = document.createElement('a');
        linkBtn.href = item.name;
        linkBtn.target = '_blank';
        linkBtn.rel = 'noopener';
        linkBtn.className = 'p-1.5 rounded-lg text-indigo-400 active:text-indigo-600 transition-colors shrink-0';
        linkBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
        linkBtn.onclick = (e) => e.stopPropagation();
        el.appendChild(linkBtn);
    }

    // Quantity controls (unchecked, non-URL items only)
    if (!item.checked && !isUrl) {
        const qtyWrap = document.createElement('div');
        qtyWrap.className = 'flex items-center gap-0.5 shrink-0';

        const minusBtn = document.createElement('button');
        minusBtn.className = 'w-7 h-7 rounded-full flex items-center justify-center text-slate-400 active:text-indigo-600 active:bg-indigo-50 transition-colors font-bold leading-none';
        minusBtn.textContent = '−';
        minusBtn.onclick = (e) => { e.stopPropagation(); window.updateHandlelisteQty(item.id, -1); };

        const qtyLabel = document.createElement('span');
        qtyLabel.className = 'text-xs font-bold text-slate-700 min-w-[1.2rem] text-center';
        qtyLabel.textContent = String(item.quantity > 1 ? item.quantity : 1);

        const plusBtn = document.createElement('button');
        plusBtn.className = 'w-7 h-7 rounded-full flex items-center justify-center text-slate-400 active:text-indigo-600 active:bg-indigo-50 transition-colors font-bold leading-none';
        plusBtn.textContent = '+';
        plusBtn.onclick = (e) => { e.stopPropagation(); window.updateHandlelisteQty(item.id, 1); };

        qtyWrap.appendChild(minusBtn);
        qtyWrap.appendChild(qtyLabel);
        qtyWrap.appendChild(plusBtn);
        el.appendChild(qtyWrap);
    }

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'p-1 rounded-lg text-slate-300 active:text-rose-400 transition-colors shrink-0';
    delBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
    delBtn.onclick = (e) => { e.stopPropagation(); window.deleteHandlelisteItem(item.id); };
    el.appendChild(delBtn);

    // Tapping anywhere on an unchecked card opens the detail sheet
    if (!item.checked) {
        el.style.cursor = 'pointer';
        el.onclick = () => showItemDetail(item.id);
    }

    return el;
}

// ---- Drag end handler ----
async function handleDragEnd(evt) {
    const draggedId     = evt.item.dataset.id;
    const srcContainer  = evt.from;
    const destContainer = evt.to;
    const newGroup      = destContainer.dataset.group ?? '';

    // --- Optimistic: update local cache from DOM order ---
    const destIds = [...destContainer.querySelectorAll('[data-id]')].map(el => el.dataset.id);
    const srcIds  = srcContainer !== destContainer
        ? [...srcContainer.querySelectorAll('[data-id]')].map(el => el.dataset.id)
        : [];

    destIds.forEach((id, idx) => {
        const item = handlelisteCache.find(i => i.id === id);
        if (!item) return;
        item.sortOrder = (idx + 1) * 1000;
        if (id === draggedId && srcContainer !== destContainer) item.group = newGroup;
    });
    srcIds.forEach((id, idx) => {
        const item = handlelisteCache.find(i => i.id === id);
        if (item) item.sortOrder = (idx + 1) * 1000;
    });

    // SortableJS already moved the DOM node — suppress snapshot re-renders
    suppressHold();

    // --- Write to Firestore in background ---
    try {
        const batch = writeBatch(db);
        destIds.forEach((id, idx) => {
            const upd = { sortOrder: (idx + 1) * 1000 };
            if (id === draggedId && srcContainer !== destContainer) upd.group = newGroup;
            batch.update(doc(db, "households", state.currentHid, "handleliste", id), upd);
        });
        srcIds.forEach((id, idx) => {
            batch.update(doc(db, "households", state.currentHid, "handleliste", id), {
                sortOrder: (idx + 1) * 1000,
            });
        });
        await batch.commit();
    } catch (err) {
        showToast("Feil ved lagring av rekkefølge: " + err.message, 'error');
    }
}

// ============================================================
// Optimistic update helpers
// ============================================================

// Suppress onSnapshot re-renders for a window after a local write.
// Any snapshot that arrives while suppressed is stored and flushed
// only if its data differs from what we already rendered locally.
function suppressHold(ms = 1500) {
    suppressRender = true;
    if (suppressTimer) clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
        suppressRender = false;
        suppressTimer  = null;
        if (pendingRenderItems) {
            renderHandleliste(pendingRenderItems);
            pendingRenderItems = null;
        }
    }, ms);
}

// Apply a mutation to handlelisteCache, re-render immediately from
// local state, then write to Firestore in the background.
async function optimisticWrite(mutateFn, firestoreFn) {
    mutateFn();
    renderHandleliste(handlelisteCache);
    suppressHold();
    try {
        await firestoreFn();
    } catch (err) {
        // Let the next snapshot correct any divergence
        suppressRender = false;
        showToast("Feil: " + err.message, 'error');
    }
}

// ============================================================
// Group picker (bottom sheet)
// ============================================================

function showGroupPicker(itemId) {
    const item = handlelisteCache.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('groupPickerOverlay')?.remove();

    const dark = document.body.classList.contains('dark-mode');
    const existingGroups = [...new Set(
        handlelisteCache.filter(i => i.group).map(i => i.group)
    )].sort();

    const overlay = document.createElement('div');
    overlay.id = 'groupPickerOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background: rgba(15,23,42,0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);';

    const sheet = document.createElement('div');
    sheet.className = [
        'w-full max-w-lg rounded-t-3xl p-5 shadow-2xl border-t',
        dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100',
    ].join(' ');
    // Slide up animation
    sheet.style.cssText = 'animation: slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'flex items-center justify-between mb-5';
    hdr.innerHTML = `
        <div>
            <p class="text-[10px] font-bold uppercase tracking-widest ${dark ? 'text-slate-400' : 'text-slate-400'} mb-0.5">Gruppe</p>
            <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">${escapeText(item.name)}</h3>
        </div>
        <button id="_gp_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70 transition-opacity">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
    `;
    sheet.appendChild(hdr);

    // Existing group pills
    if (existingGroups.length > 0) {
        const grid = document.createElement('div');
        grid.className = 'flex flex-wrap gap-2 mb-4';
        existingGroups.forEach(g => {
            const isActive = item.group === g;
            const btn = document.createElement('button');
            const gc = getGroupColor(g);
            if (isActive) {
                btn.className = 'px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:opacity-80 transition-opacity';
                btn.style.backgroundColor = dark ? gc.darkBg : gc.bg;
                btn.style.color = dark ? gc.darkText : gc.text;
                btn.style.border = `1.5px solid ${gc.dot}`;
            } else {
                btn.className = `px-4 py-2 rounded-xl text-sm font-bold active:opacity-70 transition-opacity ${dark ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-700'}`;
            }
            btn.textContent = g;
            btn.onclick = () => { window.setItemGroup(itemId, g); overlay.remove(); };
            grid.appendChild(btn);
        });
        sheet.appendChild(grid);
    }

    // New group input row
    const inputRow = document.createElement('div');
    inputRow.className = 'flex gap-2';

    const newInput = document.createElement('input');
    newInput.id = '_gp_input';
    newInput.placeholder = existingGroups.length ? 'Ny gruppe...' : 'Skriv gruppenavn...';
    newInput.className = [
        'flex-1 px-4 py-3 text-sm font-semibold rounded-xl border focus:outline-none focus:border-indigo-400 transition-colors',
        dark ? 'bg-slate-900 border-slate-600 text-slate-100 placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900',
    ].join(' ');

    const addBtn = document.createElement('button');
    addBtn.className = 'px-5 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold active:bg-indigo-700 transition-colors shrink-0';
    addBtn.textContent = 'Legg til';

    const doAdd = () => {
        const name = newInput.value.trim();
        if (!name) return;
        window.setItemGroup(itemId, name);
        overlay.remove();
    };

    newInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    addBtn.onclick = doAdd;
    inputRow.appendChild(newInput);
    inputRow.appendChild(addBtn);
    sheet.appendChild(inputRow);

    // Remove group button
    if (item.group) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'mt-3 w-full py-3 text-sm font-bold text-rose-400 rounded-xl border border-rose-100 active:bg-rose-50 transition-colors';
        removeBtn.textContent = 'Fjern fra gruppe';
        removeBtn.onclick = () => { window.setItemGroup(itemId, ''); overlay.remove(); };
        sheet.appendChild(removeBtn);
    }

    // Safe area padding
    const safe = document.createElement('div');
    safe.style.height = 'env(safe-area-inset-bottom, 0px)';
    sheet.appendChild(safe);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#_gp_close').onclick = () => overlay.remove();

    if (!existingGroups.length) setTimeout(() => newInput.focus(), 100);
}

// Inline rename: replaces group name text with an input field
function inlineRenameGroup(oldName, nameEl, itemIds) {
    const input = document.createElement('input');
    input.value = oldName;
    input.className = 'text-xs font-bold text-indigo-600 uppercase tracking-wider bg-transparent border-b-2 border-indigo-400 outline-none flex-1 min-w-0';
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const save = async () => {
        const newName = input.value.trim();
        // Restore label regardless
        nameEl.textContent = newName || oldName;
        input.replaceWith(nameEl);
        if (!newName || newName === oldName) return;
        try {
            const batch = writeBatch(db);
            itemIds.forEach(id => {
                batch.update(doc(db, "households", state.currentHid, "handleliste", id), { group: newName });
            });
            await batch.commit();
            showToast(`Gruppe omdøpt til "${newName}"!`);
        } catch (err) {
            showToast("Feil: " + err.message, 'error');
        }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = oldName; input.blur(); }
    });
}

// ============================================================
// Swipe navigation between lists
// ============================================================

let swipeInitialized = false;
function initSwipeNavigation() {
    if (swipeInitialized) return;
    swipeInitialized = true;

    const section = document.getElementById('sectionListe');
    if (!section) return;

    let startX = 0, startY = 0;

    section.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    section.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        // Must be clearly horizontal (dx > dy) and long enough
        if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
        const idx = listsCache.findIndex(l => l.id === selectedListId);
        if (dx < 0 && idx < listsCache.length - 1) window.switchList(listsCache[idx + 1].id);
        else if (dx > 0 && idx > 0) window.switchList(listsCache[idx - 1].id);
    }, { passive: true });
}

// ============================================================
// New group bottom sheet (from list view)
// ============================================================

function showNewGroupSheet() {
    const dark = document.body.classList.contains('dark-mode');
    document.getElementById('newGroupOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'newGroupOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl p-5 shadow-2xl border-t ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)';

    sheet.innerHTML = `
        <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'} mb-4">Ny gruppe</h3>
        <input id="_ng_input" type="text" placeholder="Gruppenavn..." maxlength="30"
            class="w-full px-4 py-3 rounded-xl text-sm font-bold border ${dark ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400' : 'bg-slate-50 border-slate-200'} outline-none focus:border-indigo-400 mb-3">
        <button id="_ng_confirm" class="w-full py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white active:opacity-80">Opprett gruppe</button>
        <div style="height:env(safe-area-inset-bottom,0px)"></div>`;

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    sheet.querySelector('#_ng_confirm').onclick = () => {
        const name = sheet.querySelector('#_ng_input').value.trim();
        if (!name) return;
        selectedAddGroup = name;
        updateGroupPills();
        close();
        document.getElementById('handlelisteInput')?.focus();
        showToast(`Gruppe «${name}» valgt – legg til varer!`);
    };
    sheet.querySelector('#_ng_input').addEventListener('keydown', e => {
        if (e.key === 'Enter') sheet.querySelector('#_ng_confirm').click();
        if (e.key === 'Escape') close();
    });

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    setTimeout(() => sheet.querySelector('#_ng_input')?.focus(), 300);
}

// ============================================================
// Overview — list of lists
// ============================================================

function renderListsOverview() {
    const navEl      = document.getElementById('shoppingListTabs');
    const overviewEl = document.getElementById('listsOverviewContent');
    const detailEl   = document.getElementById('listDetailContent');
    if (!overviewEl) return;

    if (navEl)    navEl.innerHTML = '';
    if (detailEl) detailEl.classList.add('hidden');

    const dark = document.body.classList.contains('dark-mode');

    const cards = listsCache.map(list => {
        const total     = handlelisteCache.filter(i => (i.listId || 'main') === list.id).length;
        const remaining = handlelisteCache.filter(i => (i.listId || 'main') === list.id && !i.checked).length;
        const done      = total - remaining;
        const countChip = total === 0
            ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'}">Tom</span>`
            : remaining === 0
                ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">Alt klart ✓</span>`
                : `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-500'}">${remaining} gjenstår</span>`;

        return `
            <button onclick="window.openList('${escapeText(list.id)}')"
                class="w-full flex items-center gap-4 p-4 rounded-2xl border shadow-sm active:scale-[0.98] transition-all text-left
                    ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}">
                <span class="text-3xl shrink-0">${list.emoji || '📋'}</span>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-base truncate ${dark ? 'text-slate-100' : 'text-slate-900'}">${escapeText(list.name)}</p>
                    <div class="mt-1">${countChip}</div>
                </div>
                <svg class="w-5 h-5 shrink-0 ${dark ? 'text-slate-600' : 'text-slate-300'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>`;
    }).join('');

    overviewEl.innerHTML = cards + `
        <button onclick="window.showNewListDialog()"
            class="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-dashed active:scale-[0.98] transition-all
                ${dark ? 'border-slate-700 text-slate-500' : 'border-slate-200 text-slate-400'}">
            <span class="text-3xl shrink-0 opacity-50">➕</span>
            <span class="font-bold text-base">Ny liste</span>
        </button>`;
}

// ============================================================
// Detail nav bar
// ============================================================

function renderDetailNav() {
    const navEl = document.getElementById('shoppingListTabs');
    if (!navEl) return;

    const dark        = document.body.classList.contains('dark-mode');
    const currentList = listsCache.find(l => l.id === selectedListId);
    const arrowCls    = `w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90 active:opacity-50 ${dark ? 'text-slate-400' : 'text-slate-400'}`;

    if (selectedGroupFilter === null) {
        // Groups overview: ← | list title (tappable if multiple lists) | ···
        const multiList   = listsCache.length > 1;
        const titleCls    = `flex-1 text-center font-bold text-base truncate px-1 py-2 transition-all ${dark ? 'text-slate-100' : 'text-slate-900'} ${multiList ? 'active:opacity-50' : ''}`;
        const titleAction = multiList ? `onclick="window.showListSwitcher()"` : '';

        navEl.innerHTML = `
            <div class="flex items-center">
                <button onclick="window.backToLists()" class="${arrowCls}">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <button ${titleAction} class="${titleCls}">
                    ${currentList?.emoji || ''} ${escapeText(currentList?.name || '')}${multiList ? ' <svg class="inline w-3 h-3 opacity-40 mb-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>' : ''}
                </button>
                <button onclick="window.showListOptions('${escapeText(selectedListId)}')" class="${arrowCls}">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                </button>
            </div>`;
    } else {
        // Group detail: ← | group name (tappable) | →
        const listItems = handlelisteCache.filter(i => (i.listId || 'main') === selectedListId);
        const groups = [...new Set(listItems.filter(i => !i.checked).map(i => i.group || ''))].sort((a, b) => {
            if (a === '' && b !== '') return 1;
            if (a !== '' && b === '') return -1;
            return a.localeCompare(b, 'nb');
        });
        const hasChecked = listItems.some(i => i.checked);
        const allGroups  = hasChecked ? [...groups, '__checked__'] : groups;
        const gIdx  = allGroups.indexOf(selectedGroupFilter);
        const nextG = gIdx < allGroups.length - 1 ? allGroups[gIdx + 1] : null;
        const gLabel = g => g === '__checked__' ? 'Lagt i kurven' : g === '' ? 'Uten gruppe' : g;

        const gc        = (selectedGroupFilter && selectedGroupFilter !== '__checked__') ? getGroupColor(selectedGroupFilter) : null;
        const nameColor = gc ? (dark ? gc.darkText : gc.text) : (dark ? '#f1f5f9' : '#0f172a');

        navEl.innerHTML = `
            <div class="flex items-center">
                <button onclick="window.backToGroups()" class="${arrowCls}">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <button onclick="window.showGroupSwitcher()" class="flex-1 text-center font-bold text-base truncate px-1 py-2 transition-all active:opacity-50" style="color:${nameColor}">
                    ${escapeText(gLabel(selectedGroupFilter))} <svg class="inline w-3 h-3 opacity-40 mb-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                ${nextG !== null
                    ? `<button onclick="window.openGroup('${escapeText(nextG)}')" class="${arrowCls}"><svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button>`
                    : `<div class="w-10"></div>`}
            </div>`;
    }
}

// ---- Group switcher sheet ----
window.showGroupSwitcher = () => {
    const dark      = document.body.classList.contains('dark-mode');
    const listItems = handlelisteCache.filter(i => (i.listId || 'main') === selectedListId);
    const groups    = [...new Set(listItems.filter(i => !i.checked).map(i => i.group || ''))].sort((a, b) => {
        if (a === '' && b !== '') return 1;
        if (a !== '' && b === '') return -1;
        return a.localeCompare(b, 'nb');
    });
    const hasChecked = listItems.some(i => i.checked);
    const allGroups  = hasChecked ? [...groups, '__checked__'] : groups;
    const gLabel     = g => g === '__checked__' ? 'Lagt i kurven' : g === '' ? 'Uten gruppe' : g;

    document.getElementById('_gsOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = '_gsOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl p-4 shadow-2xl border-t ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)';

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const rows = allGroups.map(g => {
        const gc      = (g && g !== '__checked__') ? getGroupColor(g) : null;
        const isCur   = g === selectedGroupFilter;
        const dotColor = gc ? gc.dot : '#94a3b8';
        const label   = escapeText(gLabel(g));
        return `<button onclick="window.openGroup('${escapeText(g)}');document.getElementById('_gsOverlay')?.remove()"
            class="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all active:opacity-60 ${isCur ? (dark ? 'bg-slate-700' : 'bg-slate-50') : ''}">
            <div class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${dotColor}"></div>
            <span class="flex-1 font-bold text-sm ${dark ? 'text-slate-100' : 'text-slate-900'}">${label}</span>
            ${isCur ? `<svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>` : ''}
        </button>`;
    }).join('');

    sheet.innerHTML = `
        <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4 opacity-50"></div>
        <div class="space-y-1">${rows}</div>
        <div style="height:env(safe-area-inset-bottom,0px)"></div>`;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
};

// ---- List switcher sheet ----
window.showListSwitcher = () => {
    const dark = document.body.classList.contains('dark-mode');
    document.getElementById('_lsOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = '_lsOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl p-4 shadow-2xl border-t ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)';

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const rows = listsCache.map(list => {
        const isCur = list.id === selectedListId;
        return `<button onclick="window.switchList('${escapeText(list.id)}');document.getElementById('_lsOverlay')?.remove()"
            class="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all active:opacity-60 ${isCur ? (dark ? 'bg-slate-700' : 'bg-slate-50') : ''}">
            <span class="text-2xl shrink-0">${list.emoji || '📋'}</span>
            <span class="flex-1 font-bold text-sm ${dark ? 'text-slate-100' : 'text-slate-900'}">${escapeText(list.name)}</span>
            ${isCur ? `<svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>` : ''}
        </button>`;
    }).join('');

    sheet.innerHTML = `
        <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4 opacity-50"></div>
        <div class="space-y-1">${rows}</div>
        <div style="height:env(safe-area-inset-bottom,0px)"></div>`;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
};

// ============================================================
// Groups overview — list of groups as cards
// ============================================================

function renderGroupsOverview(listItems) {
    const list = document.getElementById('handlelisteList');
    const emptyState = document.getElementById('handlelisteEmpty');
    if (!list) return;

    sortableInstances.forEach(s => { try { s.destroy(); } catch (_) {} });
    sortableInstances = [];

    const dark = document.body.classList.contains('dark-mode');
    const unchecked = listItems.filter(i => !i.checked);
    const checked   = listItems.filter(i => i.checked);

    // Collect groups from unchecked items (sorted: named groups A-Z, then ungrouped)
    const groupMap = new Map();
    unchecked.forEach(item => {
        const g = item.group || '';
        if (!groupMap.has(g)) groupMap.set(g, []);
        groupMap.get(g).push(item);
    });
    const sortedGroups = [...groupMap.keys()].sort((a, b) => {
        if (a === '' && b !== '') return 1;
        if (a !== '' && b === '') return -1;
        return a.localeCompare(b, 'nb');
    });

    if (emptyState) {
        emptyState.classList.toggle('hidden', listItems.length > 0);
        const currentList = listsCache.find(l => l.id === selectedListId);
        const nameEl = emptyState.querySelector('p.font-bold');
        if (nameEl) nameEl.textContent = (currentList?.name || 'Handlelisten') + ' er tom';
    }

    list.innerHTML = '';

    sortedGroups.forEach(groupName => {
        const groupItems = groupMap.get(groupName);
        const color = groupName ? getGroupColor(groupName) : null;
        const label = groupName || 'Uten gruppe';

        const btn = document.createElement('button');
        btn.className = `w-full flex items-center gap-4 p-4 rounded-2xl border shadow-sm active:scale-[0.98] transition-all text-left ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`;
        if (color) {
            btn.style.borderLeftColor = color.dot;
            btn.style.borderLeftWidth = '4px';
        }
        btn.onclick = () => window.openGroup(groupName);

        const nameBg  = color ? (dark ? color.darkBg  : color.bg)   : (dark ? '#1e293b' : '#f1f5f9');
        const nameClr = color ? (dark ? color.darkText : color.text) : (dark ? '#94a3b8' : '#64748b');
        const countBg = color ? (dark ? color.darkBg  : color.bg)   : (dark ? '#334155' : '#f1f5f9');

        btn.innerHTML = `
            <div class="flex-1 min-w-0">
                <p class="font-bold text-base truncate" style="color:${color ? nameClr : (dark ? '#f1f5f9' : '#0f172a')}">${escapeText(label)}</p>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 rounded-full shrink-0" style="background:${countBg};color:${nameClr}">${groupItems.length} vare${groupItems.length !== 1 ? 'r' : ''}</span>
            <svg class="w-4 h-4 shrink-0 ${dark ? 'text-slate-600' : 'text-slate-300'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>`;
        list.appendChild(btn);
    });

    if (checked.length > 0) {
        const btn = document.createElement('button');
        btn.className = `w-full flex items-center gap-4 p-4 rounded-2xl border shadow-sm active:scale-[0.98] transition-all text-left ${dark ? 'bg-slate-800 border-slate-700 opacity-70' : 'bg-white border-slate-200 opacity-60'}`;
        btn.onclick = () => window.openGroup('__checked__');
        btn.innerHTML = `
            <div class="flex-1 min-w-0">
                <p class="font-bold text-base ${dark ? 'text-slate-300' : 'text-slate-500'}">✓ Lagt i kurven</p>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'}">${checked.length} vare${checked.length !== 1 ? 'r' : ''}</span>
            <svg class="w-4 h-4 shrink-0 ${dark ? 'text-slate-600' : 'text-slate-300'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>`;
        list.appendChild(btn);
    }

    updateGroupPills();
}

window.hideChecked = () => { showChecked = false; renderHandleliste(handlelisteCache); };

window.openList = (id) => {
    selectedListId = id;
    viewMode = 'detail';
    selectedGroupFilter = null;
    showChecked = false;
    try { sessionStorage.setItem('mittforbruk_list', id); } catch {}
    selectedAddGroup = '';
    renderHandleliste(handlelisteCache);
};

window.backToLists = () => {
    viewMode = 'overview';
    selectedGroupFilter = null;
    showChecked = false;
    selectedAddGroup = '';
    renderHandleliste(handlelisteCache);
};

window.switchList = (id) => {
    selectedListId = id;
    viewMode = 'detail';
    selectedGroupFilter = null;
    showChecked = false;
    try { sessionStorage.setItem('mittforbruk_list', id); } catch {}
    selectedAddGroup = '';
    renderHandleliste(handlelisteCache);
};

window.openGroup = (groupName) => {
    selectedGroupFilter = groupName;
    showChecked = false;
    selectedAddGroup = (groupName === '__checked__' || groupName === null) ? '' : groupName;
    renderHandleliste(handlelisteCache);
};

window.backToGroups = () => {
    selectedGroupFilter = null;
    showChecked = false;
    selectedAddGroup = '';
    renderHandleliste(handlelisteCache);
};

window.showListOptions = (listId) => {
    const list = listsCache.find(l => l.id === listId);
    if (!list) return;
    document.getElementById('listMgmtOverlay')?.remove();
    const dark = document.body.classList.contains('dark-mode');
    const canDelete = listsCache.length > 1;

    const overlay = document.createElement('div');
    overlay.id = 'listMgmtOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl p-5 shadow-2xl border-t ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)';

    sheet.innerHTML = `
        <div class="flex items-center justify-between mb-5">
            <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">${escapeText(list.emoji || '')} ${escapeText(list.name)}</h3>
            <button id="_lo_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="space-y-2">
            <button id="_lo_rename" class="w-full px-4 py-3 rounded-xl text-sm font-bold text-left ${dark ? 'bg-slate-700 text-slate-200' : 'bg-slate-50 text-slate-700'} active:opacity-70">✏️ Gi nytt navn</button>
            <button id="_lo_delete" class="w-full px-4 py-3 rounded-xl text-sm font-bold text-left ${canDelete ? 'bg-rose-50 text-rose-500' : 'bg-slate-50 text-slate-300'} active:opacity-70" ${canDelete ? '' : 'disabled'}>
                🗑️ Slett liste${canDelete ? '' : ' (trenger minst 1 liste)'}
            </button>
        </div>`;

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    sheet.querySelector('#_lo_close').onclick = close;
    sheet.querySelector('#_lo_rename').onclick = () => { close(); showRenameListDialog(listId); };
    if (canDelete) sheet.querySelector('#_lo_delete').onclick = () => { close(); showDeleteListConfirm(listId); };

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
};

window.showNewListDialog = () => {
    document.getElementById('listMgmtOverlay')?.remove();
    const EMOJIS = [
        // Mat & dagligvarer
        '🛒','🍎','🥦','🥩','🧀','🍞','🥛','🥚','🐟','🍗',
        '🍕','🥗','🫙','🧃','☕','🧈','🧅','🧄','🍋','🫐',
        // Hjem & husholdning
        '🏠','🛍️','🧹','🧺','🪴','🧽','🔧','🪣','💡','🛏️',
        // Helse, barn & fritid
        '💊','🧴','👶','🎒','📚','🎨','🧸','🐾','🏋️','🎵',
        // Reise & diverse
        '✈️','🏖️','🚗','🎁','🐶','🌱','📦','🎮','🎓','🌸',
    ];
    let pickedEmoji = '🛒';
    const dark = document.body.classList.contains('dark-mode');

    const overlay = document.createElement('div');
    overlay.id = 'listMgmtOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl p-5 shadow-2xl border-t ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)';

    sheet.innerHTML = `
        <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">Ny liste</h3>
            <button id="_nl_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="flex gap-2 flex-wrap mb-4" id="_nl_emojis">
            ${EMOJIS.map(e => `<button class="nl-emoji w-10 h-10 rounded-xl text-xl flex items-center justify-center border-2 ${e === pickedEmoji ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-slate-50'} active:scale-90 transition-all" data-emoji="${e}">${e}</button>`).join('')}
        </div>
        <input id="_nl_input" type="text" placeholder="Navn på listen..." maxlength="30"
            class="w-full px-4 py-3 rounded-xl text-sm font-bold border ${dark ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400' : 'bg-slate-50 border-slate-200'} outline-none focus:border-indigo-400 mb-4">
        <button id="_nl_confirm" class="w-full py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white active:opacity-80">Opprett liste</button>`;

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    sheet.querySelector('#_nl_close').onclick = close;

    sheet.querySelector('#_nl_emojis').addEventListener('click', e => {
        const btn = e.target.closest('.nl-emoji');
        if (!btn) return;
        pickedEmoji = btn.dataset.emoji;
        sheet.querySelectorAll('.nl-emoji').forEach(b => {
            const sel = b.dataset.emoji === pickedEmoji;
            b.className = `nl-emoji w-10 h-10 rounded-xl text-xl flex items-center justify-center border-2 ${sel ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-slate-50'} active:scale-90 transition-all`;
        });
    });

    sheet.querySelector('#_nl_confirm').onclick = async () => {
        const name = sheet.querySelector('#_nl_input').value.trim();
        if (!name) { sheet.querySelector('#_nl_input').focus(); return; }
        const newList = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, emoji: pickedEmoji, sortOrder: listsCache.length };
        await saveListsMeta([...listsCache, newList]);
        selectedListId = newList.id;
        close();
    };

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    setTimeout(() => sheet.querySelector('#_nl_input')?.focus(), 300);
};

function showRenameListDialog(listId) {
    const list = listsCache.find(l => l.id === listId);
    if (!list) return;
    document.getElementById('listMgmtOverlay')?.remove();
    const dark = document.body.classList.contains('dark-mode');

    const overlay = document.createElement('div');
    overlay.id = 'listMgmtOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl p-5 shadow-2xl border-t ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)';

    sheet.innerHTML = `
        <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'} mb-4">Gi nytt navn</h3>
        <input id="_rl_input" type="text" value="${escapeText(list.name)}" maxlength="30"
            class="w-full px-4 py-3 rounded-xl text-sm font-bold border ${dark ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border-slate-200'} outline-none focus:border-indigo-400 mb-4">
        <button id="_rl_confirm" class="w-full py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white active:opacity-80 mb-2">Lagre</button>
        <button id="_rl_cancel" class="w-full py-3 rounded-xl text-sm font-bold ${dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'} active:opacity-80">Avbryt</button>`;

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    sheet.querySelector('#_rl_cancel').onclick = close;
    sheet.querySelector('#_rl_confirm').onclick = async () => {
        const newName = sheet.querySelector('#_rl_input').value.trim();
        if (!newName) return;
        await saveListsMeta(listsCache.map(l => l.id === listId ? { ...l, name: newName } : l));
        close();
    };

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    setTimeout(() => { const inp = sheet.querySelector('#_rl_input'); if (inp) { inp.focus(); inp.select(); } }, 300);
}

function showDeleteListConfirm(listId) {
    const list = listsCache.find(l => l.id === listId);
    if (!list || listsCache.length <= 1) return;
    document.getElementById('listMgmtOverlay')?.remove();
    const dark = document.body.classList.contains('dark-mode');
    const itemCount = handlelisteCache.filter(i => (i.listId || 'main') === listId).length;

    const overlay = document.createElement('div');
    overlay.id = 'listMgmtOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl p-5 shadow-2xl border-t ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)';

    sheet.innerHTML = `
        <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'} mb-2">Slett «${escapeText(list.name)}»?</h3>
        <p class="text-sm ${dark ? 'text-slate-400' : 'text-slate-500'} mb-5">${itemCount > 0 ? `${itemCount} vare${itemCount !== 1 ? 'r' : ''} vil også bli slettet.` : 'Listen er tom.'}</p>
        <button id="_dl_confirm" class="w-full py-3 rounded-xl text-sm font-bold bg-rose-500 text-white active:opacity-80 mb-2">Slett liste</button>
        <button id="_dl_cancel" class="w-full py-3 rounded-xl text-sm font-bold ${dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'} active:opacity-80">Avbryt</button>`;

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    sheet.querySelector('#_dl_cancel').onclick = close;
    sheet.querySelector('#_dl_confirm').onclick = async () => {
        close();
        const batch = writeBatch(db);
        handlelisteCache
            .filter(i => (i.listId || 'main') === listId)
            .forEach(i => batch.delete(doc(db, "households", state.currentHid, "handleliste", i.id)));
        await batch.commit();
        selectedListId = listsCache.find(l => l.id !== listId)?.id || 'main';
        await saveListsMeta(listsCache.filter(l => l.id !== listId));
    };

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

async function saveListsMeta(lists) {
    const ref = doc(db, "households", state.currentHid, "settings", "shoppingLists");
    await setDoc(ref, { lists });
}

// ============================================================
// CRUD
// ============================================================

window.addHandlelisteItem = async () => {
    const input = document.getElementById('handlelisteInput');
    const qtyEl = document.getElementById('handlelisteQty');
    if (!input) return;

    const name     = input.value.trim();
    const quantity = parseInt(qtyEl?.value) || 1;
    if (!name) return;

    // Check for existing item with same name in the active list
    const existing = handlelisteCache.find(i =>
        i.name.toLowerCase() === name.toLowerCase() &&
        (i.listId || 'main') === selectedListId
    );

    if (existing) {
        if (existing.checked) {
            // Reactivate: uncheck and bubble to top of its group
            try {
                const uncheckedInGroup = handlelisteCache.filter(i => !i.checked && i.group === (existing.group || ''));
                const minOrder = uncheckedInGroup.length
                    ? Math.min(...uncheckedInGroup.map(i => i.sortOrder ?? 0))
                    : 1000;
                await updateDoc(doc(db, "households", state.currentHid, "handleliste", existing.id), {
                    checked:   false,
                    addedAt:   Date.now(),
                    sortOrder: Math.max(0, minOrder - 1000),
                });
                input.value = '';
                if (qtyEl) qtyEl.value = 1;
                hideAutocomplete();
                showToast(`${existing.name} lagt til igjen!`);
            } catch (err) {
                showToast("Feil: " + err.message, 'error');
            }
        } else {
            showToast(`${existing.name} er allerede i listen!`, 'error');
            input.value = '';
            hideAutocomplete();
        }
        return;
    }

    // New item — append after last item in the target group (or overall)
    const targetGroup = selectedAddGroup;
    const listItemsUnchecked = handlelisteCache.filter(i => !i.checked && (i.listId || 'main') === selectedListId);
    const itemsInGroup = listItemsUnchecked.filter(i => (i.group || '') === targetGroup);
    const maxOrder = itemsInGroup.length
        ? Math.max(...itemsInGroup.map(i => i.sortOrder ?? 0))
        : listItemsUnchecked.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);

    try {
        const itemRef = await addDoc(collection(db, "households", state.currentHid, "handleliste"), {
            name,
            quantity,
            checked:   false,
            group:     targetGroup,
            listId:    selectedListId,
            sortOrder: maxOrder + 1000,
            addedBy:   state.currentUserData?.name || 'Meg',
            addedAt:   Date.now(),
        });
        await ensureProdukterExists(name);
        // Background: fetch page title for URL items
        if (/^https?:\/\//i.test(name)) {
            fetchUrlMeta(name).then(meta => {
                if (meta?.title) {
                    updateDoc(doc(db, "households", state.currentHid, "handleliste", itemRef.id), { pageTitle: meta.title }).catch(() => {});
                }
            });
        }
        input.value = '';
        if (qtyEl) qtyEl.value = 1;
        hideAutocomplete();
    } catch (err) {
        showToast("Kunne ikke legge til: " + err.message, 'error');
    }
};

window.updateHandlelisteQty = (id, delta) => {
    const item = handlelisteCache.find(i => i.id === id);
    if (!item) return;
    const newQty = Math.max(1, (item.quantity || 1) + delta);
    return optimisticWrite(
        () => { item.quantity = newQty; },
        () => updateDoc(doc(db, "households", state.currentHid, "handleliste", id), { quantity: newQty })
    );
};

window.toggleHandlelisteItem = (id, checked) =>
    optimisticWrite(
        () => {
            const item = handlelisteCache.find(i => i.id === id);
            if (item) item.checked = checked;
        },
        () => updateDoc(doc(db, "households", state.currentHid, "handleliste", id), { checked })
    );

window.deleteHandlelisteItem = async (id) => {
    // Delete has no local-cache equivalent — just write and let snapshot update
    try {
        await deleteDoc(doc(db, "households", state.currentHid, "handleliste", id));
    } catch (err) {
        showToast("Feil: " + err.message, 'error');
    }
};

window.setItemGroup = (id, group) =>
    optimisticWrite(
        () => {
            const item = handlelisteCache.find(i => i.id === id);
            if (item) item.group = group || '';
        },
        () => updateDoc(doc(db, "households", state.currentHid, "handleliste", id), { group: group || '' })
    );

window.clearCheckedItems = async () => {
    try {
        const batch = writeBatch(db);
        handlelisteCache
            .filter(i => i.checked && (i.listId || 'main') === selectedListId)
            .forEach(i => batch.delete(doc(db, "households", state.currentHid, "handleliste", i.id)));
        await batch.commit();
        showToast("Handlevognen er tømt!");
    } catch (err) {
        showToast("Feil: " + err.message, 'error');
    }
};

async function ensureProdukterExists(name) {
    const normalized = name.trim();
    const existing = produkterCache.find(p => p.name.toLowerCase() === normalized.toLowerCase());
    if (existing) {
        await updateDoc(doc(db, "households", state.currentHid, "produkter", existing.id), {
            count: increment(1),
        });
    } else {
        await addDoc(collection(db, "households", state.currentHid, "produkter"), {
            name: normalized,
            count: 1,
        });
    }
}

// ============================================================
// Autocomplete
// ============================================================

export function initHandlelisteAutocomplete() {
    const input    = document.getElementById('handlelisteInput');
    const dropdown = document.getElementById('handlelisteAutocomplete');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        if (!val) { hideAutocomplete(); return; }

        const matches = produkterCache
            .filter(p => p.name.toLowerCase().includes(val))
            .slice(0, 6);

        if (!matches.length) { hideAutocomplete(); return; }

        dropdown.innerHTML = '';
        matches.forEach(p => {
            const inListActive  = handlelisteCache.find(i => i.name.toLowerCase() === p.name.toLowerCase() && !i.checked  && (i.listId || 'main') === selectedListId);
            const inListChecked = handlelisteCache.find(i => i.name.toLowerCase() === p.name.toLowerCase() &&  i.checked  && (i.listId || 'main') === selectedListId);

            const item = document.createElement('div');
            item.className = 'store-autocomplete-item flex items-center justify-between gap-2';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = p.name;
            item.appendChild(nameSpan);

            if (inListActive) {
                const badge = document.createElement('span');
                badge.className = 'text-[10px] font-bold text-indigo-500 bg-indigo-50 rounded-full px-2 py-0.5 shrink-0';
                badge.textContent = 'I listen';
                item.appendChild(badge);
                item.style.opacity = '0.6';
            } else if (inListChecked) {
                const badge = document.createElement('span');
                badge.className = 'text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5 shrink-0';
                badge.textContent = 'Legg til igjen';
                item.appendChild(badge);
            }

            item.addEventListener('mousedown', e => {
                e.preventDefault();
                input.value = p.name;
                hideAutocomplete();
                window.addHandlelisteItem();
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.remove('hidden');
    });

    input.addEventListener('blur', () => setTimeout(hideAutocomplete, 150));
    input.addEventListener('focus', () => {
        if (input.value.trim()) input.dispatchEvent(new Event('input'));
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); window.addHandlelisteItem(); }
    });
}

function hideAutocomplete() {
    document.getElementById('handlelisteAutocomplete')?.classList.add('hidden');
}

// ============================================================
// Item detail sheet
// ============================================================

function showItemDetail(itemId) {
    const item = handlelisteCache.find(i => i.id === itemId);
    if (!item) return;
    document.getElementById('itemDetailOverlay')?.remove();

    const dark = document.body.classList.contains('dark-mode');
    const overlay = document.createElement('div');
    overlay.id = 'itemDetailOverlay';
    overlay.className = 'fixed inset-0 z-50 flex items-end justify-center';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = [
        'w-full max-w-lg rounded-t-3xl shadow-2xl border-t overflow-y-auto',
        dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100',
    ].join(' ');
    sheet.style.cssText = 'max-height:85vh;animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)';

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'flex items-start justify-between p-5 pb-4';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'flex-1 min-w-0 mr-3';
    const titleLabel = document.createElement('p');
    titleLabel.className = 'text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5';
    titleLabel.textContent = 'Navn';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.name;
    nameInput.className = [
        'font-bold text-lg w-full outline-none border-b-2 border-transparent pb-0.5 transition-colors bg-transparent',
        'focus:border-indigo-400',
        dark ? 'text-slate-100' : 'text-slate-900',
    ].join(' ');
    nameInput.onblur = async () => {
        const newName = nameInput.value.trim();
        if (newName && newName !== item.name) {
            item.name = newName;
            await updateDoc(doc(db, "households", state.currentHid, "handleliste", itemId), { name: newName }).catch(() => {});
        }
    };
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') nameInput.blur(); };
    titleWrap.appendChild(titleLabel);
    titleWrap.appendChild(nameInput);

    const closeBtn = document.createElement('button');
    closeBtn.className = `w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70`;
    closeBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    closeBtn.onclick = close;

    hdr.appendChild(titleWrap);
    hdr.appendChild(closeBtn);
    sheet.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'px-5 pb-5 space-y-5';

    // ---- Notes ----
    const notesLabel = document.createElement('p');
    notesLabel.className = 'text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2';
    notesLabel.textContent = 'Notater';
    const notesArea = document.createElement('textarea');
    notesArea.value = item.notes || '';
    notesArea.placeholder = 'Legg til en merknad...';
    notesArea.rows = 3;
    notesArea.className = [
        'w-full px-3 py-2.5 rounded-xl text-sm font-medium border outline-none resize-none transition-colors',
        dark ? 'bg-slate-900 border-slate-600 text-slate-100 placeholder-slate-500 focus:border-indigo-400'
             : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-indigo-400',
    ].join(' ');
    const notesSaveBtn = document.createElement('button');
    notesSaveBtn.className = 'mt-2 text-xs font-bold text-indigo-500 active:opacity-50 transition-opacity';
    notesSaveBtn.textContent = 'Lagre notat';
    notesSaveBtn.onclick = async () => {
        const notes = notesArea.value.trim();
        item.notes = notes;
        suppressHold();
        await updateDoc(doc(db, "households", state.currentHid, "handleliste", itemId), { notes }).catch(() => {});
        showToast('Notat lagret!');
    };
    const notesSection = document.createElement('div');
    notesSection.appendChild(notesLabel);
    notesSection.appendChild(notesArea);
    notesSection.appendChild(notesSaveBtn);
    body.appendChild(notesSection);

    // ---- Sub-items (deleliste) ----
    const subSection = document.createElement('div');
    const subLabel = document.createElement('p');
    subLabel.className = 'text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2';
    subLabel.textContent = 'Deleliste';
    subSection.appendChild(subLabel);

    const subList = document.createElement('div');
    subList.className = 'space-y-1.5 mb-3';
    subSection.appendChild(subList);

    const refreshSubList = () => {
        subList.innerHTML = '';
        (item.subitems || []).forEach(sub => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2.5 py-0.5';
            const chk = document.createElement('button');
            chk.className = `w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${sub.checked ? 'bg-indigo-600 border-indigo-600' : (dark ? 'border-slate-500' : 'border-slate-300')}`;
            chk.innerHTML = sub.checked ? '<svg class="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : '';
            chk.onclick = () => { window.toggleSubitem(itemId, sub.id); sub.checked = !sub.checked; refreshSubList(); };
            const txt = document.createElement('span');
            txt.className = `flex-1 text-sm ${sub.checked ? (dark ? 'text-slate-500 line-through' : 'text-slate-400 line-through') : (dark ? 'text-slate-200' : 'text-slate-700')}`;
            txt.textContent = sub.text;
            const del = document.createElement('button');
            del.className = 'text-slate-300 active:text-rose-400 transition-colors p-0.5';
            del.innerHTML = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>';
            del.onclick = () => { window.deleteSubitem(itemId, sub.id); item.subitems = (item.subitems || []).filter(s => s.id !== sub.id); refreshSubList(); };
            row.appendChild(chk); row.appendChild(txt); row.appendChild(del);
            subList.appendChild(row);
        });
    };
    refreshSubList();

    const addRow = document.createElement('div');
    addRow.className = 'flex gap-2';
    const subInput = document.createElement('input');
    subInput.type = 'text';
    subInput.placeholder = 'Legg til delelement...';
    subInput.className = [
        'flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border outline-none transition-colors',
        dark ? 'bg-slate-900 border-slate-600 text-slate-100 placeholder-slate-500 focus:border-indigo-400'
             : 'bg-slate-50 border-slate-200 focus:border-indigo-400',
    ].join(' ');
    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold active:opacity-80 shrink-0';
    addSubBtn.textContent = 'Legg til';
    const doAddSub = async () => {
        const text = subInput.value.trim();
        if (!text) return;
        const newSub = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, checked: false };
        item.subitems = [...(item.subitems || []), newSub];
        refreshSubList();
        subInput.value = '';
        suppressHold();
        await updateDoc(doc(db, "households", state.currentHid, "handleliste", itemId), { subitems: item.subitems }).catch(() => {});
        subInput.focus();
    };
    subInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAddSub(); });
    addSubBtn.onclick = doAddSub;
    addRow.appendChild(subInput);
    addRow.appendChild(addSubBtn);
    subSection.appendChild(addRow);
    body.appendChild(subSection);

    // ---- Assigned to (2+ members only) ----
    const members = state.householdMembers || [];
    if (members.length > 1) {
        const assignSection = document.createElement('div');
        const assignLabel = document.createElement('p');
        assignLabel.className = 'text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2';
        assignLabel.textContent = 'Tildelt til';
        assignSection.appendChild(assignLabel);

        const pillRow = document.createElement('div');
        pillRow.className = 'flex flex-wrap gap-2';

        const refreshPills = () => {
            pillRow.innerHTML = '';
            const allBtn = document.createElement('button');
            const allActive = !item.assignedTo;
            allBtn.className = `px-4 py-2 rounded-xl text-sm font-bold transition-colors active:opacity-70 ${allActive ? 'bg-indigo-600 text-white' : (dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600')}`;
            allBtn.textContent = 'Alle';
            allBtn.onclick = async () => { item.assignedTo = null; refreshPills(); suppressHold(); await updateDoc(doc(db, "households", state.currentHid, "handleliste", itemId), { assignedTo: null }).catch(() => {}); };
            pillRow.appendChild(allBtn);
            members.forEach(m => {
                const btn = document.createElement('button');
                const active = item.assignedTo === m.name;
                if (active) {
                    btn.className = 'px-4 py-2 rounded-xl text-sm font-bold text-white active:opacity-70 transition-colors';
                    btn.style.backgroundColor = m.color || '#4f46e5';
                } else {
                    btn.className = `px-4 py-2 rounded-xl text-sm font-bold active:opacity-70 transition-colors ${dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'}`;
                }
                btn.textContent = m.name;
                btn.onclick = async () => { item.assignedTo = m.name; refreshPills(); suppressHold(); await updateDoc(doc(db, "households", state.currentHid, "handleliste", itemId), { assignedTo: m.name }).catch(() => {}); };
                pillRow.appendChild(btn);
            });
        };
        refreshPills();
        assignSection.appendChild(pillRow);
        body.appendChild(assignSection);
    }

    const safe = document.createElement('div');
    safe.style.height = 'env(safe-area-inset-bottom, 0px)';
    body.appendChild(safe);

    sheet.appendChild(body);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

window.toggleSubitem = (itemId, subitemId) => {
    const item = handlelisteCache.find(i => i.id === itemId);
    if (!item || !item.subitems) return;
    const subitems = item.subitems.map(s => s.id === subitemId ? { ...s, checked: !s.checked } : s);
    return optimisticWrite(
        () => { item.subitems = subitems; },
        () => updateDoc(doc(db, "households", state.currentHid, "handleliste", itemId), { subitems })
    );
};

window.deleteSubitem = (itemId, subitemId) => {
    const item = handlelisteCache.find(i => i.id === itemId);
    if (!item || !item.subitems) return;
    const subitems = item.subitems.filter(s => s.id !== subitemId);
    return optimisticWrite(
        () => { item.subitems = subitems; },
        () => updateDoc(doc(db, "households", state.currentHid, "handleliste", itemId), { subitems })
    );
};

// Fetch page title via microlink.io (best-effort, fire-and-forget)
async function fetchUrlMeta(url) {
    try {
        const res = await fetch(
            `https://api.microlink.io/?url=${encodeURIComponent(url)}&palette=false&audio=false&video=false&iframe=false`,
            { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) return null;
        const json = await res.json();
        if (json.status !== 'success') return null;
        return { title: json.data?.title || null };
    } catch { return null; }
}

// Safe text helper (no innerHTML with user data)
function escapeText(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
