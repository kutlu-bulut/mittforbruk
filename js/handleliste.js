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
let selectedListId    = 'main';
let listsCache        = [{ id: 'main', name: 'Handleliste', emoji: '🛒', sortOrder: 0 }];

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
        renderHandleliste(handlelisteCache);
    }, err => console.error("ShoppingLists listener error:", err));
}

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
    const list = document.getElementById('handlelisteList');
    const emptyState = document.getElementById('handlelisteEmpty');
    if (!list) return;

    renderListTabs();

    // Filter to the active list (items without listId belong to 'main')
    const listItems = items.filter(i => (i.listId || 'main') === selectedListId);

    // Tear down old SortableJS instances before rebuilding DOM
    sortableInstances.forEach(s => { try { s.destroy(); } catch (_) {} });
    sortableInstances = [];

    list.innerHTML = '';

    const unchecked = sortedItems(listItems.filter(i => !i.checked));
    const checked   = sortedItems(listItems.filter(i => i.checked));

    if (emptyState) {
        emptyState.classList.toggle('hidden', listItems.length > 0);
        const currentList = listsCache.find(l => l.id === selectedListId);
        const nameEl = emptyState.querySelector('p.font-bold');
        if (nameEl) nameEl.textContent = (currentList?.name || 'Handlelisten') + ' er tom';
    }
    if (unchecked.length === 0 && checked.length === 0) {
        updateGroupPills();
        return;
    }

    updateGroupPills();

    // ---- Group unchecked items ----
    // Preserve group order by first appearance (respects sortOrder within each group)
    const groupMap   = new Map(); // groupName → [items]
    const groupOrder = [];        // insertion order of groups
    unchecked.forEach(item => {
        const g = item.group || '';
        if (!groupMap.has(g)) { groupMap.set(g, []); groupOrder.push(g); }
        groupMap.get(g).push(item);
    });

    const hasNamedGroups = groupOrder.some(g => g !== '');

    groupOrder.forEach(groupName => {
        const groupItems = groupMap.get(groupName);
        const section = document.createElement('div');
        section.className = 'mb-3';

        // Group header
        if (groupName || hasNamedGroups) {
            section.appendChild(buildGroupHeader(groupName, groupItems));
        }

        // Items container — this is the SortableJS target
        const container = document.createElement('div');
        container.className = 'space-y-2';
        container.dataset.group = groupName;

        groupItems.forEach(item => container.appendChild(buildItemEl(item)));
        section.appendChild(container);
        list.appendChild(section);

        // Init SortableJS
        if (typeof Sortable !== 'undefined') {
            const instance = Sortable.create(container, {
                group:       'handleliste-items', // shared group = cross-list drag allowed
                handle:      '.drag-handle',
                animation:   150,
                ghostClass:  'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass:   'sortable-drag',
                onEnd:       handleDragEnd,
            });
            sortableInstances.push(instance);
        }
    });

    // ---- Checked section ----
    if (checked.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'flex items-center gap-3 mt-5 mb-3';
        divider.innerHTML = `
            <div class="h-px flex-1 bg-slate-200 dark-divider"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                Lagt i kurven (${checked.length})
            </span>
            <button onclick="window.clearCheckedItems()"
                    class="text-[11px] font-bold text-rose-400 active:text-rose-500 whitespace-nowrap transition-colors">
                Fjern alle
            </button>
            <div class="h-px flex-1 bg-slate-200 dark-divider"></div>
        `;
        list.appendChild(divider);
        checked.forEach(item => list.appendChild(buildItemEl(item)));
    }
}

// ---- Group pill row in add form ----
function updateGroupPills() {
    const row   = document.getElementById('handlelisteGroupRow');
    const pills = document.getElementById('handlelisteGroupPills');
    if (!row || !pills) return;

    const groups = [...new Set(
        handlelisteCache
            .filter(i => i.group && (i.listId || 'main') === selectedListId)
            .map(i => i.group)
    )].sort();

    if (groups.length === 0) {
        row.classList.add('hidden');
        selectedAddGroup = '';
        return;
    }

    row.classList.remove('hidden');
    pills.innerHTML = '';

    const dark = document.body.classList.contains('dark-mode');

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

    // "+" new group pill
    const newBtn = document.createElement('button');
    newBtn.className = 'hl-group-pill hl-group-pill-new';
    newBtn.innerHTML = '<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> Ny';
    newBtn.onclick = () => showNewGroupInput(pills, groups);
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
        'flex items-center gap-2 p-2 bg-white rounded-xl border shadow-sm transition-all',
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
        'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
        item.checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 active:border-indigo-400',
    ].join(' ');
    checkbox.innerHTML = item.checked
        ? '<svg class="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'
        : '';
    checkbox.onclick = () => window.toggleHandlelisteItem(item.id, !item.checked);
    el.appendChild(checkbox);

    // Text + meta
    const textWrap = document.createElement('div');
    textWrap.className = 'flex-1 min-w-0';

    const nameEl = document.createElement('span');
    nameEl.className = `block font-bold text-sm leading-tight ${item.checked ? 'text-slate-400 line-through' : 'text-slate-900 cursor-text'}`;
    nameEl.textContent = item.name;

    if (!item.checked) {
        nameEl.onclick = (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'text';
            input.value = item.name;
            input.className = 'block font-bold text-sm text-slate-900 bg-transparent outline-none border-b-2 border-indigo-400 w-full leading-tight';
            nameEl.replaceWith(input);
            input.focus();
            input.select();

            const save = () => {
                const newName = input.value.trim();
                if (newName && newName !== item.name) {
                    updateDoc(doc(db, "households", state.currentHid, "handleliste", item.id), { name: newName })
                        .catch(err => showToast('Feil: ' + err.message, 'error'));
                }
            };
            input.onblur = save;
            input.onkeydown = (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                if (ev.key === 'Escape') { input.replaceWith(nameEl); }
            };
        };
    }
    textWrap.appendChild(nameEl);

    if (item.checked && item.addedBy) {
        const byEl = document.createElement('span');
        byEl.className = 'text-[10px] text-slate-400 font-medium';
        byEl.textContent = item.addedBy;
        textWrap.appendChild(byEl);
    }

    if (!item.checked && !item.group) {
        // Small tap target to assign a group — just an icon, no label
        const chip = document.createElement('button');
        chip.className = 'mt-0.5 inline-flex items-center text-[10px] text-slate-300 hover:text-slate-400 transition-colors';
        chip.innerHTML = `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`;
        chip.onclick = (e) => { e.stopPropagation(); showGroupPicker(item.id); };
        textWrap.appendChild(chip);
    }

    el.appendChild(textWrap);

    // Quantity controls (unchecked only)
    if (!item.checked) {
        const qtyWrap = document.createElement('div');
        qtyWrap.className = 'flex items-center gap-0.5 shrink-0';

        const minusBtn = document.createElement('button');
        minusBtn.className = 'w-6 h-6 rounded-full flex items-center justify-center text-slate-400 active:text-indigo-600 active:bg-indigo-50 transition-colors font-bold leading-none';
        minusBtn.textContent = '−';
        minusBtn.onclick = (e) => { e.stopPropagation(); window.updateHandlelisteQty(item.id, -1); };

        const qtyLabel = document.createElement('span');
        qtyLabel.className = 'text-xs font-bold text-slate-700 min-w-[1.2rem] text-center';
        qtyLabel.textContent = String(item.quantity > 1 ? item.quantity : 1);

        const plusBtn = document.createElement('button');
        plusBtn.className = 'w-6 h-6 rounded-full flex items-center justify-center text-slate-400 active:text-indigo-600 active:bg-indigo-50 transition-colors font-bold leading-none';
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
    delBtn.onclick = () => window.deleteHandlelisteItem(item.id);
    el.appendChild(delBtn);

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
// List tabs
// ============================================================

function renderListTabs() {
    const el = document.getElementById('shoppingListTabs');
    if (!el) return;

    const tabs = listsCache.map(list => {
        const active = list.id === selectedListId;
        const onclick = active
            ? `window.showListOptions('${list.id}')`
            : `window.switchList('${list.id}')`;
        return `
            <button onclick="${onclick}" class="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap
                ${active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'}">
                ${list.emoji ? `<span>${escapeText(list.emoji)}</span>` : ''}
                <span>${escapeText(list.name)}</span>
                ${active ? `<svg class="w-3 h-3 opacity-60 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>` : ''}
            </button>`;
    }).join('');

    el.innerHTML = `
        <div class="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
            ${tabs}
            <button onclick="window.showNewListDialog()" class="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-bold text-slate-400 border border-dashed border-slate-300 bg-white active:bg-slate-50 transition-colors whitespace-nowrap">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
                Ny
            </button>
        </div>`;
}

window.switchList = (id) => {
    selectedListId = id;
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
    const EMOJIS = ['🛒','🏖️','🛍️','🏠','🎁','🐶','🌱','💊','🔧','📦','🎮','✈️'];
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
        await addDoc(collection(db, "households", state.currentHid, "handleliste"), {
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
            const inListActive  = handlelisteCache.find(i => i.name.toLowerCase() === p.name.toLowerCase() && !i.checked);
            const inListChecked = handlelisteCache.find(i => i.name.toLowerCase() === p.name.toLowerCase() && i.checked);

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

// Safe text helper (no innerHTML with user data)
function escapeText(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
