// ============================================================
// Kjøp — CRUD-operasjoner og skjemahåndtering
// ============================================================

import { collection, addDoc, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';
import { showToast, showModal } from './ui.js';
import { ensureStoreExists } from './stores.js';

window.openNewPurchase = () => { window.cancelEdit(); window.switchTab('add'); };
window.closeAddForm = () => { window.cancelEdit(); window.switchTab(state.activeTab); };

let saving = false;

window.editMode = (id, store, desc, price, cat, type, buyer, rating, time) => {
    window.switchTab('add');
    document.getElementById('editId').value = id;
    document.getElementById('dateInput').value = new Date(time).toISOString().split('T')[0];
    document.getElementById('store').value = store || '';
    document.getElementById('desc').value = desc || '';
    document.getElementById('price').value = price;
    document.getElementById('category').value = cat || '';
    if (rating) document.getElementById('star' + rating).checked = true;
    window.setType(type || 'Behov');
    window.syncBuyerUI(buyer);
    document.getElementById('formTitle').innerText = "Endre kjøp";
    document.getElementById('btnDeleteForm').classList.remove('hidden');
};

window.savePurchase = async () => {
    if (saving) return;
    const id = document.getElementById('editId').value;
    const dInput = document.getElementById('dateInput').value;
    const s = document.getElementById('store').value.trim();
    const d = document.getElementById('desc').value.trim();
    const p = parseFloat(document.getElementById('price').value);
    const rate = document.querySelector('input[name="rating"]:checked')?.value || 0;

    if (!s || isNaN(p) || !dInput) {
        showToast("Fyll inn minst Butikk, Pris og Dato!", 'error');
        return;
    }
    if (p < 0) {
        showToast("Pris kan ikke være negativ!", 'error');
        return;
    }

    const obj = {
        store: s,
        desc: d,
        price: p,
        category: document.getElementById('category').value || 'Annet',
        buyer: state.selectedBuyer || state.currentUserData.name || 'Meg',
        createdAt: new Date(dInput).getTime(),
        type: state.selectedType || 'Behov',
        rating: parseInt(rate)
    };

    saving = true;
    try {
        if (id) await updateDoc(doc(db, "households", state.currentHid, "purchases", id), obj);
        else await addDoc(collection(db, "households", state.currentHid, "purchases"), obj);
        await ensureStoreExists(s);
        showToast(id ? "Kjøp oppdatert!" : "Kjøp lagret!");
        window.closeAddForm();
    } catch (err) {
        showToast("Kunne ikke lagre: " + err.message, 'error');
    } finally {
        saving = false;
    }
};

window.deleteCurrentEdit = async () => {
    const confirmed = await showModal("Er du sikker på at du vil slette dette kjøpet?", {
        inputValue: null,
        confirmText: 'Slett',
        cancelText: 'Avbryt',
        dangerous: true
    });
    if (confirmed) {
        try {
            await deleteDoc(doc(db, "households", state.currentHid, "purchases", document.getElementById('editId').value));
            showToast("Kjøp slettet!");
            window.closeAddForm();
        } catch (e) {
            showToast("Feil ved sletting: " + e.message, 'error');
        }
    }
};

window.cancelEdit = () => {
    document.getElementById('editId').value = '';
    document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('store').value = '';
    document.getElementById('desc').value = '';
    document.getElementById('price').value = '';
    document.getElementById('btnDeleteForm').classList.add('hidden');
    document.getElementById('formTitle').innerText = "Nytt kjøp";
    document.querySelectorAll('input[name="rating"]').forEach(r => r.checked = false);
    window.renderBuyerSelector();
    window.setType('Behov');
};

window.setType = (t) => {
    state.selectedType = t;
    document.getElementById('btnBehov').className = t === 'Behov' ? "flex-1 py-2.5 rounded-lg text-xs font-bold bg-white shadow-sm text-slate-900 border border-slate-100" : "flex-1 py-2.5 rounded-lg text-xs font-bold text-slate-400";
    document.getElementById('btnLyst').className = t === 'Lyst' ? "flex-1 py-2.5 rounded-lg text-xs font-bold bg-white shadow-sm text-slate-900 border border-slate-100" : "flex-1 py-2.5 rounded-lg text-xs font-bold text-slate-400";
};

// Dynamisk buyer selector — tilpasser seg antall medlemmer
window.renderBuyerSelector = () => {
    const container = document.getElementById('buyerSelector');
    if (!container) return;
    container.innerHTML = '';

    const members = state.householdMembers;
    const safeUserName = state.currentUserData.name || 'Meg';

    if (members.length <= 1) {
        // Solo — skjul velgeren, sett automatisk
        container.style.display = 'none';
        state.selectedBuyer = safeUserName;
        return;
    }

    container.style.display = 'flex';

    members.forEach(m => {
        const btn = document.createElement('button');
        btn.className = "flex-1 py-2.5 rounded-lg text-sm font-bold transition-all active:scale-95";
        btn.textContent = m.name || 'Ukjent';
        btn.dataset.buyerName = m.name;
        btn.onclick = () => window.selectBuyer(m.name);
        container.appendChild(btn);
    });

    // Sett default
    if (!state.selectedBuyer) state.selectedBuyer = safeUserName;
    window.highlightBuyer();
};

window.selectBuyer = (name) => {
    state.selectedBuyer = name;
    window.highlightBuyer();
};

window.highlightBuyer = () => {
    const container = document.getElementById('buyerSelector');
    if (!container) return;

    container.querySelectorAll('button').forEach(btn => {
        const name = btn.dataset.buyerName;
        const member = state.householdMembers.find(m => m.name === name);
        const isSelected = name === state.selectedBuyer;

        if (isSelected) {
            btn.style.backgroundColor = member?.color || '#4f46e5';
            btn.style.color = 'white';
            btn.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
        } else {
            btn.style.backgroundColor = '#f8fafc';
            btn.style.color = '#94a3b8';
            btn.style.boxShadow = 'none';
        }
    });
};

window.syncBuyerUI = (dbName) => {
    state.selectedBuyer = dbName;
    window.highlightBuyer();
};
