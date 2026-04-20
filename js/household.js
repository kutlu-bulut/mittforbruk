// ============================================================
// Husstand — innstillinger, kategorier, medlemmer
// ============================================================

import { collection, addDoc, updateDoc, deleteDoc, setDoc, doc, query, where, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from './firebase.js';
import { state, categoryEmojis } from './state.js';
import { showToast, showModal } from './ui.js';

window.updateHouseholdSettings = async () => {
    await updateDoc(doc(db, "households", state.currentHid), {
        name: document.getElementById('householdNameInput').value.trim() || 'Husstand'
    });
    await setDoc(doc(db, "households", state.currentHid, "settings", "global"), {
        monthlyBudget: parseFloat(document.getElementById('budgetInput').value) || 5000
    }, { merge: true });
    showToast("Innstillinger lagret!");
};

window.addCategoryPrompt = async () => {
    const n = await showModal("Ny kategori", { placeholder: "F.eks. Underholdning", confirmText: 'Opprett' });
    if (n && n.trim()) {
        await addDoc(collection(db, "households", state.currentHid, "categories"), { name: n.trim() });
        showToast("Kategori opprettet!");
    }
};

window.editCategoryPrompt = async (id, current) => {
    const n = await showModal("Endre kategorinavn", { inputValue: current, confirmText: 'Lagre' });
    if (n && n.trim() && n !== current) {
        const trimmed = n.trim();
        await updateDoc(doc(db, "households", state.currentHid, "categories", id), { name: trimmed });
        const snap = await getDocs(query(
            collection(db, "households", state.currentHid, "purchases"),
            where("category", "==", current)
        ));
        if (!snap.empty) {
            const batch = writeBatch(db);
            snap.forEach(d => batch.update(d.ref, { category: trimmed }));
            await batch.commit();
        }
        showToast("Kategori oppdatert!");
    }
};

window.deleteCategory = async (id) => {
    const confirmed = await showModal("Er du sikker på at du vil slette kategorien?", {
        inputValue: null,
        confirmText: 'Slett',
        cancelText: 'Avbryt',
        dangerous: true
    });
    if (confirmed) {
        await deleteDoc(doc(db, "households", state.currentHid, "categories", id));
        showToast("Kategori slettet!");
    }
};

window.createHousehold = async () => {
    const hid = "H-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    await setDoc(doc(db, "households", hid), { name: "Min husstand", migrated: true });
    await setDoc(doc(db, "users", auth.currentUser.uid), { hid: hid }, { merge: true });
    location.reload();
};

window.joinHousehold = async () => {
    const c = document.getElementById('joinCodeInput').value.trim();
    if (c) {
        await setDoc(doc(db, "users", auth.currentUser.uid), { hid: c }, { merge: true });
        location.reload();
    }
};

window.copyHid = () => {
    navigator.clipboard.writeText(state.currentHid);
    showToast("Invitasjonskode kopiert!");
};

// Rendrer kategoriliste i admin-panelet (kalles fra app.js listener)
export function renderCategories(snap) {
    const sel = document.getElementById('category');
    const adminList = document.getElementById('customCatsList');
    sel.innerHTML = '';
    adminList.innerHTML = '';

    snap.forEach(d => {
        const name = d.data().name || 'Kategori';
        const catId = d.id;
        const emojiStr = categoryEmojis[name] ? categoryEmojis[name] + " " : "";

        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = emojiStr + name;
        sel.appendChild(opt);

        const chip = document.createElement('span');
        chip.className = "bg-white text-slate-700 px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 border border-slate-200 cursor-pointer transition-all active:scale-95 shadow-sm hover:border-indigo-300";
        chip.textContent = emojiStr + name;
        chip.onclick = () => window.editCategoryPrompt(catId, name);

        const xBtn = document.createElement('i');
        xBtn.className = "w-4 h-4 text-rose-500 bg-rose-50 rounded-full p-0.5 ml-1 border border-rose-100 cursor-pointer";
        xBtn.setAttribute('data-lucide', 'x');
        xBtn.onclick = (e) => { e.stopPropagation(); window.deleteCategory(catId); };
        chip.appendChild(xBtn);

        adminList.appendChild(chip);
    });
    lucide.createIcons();
}
