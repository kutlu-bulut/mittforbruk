// ============================================================
// Butikker — autocomplete, auto-lagring, administrering
// ============================================================

import { collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';
import { escapeHtml, showToast, showModal } from './ui.js';

let knownStores = []; // { id, name }

// ============================================================
// Listener — holder butikklisten oppdatert
// ============================================================
export function initStoresListener() {
    if (!state.currentHid) return;

    onSnapshot(collection(db, "households", state.currentHid, "stores"), (snap) => {
        knownStores = [];
        snap.forEach(d => {
            knownStores.push({ id: d.id, name: d.data().name || '' });
        });
        knownStores.sort((a, b) => a.name.localeCompare(b.name));
    });
}

// ============================================================
// Auto-save — lagrer ny butikk hvis den ikke finnes
// ============================================================
export async function ensureStoreExists(storeName) {
    if (!storeName || !state.currentHid) return;

    const normalized = storeName.trim();
    const exists = knownStores.some(s => s.name.toLowerCase() === normalized.toLowerCase());

    if (!exists) {
        await addDoc(collection(db, "households", state.currentHid, "stores"), { name: normalized });
    }
}

// ============================================================
// Autocomplete — filtrert dropdown under butikk-feltet
// ============================================================
export function initAutocomplete() {
    const input = document.getElementById('store');
    const dropdown = document.getElementById('storeAutocomplete');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        if (val.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }

        const matches = knownStores.filter(s =>
            s.name.toLowerCase().includes(val)
        ).slice(0, 6);

        if (matches.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }

        dropdown.innerHTML = '';
        matches.forEach(s => {
            const item = document.createElement('div');
            item.className = 'store-autocomplete-item';
            item.textContent = s.name;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Hindre blur før click
                input.value = s.name;
                dropdown.classList.add('hidden');
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.remove('hidden');
    });

    input.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 150);
    });

    input.addEventListener('focus', () => {
        if (input.value.trim().length > 0) {
            input.dispatchEvent(new Event('input'));
        }
    });
}

// ============================================================
// Store Manager — modal for å administrere butikker
// ============================================================
window.openStoreManager = () => {
    const existing = document.getElementById('storeManagerModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'storeManagerModal';
    overlay.className = 'modal-overlay';

    function renderList() {
        const listHtml = knownStores.length === 0
            ? '<p class="text-sm text-slate-400 font-semibold text-center py-4">Ingen butikker lagret ennå</p>'
            : knownStores.map(s => `
                <div class="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 store-row" data-id="${escapeHtml(s.id)}">
                    <span class="text-sm font-bold text-slate-700 store-name">${escapeHtml(s.name)}</span>
                    <div class="flex gap-1.5">
                        <button class="store-edit p-1.5 rounded-lg bg-white border border-slate-200 active:scale-90 transition-all" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}">
                            <svg class="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        </button>
                        <button class="store-delete p-1.5 rounded-lg bg-white border border-rose-100 active:scale-90 transition-all" data-id="${escapeHtml(s.id)}">
                            <svg class="w-3.5 h-3.5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            `).join('');

        return listHtml;
    }

    function render() {
        overlay.innerHTML = `
            <div class="modal-card animate-pop" style="max-height: 80vh; overflow-y: auto;">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-black text-slate-900">Butikker</h3>
                    <span class="text-xs font-bold text-slate-400">${knownStores.length} lagret</span>
                </div>
                <div class="space-y-2 mb-4" id="storeManagerList">
                    ${renderList()}
                </div>
                <button id="storeManagerClose" class="w-full py-3 rounded-xl font-bold text-sm bg-slate-100 text-slate-600 active:scale-95 transition-all">Lukk</button>
            </div>
        `;

        // Wire up events
        document.getElementById('storeManagerClose').onclick = closeModal;

        overlay.querySelectorAll('.store-edit').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const current = btn.dataset.name;
                const newName = await showModal("Endre butikknavn", { inputValue: current, confirmText: 'Lagre' });
                if (newName && newName.trim() && newName.trim() !== current) {
                    const trimmed = newName.trim();
                    await updateDoc(doc(db, "households", state.currentHid, "stores", id), { name: trimmed });
                    const snap = await getDocs(query(
                        collection(db, "households", state.currentHid, "purchases"),
                        where("store", "==", current)
                    ));
                    if (!snap.empty) {
                        const batch = writeBatch(db);
                        snap.forEach(d => batch.update(d.ref, { store: trimmed }));
                        await batch.commit();
                    }
                    showToast("Butikk oppdatert!");
                    setTimeout(() => render(), 300);
                }
            });
        });

        overlay.querySelectorAll('.store-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const confirmed = await showModal("Slette denne butikken?", {
                    inputValue: null,
                    confirmText: 'Slett',
                    cancelText: 'Avbryt',
                    dangerous: true
                });
                if (confirmed) {
                    await deleteDoc(doc(db, "households", state.currentHid, "stores", id));
                    showToast("Butikk slettet!");
                    setTimeout(() => render(), 300);
                }
            });
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
    }

    function closeModal() {
        overlay.classList.remove('modal-visible');
        setTimeout(() => overlay.remove(), 200);
    }

    document.body.appendChild(overlay);
    render();
    requestAnimationFrame(() => overlay.classList.add('modal-visible'));
};
