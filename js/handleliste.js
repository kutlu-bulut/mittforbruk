// ============================================================
// Handleliste — delt handlelistefunksjonalitet
// ============================================================

import {
    collection, addDoc, updateDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, getDocs, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';
import { showToast } from './ui.js';

let produkterCache = []; // { id, name, count }
let handlelisteCache = []; // { id, name, quantity, checked, addedBy, addedAt }

// ============================================================
// Listeners
// ============================================================

export function initHandlelisteListener() {
    if (!state.currentHid) return;

    onSnapshot(
        query(collection(db, "households", state.currentHid, "handleliste"), orderBy("addedAt", "asc")),
        (snap) => {
            const items = [];
            snap.forEach(d => items.push({ id: d.id, ...d.data() }));
            handlelisteCache = items;
            renderHandleliste(items);
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

// ============================================================
// Render
// ============================================================

function renderHandleliste(items) {
    const list = document.getElementById('handlelisteList');
    const emptyState = document.getElementById('handlelisteEmpty');
    if (!list) return;

    list.innerHTML = '';

    const unchecked = items.filter(i => !i.checked);
    const checked = items.filter(i => i.checked);

    if (emptyState) emptyState.classList.toggle('hidden', items.length > 0);

    // Render unchecked items
    unchecked.forEach(item => {
        list.appendChild(buildItemEl(item));
    });

    // Divider + "Lagt i kurven" section header
    if (checked.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'flex items-center gap-3 mt-4 mb-2';
        divider.innerHTML = `
            <div class="h-px flex-1 bg-slate-200 dark-divider"></div>
            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                Lagt i kurven (${checked.length})
            </span>
            <button onclick="window.clearCheckedItems()" class="text-[11px] font-bold text-rose-400 hover:text-rose-500 whitespace-nowrap transition-colors">
                Fjern alle
            </button>
            <div class="h-px flex-1 bg-slate-200 dark-divider"></div>
        `;
        list.appendChild(divider);

        checked.forEach(item => {
            list.appendChild(buildItemEl(item));
        });
    }
}

function buildItemEl(item) {
    const el = document.createElement('div');
    el.className = `flex items-center gap-3 p-3 bg-white rounded-2xl border shadow-sm transition-all mb-2 ${item.checked ? 'border-slate-100 handleliste-item-checked' : 'border-slate-200'}`;

    // Checkbox
    const checkbox = document.createElement('button');
    checkbox.className = `w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${item.checked ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 active:border-indigo-400'}`;
    checkbox.innerHTML = item.checked
        ? '<svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'
        : '';
    checkbox.onclick = () => window.toggleHandlelisteItem(item.id, !item.checked);

    // Text
    const textWrap = document.createElement('div');
    textWrap.className = 'flex-1 min-w-0';

    const nameEl = document.createElement('span');
    nameEl.className = `font-bold text-sm ${item.checked ? 'text-slate-400 line-through' : 'text-slate-900'}`;
    nameEl.textContent = item.name;

    const byEl = document.createElement('span');
    byEl.className = 'text-[10px] text-slate-400 font-medium block';
    byEl.textContent = item.addedBy || '';

    textWrap.appendChild(nameEl);
    textWrap.appendChild(byEl);

    // Quantity controls (only for unchecked items)
    const qtyWrap = document.createElement('div');
    qtyWrap.className = 'flex items-center gap-1 shrink-0';

    if (!item.checked) {
        const minusBtn = document.createElement('button');
        minusBtn.className = 'w-6 h-6 rounded-full flex items-center justify-center text-slate-400 active:text-indigo-600 transition-colors text-base font-bold leading-none';
        minusBtn.textContent = '−';
        minusBtn.onclick = () => window.updateHandlelisteQty(item.id, -1);

        const qtyLabel = document.createElement('span');
        qtyLabel.className = 'text-xs font-bold text-slate-600 min-w-[1.2rem] text-center';
        qtyLabel.textContent = item.quantity > 1 ? item.quantity : '1';

        const plusBtn = document.createElement('button');
        plusBtn.className = 'w-6 h-6 rounded-full flex items-center justify-center text-slate-400 active:text-indigo-600 transition-colors text-base font-bold leading-none';
        plusBtn.textContent = '+';
        plusBtn.onclick = () => window.updateHandlelisteQty(item.id, 1);

        qtyWrap.appendChild(minusBtn);
        qtyWrap.appendChild(qtyLabel);
        qtyWrap.appendChild(plusBtn);
    }

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'p-1.5 rounded-lg text-slate-300 active:text-rose-400 transition-colors shrink-0';
    delBtn.innerHTML = '<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
    delBtn.onclick = () => window.deleteHandlelisteItem(item.id);

    el.appendChild(checkbox);
    el.appendChild(textWrap);
    if (!item.checked) el.appendChild(qtyWrap);
    el.appendChild(delBtn);

    return el;
}

// ============================================================
// CRUD
// ============================================================

window.addHandlelisteItem = async () => {
    const input = document.getElementById('handlelisteInput');
    const qtyEl = document.getElementById('handlelisteQty');
    if (!input) return;

    const name = input.value.trim();
    const quantity = parseInt(qtyEl?.value) || 1;
    if (!name) return;

    // Check for existing item with same name (case-insensitive)
    const existing = handlelisteCache.find(i => i.name.toLowerCase() === name.toLowerCase());

    if (existing) {
        if (existing.checked) {
            // Reactivate: uncheck it and move to top
            try {
                await updateDoc(doc(db, "households", state.currentHid, "handleliste", existing.id), {
                    checked: false,
                    addedAt: Date.now()
                });
                input.value = '';
                if (qtyEl) qtyEl.value = 1;
                hideAutocomplete();
                showToast(`${existing.name} lagt til igjen!`);
            } catch (err) {
                showToast("Feil: " + err.message, 'error');
            }
        } else {
            // Already active in list
            showToast(`${existing.name} er allerede i listen!`, 'error');
            input.value = '';
            hideAutocomplete();
        }
        return;
    }

    // New item
    try {
        await addDoc(collection(db, "households", state.currentHid, "handleliste"), {
            name,
            quantity,
            checked: false,
            addedBy: state.currentUserData.name || 'Meg',
            addedAt: Date.now()
        });
        await ensureProdukterExists(name);
        input.value = '';
        if (qtyEl) qtyEl.value = 1;
        hideAutocomplete();
    } catch (err) {
        showToast("Kunne ikke legge til: " + err.message, 'error');
    }
};

window.updateHandlelisteQty = async (id, delta) => {
    const item = handlelisteCache.find(i => i.id === id);
    if (!item) return;
    const newQty = Math.max(1, (item.quantity || 1) + delta);
    try {
        await updateDoc(doc(db, "households", state.currentHid, "handleliste", id), { quantity: newQty });
    } catch (err) {
        showToast("Feil: " + err.message, 'error');
    }
};

window.toggleHandlelisteItem = async (id, checked) => {
    try {
        await updateDoc(doc(db, "households", state.currentHid, "handleliste", id), { checked });
    } catch (err) {
        showToast("Feil: " + err.message, 'error');
    }
};

window.deleteHandlelisteItem = async (id) => {
    try {
        await deleteDoc(doc(db, "households", state.currentHid, "handleliste", id));
    } catch (err) {
        showToast("Feil: " + err.message, 'error');
    }
};

window.clearCheckedItems = async () => {
    try {
        const snap = await getDocs(collection(db, "households", state.currentHid, "handleliste"));
        const batch = writeBatch(db);
        snap.forEach(d => { if (d.data().checked) batch.delete(d.ref); });
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
            count: increment(1)
        });
    } else {
        await addDoc(collection(db, "households", state.currentHid, "produkter"), {
            name: normalized,
            count: 1
        });
    }
}

// ============================================================
// Autocomplete
// ============================================================

export function initHandlelisteAutocomplete() {
    const input = document.getElementById('handlelisteInput');
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
            const inListUnchecked = handlelisteCache.find(i => i.name.toLowerCase() === p.name.toLowerCase() && !i.checked);
            const inListChecked = handlelisteCache.find(i => i.name.toLowerCase() === p.name.toLowerCase() && i.checked);

            const item = document.createElement('div');
            item.className = 'store-autocomplete-item flex items-center justify-between gap-2';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = p.name;
            item.appendChild(nameSpan);

            if (inListUnchecked) {
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

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = p.name;
                hideAutocomplete();
                // Auto-submit immediately on select
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
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); window.addHandlelisteItem(); }
    });
}

function hideAutocomplete() {
    const dd = document.getElementById('handlelisteAutocomplete');
    if (dd) dd.classList.add('hidden');
}
