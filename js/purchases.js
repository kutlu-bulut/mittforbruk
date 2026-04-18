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

    try {
        if (id) await updateDoc(doc(db, "households", state.currentHid, "purchases", id), obj);
        else await addDoc(collection(db, "households", state.currentHid, "purchases"), obj);
        await ensureStoreExists(s);
        showToast(id ? "Kjøp oppdatert!" : "Kjøp lagret!");
        window.closeAddForm();
    } catch (err) {
        showToast("Kunne ikke lagre: " + err.message, 'error');
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
    window.setBuyerToggle(true);
    window.setType('Behov');
};

window.setType = (t) => {
    state.selectedType = t;
    document.getElementById('btnBehov').className = t === 'Behov' ? "flex-1 py-3 rounded-xl text-xs font-black bg-white shadow-sm uppercase text-slate-900 border border-slate-200" : "flex-1 py-3 rounded-xl text-xs font-black text-slate-400 uppercase border border-transparent";
    document.getElementById('btnLyst').className = t === 'Lyst' ? "flex-1 py-3 rounded-xl text-xs font-black bg-white shadow-sm uppercase text-slate-900 border border-slate-200" : "flex-1 py-3 rounded-xl text-xs font-black text-slate-400 uppercase border border-transparent";
};

window.setBuyerToggle = (isMe) => {
    const btn1 = document.getElementById('btnBuyer1');
    const btn2 = document.getElementById('btnBuyer2');

    const safeUserName = state.currentUserData.name || 'Meg';
    const p = state.householdMembers.find(m => m.name !== safeUserName) || { name: 'Partner', color: '#f43f5e' };
    state.selectedBuyer = isMe ? safeUserName : p.name;

    btn1.style.backgroundColor = '#f8fafc'; btn1.style.color = '#94a3b8'; btn1.style.boxShadow = 'none'; btn1.style.borderColor = 'transparent';
    btn2.style.backgroundColor = '#f8fafc'; btn2.style.color = '#94a3b8'; btn2.style.boxShadow = 'none'; btn2.style.borderColor = 'transparent';

    if (isMe) {
        btn1.style.backgroundColor = state.currentUserData.color || '#4f46e5';
        btn1.style.color = 'white';
        btn1.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
    } else {
        btn2.style.backgroundColor = p.color || '#f43f5e';
        btn2.style.color = 'white';
        btn2.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
    }
};

window.syncBuyerUI = (dbName) => {
    const safeUserName = state.currentUserData.name || 'Meg';
    window.setBuyerToggle(dbName === safeUserName);
};
