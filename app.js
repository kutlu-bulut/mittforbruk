// ============================================================
// App Orchestrator — starter listeners og kobler moduler
// ============================================================

import { collection, addDoc, query, orderBy, onSnapshot, setDoc, doc, getDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './js/firebase.js';
import { state } from './js/state.js';
import { renderPurchaseCard } from './js/cards.js';
import { updateDuellen, updateDailyInsights, updateChart } from './js/insights.js';
import { updateHistory } from './js/history.js';
import { renderCategories } from './js/household.js';

// Importer moduler som registrerer window-funksjoner (side-effects)
import './js/navigation.js';
import './js/purchases.js';
import './js/preferences.js';
import './js/household.js';
import './js/auth.js';

// Importer initAuth for å starte auth-flyten
import { initAuth } from './js/auth.js';

// ============================================================
// startApp — kalles fra auth.js når brukeren er innlogget
// ============================================================
export function startApp() {
    if (!state.currentHid) return;

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('onboardingScreen').classList.add('hidden');
    document.getElementById('appContent').classList.remove('hidden');

    document.getElementById('displayHid').innerText = state.currentHid;

    const safeUserName = state.currentUserData.name || 'Meg';
    document.getElementById('userNameDisplay').innerText = "Hei, " + safeUserName + "!";

    // --- Migrer kategorier hvis nødvendig ---
    getDoc(doc(db, "households", state.currentHid, "settings", "global")).then(async (d) => {
        try {
            if (!d.exists() || !d.data().categoriesMigrated) {
                const defaultCats = ["Mat", "Shopping", "Transport", "Bolig", "Annet"];
                for (let c of defaultCats) {
                    await addDoc(collection(db, "households", state.currentHid, "categories"), { name: c });
                }
                await setDoc(doc(db, "households", state.currentHid, "settings", "global"), {
                    monthlyBudget: d.exists() ? (d.data().monthlyBudget || 5000) : 5000,
                    categoriesMigrated: true
                }, { merge: true });
            }
        } catch (e) { console.error("Migration error:", e); }
    });

    // --- Husstand-navn listener ---
    onSnapshot(doc(db, "households", state.currentHid), (d) => {
        if (d.exists()) {
            document.getElementById('hhNameDisplay').innerText = d.data().name || 'Min husstand';
            document.getElementById('householdNameInput').value = d.data().name || '';
        }
    });

    // --- Budsjett listener ---
    onSnapshot(doc(db, "households", state.currentHid, "settings", "global"), (d) => {
        if (d.exists()) {
            state.currentBudget = d.data().monthlyBudget || 5000;
            document.getElementById('budgetInput').value = state.currentBudget;
            document.getElementById('budgetLabel').innerText = "Budsjett: " + state.currentBudget.toLocaleString() + " kr";
        }
    });

    // --- Medlemmer listener ---
    onSnapshot(query(collection(db, "users"), where("hid", "==", state.currentHid)), (snap) => {
        const list = document.getElementById('memberList');
        list.innerHTML = '';
        state.householdMembers = [];

        snap.forEach(d => {
            const u = d.data();
            state.householdMembers.push(u);

            const row = document.createElement('div');
            row.className = "flex items-center gap-3 p-3 bg-slate-50 rounded-2xl mb-2 border border-slate-200";

            const dot = document.createElement('div');
            dot.className = "w-4 h-4 rounded-full shadow-sm";
            dot.style.backgroundColor = u.color || '#ccc';

            const name = document.createElement('span');
            name.className = "text-sm font-bold text-slate-700";
            name.textContent = u.name || 'Ukjent';

            row.appendChild(dot);
            row.appendChild(name);
            list.appendChild(row);
        });

        const p = state.householdMembers.find(m => m.name !== (state.currentUserData.name || 'Meg'));
        if (p) document.getElementById('btnBuyer2').innerText = p.name || 'Partner';
        if (!state.selectedBuyer) window.setBuyerToggle(true);
    });

    // --- Kjøp listener (hovedlogikk) ---
    onSnapshot(query(collection(db, "households", state.currentHid, "purchases"), orderBy("createdAt", "desc")), (snap) => {
        const list = document.getElementById('purchasesList');
        list.innerHTML = '';
        let total = 0, buyerSums = {}, catSums = {}, all = [];

        let myTotalLifetimePurchases = 0, myLyst = 0, myBehov = 0, myCatCounts = {};
        const now = new Date();
        const safeUserName = state.currentUserData.name || 'Meg';

        snap.forEach(dDoc => {
            const p = dDoc.data();
            const id = dDoc.id;
            const date = new Date(p.createdAt);
            all.push({ ...p, id });

            if (p.buyer === safeUserName) {
                myTotalLifetimePurchases++;
                if ((p.type || 'Behov') === 'Lyst') myLyst++; else myBehov++;
                const c = p.category || 'Annet';
                myCatCounts[c] = (myCatCounts[c] || 0) + 1;
            }

            if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
                total += (p.price || 0);
                const bName = p.buyer || 'Ukjent';
                const cName = p.category || 'Annet';

                buyerSums[bName] = (buyerSums[bName] || 0) + (p.price || 0);
                catSums[cName] = (catSums[cName] || 0) + (p.price || 0);

                const card = renderPurchaseCard({ ...p, id }, () => {
                    window.editMode(id, p.store, p.desc, p.price, p.category, p.type, p.buyer, p.rating, p.createdAt);
                });
                list.appendChild(card);
            }
        });

        // Profil-stats
        document.getElementById('profileTotalPurchases').innerText = myTotalLifetimePurchases;

        let favCat = "Ingen";
        let maxCatCount = 0;
        for (let cat in myCatCounts) {
            if (myCatCounts[cat] > maxCatCount) { maxCatCount = myCatCounts[cat]; favCat = cat; }
        }
        document.getElementById('profileFavCat').innerText = favCat;

        let totalBL = myLyst + myBehov;
        let behovPct = totalBL > 0 ? Math.round((myBehov / totalBL) * 100) : 0;
        let lystPct = totalBL > 0 ? Math.round((myLyst / totalBL) * 100) : 0;
        document.getElementById('profileBehovPct').innerText = `${behovPct}%`;
        document.getElementById('profileLystPct').innerText = `${lystPct}%`;
        document.getElementById('profileBehovBar').style.width = `${behovPct}%`;

        // Budsjett-bar
        document.getElementById('totalMonth').innerText = total.toLocaleString() + " kr";
        const safeBudget = state.currentBudget || 1;
        document.getElementById('budgetBar').style.width = Math.min((total / safeBudget) * 100, 100) + "%";
        const diff = state.currentBudget - total;
        document.getElementById('budgetStatusChip').innerText = diff >= 0 ? `${diff.toLocaleString()} kr under` : `${Math.abs(diff).toLocaleString()} kr over`;
        document.getElementById('budgetStatusChip').className = `text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${diff >= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100 font-extrabold shadow-sm'}`;

        updateDuellen(buyerSums);
        updateDailyInsights(total);
        updateHistory(all);
        updateChart(catSums);
    });

    // --- Kategorier listener ---
    onSnapshot(query(collection(db, "households", state.currentHid, "categories"), orderBy("name")), (snap) => {
        renderCategories(snap);
    });
}

// ============================================================
// INIT
// ============================================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log("Service Worker registrert!"))
        .catch(err => console.log("Service Worker feilet:", err));
}

lucide.createIcons();
initAuth();
window.switchTab('hjem');
