// ============================================================
// App Orchestrator — starter listeners og kobler moduler
// ============================================================

import { collection, addDoc, query, orderBy, onSnapshot, setDoc, doc, getDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './js/firebase.js';
import { state, achievementDefs } from './js/state.js';
import { renderPurchaseCard } from './js/cards.js';
import { refreshInsightsView, updateProfileStoreBars } from './js/insights.js';
import { updateHistory } from './js/history.js';
import { renderCategories } from './js/household.js';
import { initStoresListener, initAutocomplete } from './js/stores.js';
import { initHandlelisteListener, initProdukterListener, initHandlelisteAutocomplete, initShoppingListsListener } from './js/handleliste.js';
import { showToast } from './js/ui.js';

// Side-effect imports (registrerer window-funksjoner)
import './js/navigation.js';
import './js/purchases.js';
import './js/preferences.js';
import './js/household.js';
import './js/stores.js';
import './js/import.js';

import { initAuth } from './js/auth.js';

// ============================================================
// Achievements renderer
// ============================================================
function renderAchievements(stats) {
    const container = document.getElementById('achievementsList');
    if (!container) return;
    container.innerHTML = '';

    achievementDefs.forEach(ach => {
        const unlocked = ach.check(stats);
        const card = document.createElement('div');
        card.className = `achievement-card ${unlocked ? '' : 'locked'}`;

        const icon = document.createElement('span');
        icon.className = 'ach-icon';
        icon.textContent = ach.icon;

        const name = document.createElement('span');
        name.className = 'ach-name';
        name.textContent = ach.name;

        card.appendChild(icon);
        card.appendChild(name);
        container.appendChild(card);
    });
}

// ============================================================
// Budget bar color helper
// ============================================================
function updateBudgetBarColor(total) {
    const bar = document.getElementById('budgetBar');
    if (!bar) return;

    const pct = state.currentBudget > 0 ? (total / state.currentBudget) * 100 : 0;
    bar.style.width = Math.min(pct, 100) + '%';

    bar.classList.remove('budget-bar-ok', 'budget-bar-warn', 'budget-bar-over');
    if (pct >= 100) bar.classList.add('budget-bar-over');
    else if (pct >= 75) bar.classList.add('budget-bar-warn');
    else bar.classList.add('budget-bar-ok');
}

// ============================================================
// startApp — kalles fra auth.js når brukeren er innlogget
// ============================================================
let appStarted = false;
export function startApp() {
    if (!state.currentHid) return;

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('onboardingScreen').classList.add('hidden');
    document.getElementById('appContent').classList.remove('hidden');

    // Switch to the user's preferred default tab (only on first launch)
    if (!appStarted) {
        appStarted = true;
        window.switchTab(state.currentUserData.defaultTab || 'hjem');
    }

    document.getElementById('displayHid').innerText = state.currentHid;

    // Init stores
    initStoresListener();
    initAutocomplete();

    // Init handleliste
    initShoppingListsListener();
    initHandlelisteListener();
    initProdukterListener();
    initHandlelisteAutocomplete();

    const safeUserName = state.currentUserData.name || 'Meg';
    document.getElementById('userNameDisplay').innerText = "Hei, " + safeUserName + "!";

    // Migrate categories if needed
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

    // Household name
    onSnapshot(doc(db, "households", state.currentHid), (d) => {
        if (d.exists()) {
            document.getElementById('hhNameDisplay').innerText = d.data().name || 'Min husstand';
            document.getElementById('householdNameInput').value = d.data().name || '';
        }
    }, (err) => {
        console.error("Household listener error:", err);
        showToast("Kunne ikke laste husstand – prøv å laste på nytt", 'error');
    });

    // Budget
    onSnapshot(doc(db, "households", state.currentHid, "settings", "global"), (d) => {
        if (d.exists()) {
            state.currentBudget = d.data().monthlyBudget || 5000;
            document.getElementById('budgetInput').value = state.currentBudget;
            document.getElementById('budgetLabel').innerText = "Budsjett: " + state.currentBudget.toLocaleString() + " kr";
        }
    }, (err) => {
        console.error("Budget listener error:", err);
        showToast("Kunne ikke laste budsjett – prøv å laste på nytt", 'error');
    });

    // Members
    onSnapshot(query(collection(db, "users"), where("hid", "==", state.currentHid)), (snap) => {
        const list = document.getElementById('memberList');
        list.innerHTML = '';
        state.householdMembers = [];

        snap.forEach(d => {
            const u = d.data();
            state.householdMembers.push(u);

            const row = document.createElement('div');
            row.className = "flex items-center gap-3 p-3 bg-slate-50 rounded-xl mb-2 border border-slate-200";

            const avatarEl = document.createElement('div');
            avatarEl.className = "w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-sm border-2 border-white";
            avatarEl.style.backgroundColor = u.color || '#ccc';
            avatarEl.textContent = u.avatar || (u.name || 'U').charAt(0).toUpperCase();

            const name = document.createElement('span');
            name.className = "text-sm font-bold text-slate-700";
            name.textContent = u.name || 'Ukjent';

            row.appendChild(avatarEl);
            row.appendChild(name);
            list.appendChild(row);
        });

        window.renderBuyerSelector();
    }, (err) => {
        console.error("Members listener error:", err);
        showToast("Kunne ikke laste medlemmer – prøv å laste på nytt", 'error');
    });

    // --- PURCHASES LISTENER ---
    onSnapshot(query(collection(db, "households", state.currentHid, "purchases"), orderBy("createdAt", "desc")), (snap) => {
        const list = document.getElementById('purchasesList');
        const emptyState = document.getElementById('emptyStateHjem');
        list.innerHTML = '';
        let total = 0, buyerSums = {}, catSums = {}, storeSums = {}, all = [];
        let currentMonthCount = 0;

        let myTotalLifetimePurchases = 0, myLyst = 0, myBehov = 0, myCatCounts = {}, myStoreSums = {}, myRatedCount = 0;
        const now = new Date();
        const safeUserName = state.currentUserData.name || 'Meg';

        snap.forEach(dDoc => {
            const p = dDoc.data();
            const id = dDoc.id;
            const date = new Date(p.createdAt);
            all.push({ ...p, id });
            state.allPurchases = all;

            if (p.buyer === safeUserName) {
                myTotalLifetimePurchases++;
                if ((p.type || 'Behov') === 'Lyst') myLyst++; else myBehov++;
                const c = p.category || 'Annet';
                myCatCounts[c] = (myCatCounts[c] || 0) + 1;
                if (p.rating && p.rating > 0) myRatedCount++;
                const sName = p.store || 'Ukjent';
                myStoreSums[sName] = (myStoreSums[sName] || 0) + (p.price || 0);
            }

            if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
                currentMonthCount++;
                total += (p.price || 0);
                const bName = p.buyer || 'Ukjent';
                const cName = p.category || 'Annet';

                buyerSums[bName] = (buyerSums[bName] || 0) + (p.price || 0);
                catSums[cName] = (catSums[cName] || 0) + (p.price || 0);
                const sName = p.store || 'Ukjent';
                storeSums[sName] = (storeSums[sName] || 0) + (p.price || 0);

                const card = renderPurchaseCard({ ...p, id }, () => {
                    window.editMode(id, p.store, p.desc, p.price, p.category, p.type, p.buyer, p.rating, p.createdAt);
                });
                list.appendChild(card);
            }
        });

        // Empty state
        if (emptyState) {
            emptyState.classList.toggle('hidden', currentMonthCount > 0);
        }

        // Profile stats
        document.getElementById('profileTotalPurchases').innerText = myTotalLifetimePurchases;

        let favCat = "Ingen";
        let maxCatCount = 0;
        for (let cat in myCatCounts) {
            if (myCatCounts[cat] > maxCatCount) { maxCatCount = myCatCounts[cat]; favCat = cat; }
        }
        document.getElementById('profileFavCat').innerText = favCat;

        // Favorite store
        let favStore = "Ingen";
        let maxStoreAmount = 0;
        for (let store in myStoreSums) {
            if (myStoreSums[store] > maxStoreAmount) { maxStoreAmount = myStoreSums[store]; favStore = store; }
        }
        document.getElementById('profileFavStore').innerText = favStore;

        let totalBL = myLyst + myBehov;
        let behovPct = totalBL > 0 ? Math.round((myBehov / totalBL) * 100) : 0;
        let lystPct = totalBL > 0 ? Math.round((myLyst / totalBL) * 100) : 0;
        document.getElementById('profileBehovPct').innerText = `${behovPct}%`;
        document.getElementById('profileLystPct').innerText = `${lystPct}%`;
        document.getElementById('profileBehovBar').style.width = `${behovPct}%`;

        // Budget
        document.getElementById('totalMonth').innerText = total.toLocaleString() + " kr";
        updateBudgetBarColor(total);
        const diff = state.currentBudget - total;
        document.getElementById('budgetStatusChip').innerText = diff >= 0 ? `${diff.toLocaleString()} kr igjen` : `${Math.abs(diff).toLocaleString()} kr over`;
        document.getElementById('budgetStatusChip').className = `text-[10px] font-bold px-2 py-0.5 rounded-md ${diff >= 0 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`;

        // Achievements
        renderAchievements({
            totalPurchases: myTotalLifetimePurchases,
            monthTotal: total,
            budget: state.currentBudget,
            behovPct: behovPct,
            ratedCount: myRatedCount
        });

        state.allPurchases = all;
        refreshInsightsView();
        updateHistory(all);
        updateProfileStoreBars(myStoreSums);
    }, (err) => {
        console.error("Purchases listener error:", err);
        showToast("Kunne ikke laste kjøp – prøv å laste på nytt", 'error');
    });

    // Categories
    onSnapshot(query(collection(db, "households", state.currentHid, "categories"), orderBy("name")), (snap) => {
        state.categoriesCache = snap.docs.map(d => d.data().name).filter(Boolean);
        renderCategories(snap);
    }, (err) => {
        console.error("Categories listener error:", err);
        showToast("Kunne ikke laste kategorier – prøv å laste på nytt", 'error');
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
initAuth(startApp);
window.switchTab('hjem');
