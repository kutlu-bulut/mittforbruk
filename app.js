import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, updateDoc, doc, setDoc, deleteDoc, getDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ============================================================
// CONFIG
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyD8KhKw3-sMepEOJ2zaxEcH7Wnxvi0c580",
    authDomain: "mitt-forbruk-79b13.firebaseapp.com",
    projectId: "mitt-forbruk-79b13",
    storageBucket: "mitt-forbruk-79b13.firebasestorage.app",
    messagingSenderId: "383383948424",
    appId: "1:383383948424:web:dee99653e93b55d977a33d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ============================================================
// STATE
// ============================================================
let currentHid = null;
let currentUserData = {};
let currentBudget = 5000;
let selectedType = "Behov";
let selectedBuyer = "";
let householdMembers = [];
let groupedHistory = {};
let currentOpenMonthKey = null;
let activeTab = 'hjem';
let chart = null;

const categoryEmojis = { "Mat": "🍔", "Shopping": "🛍️", "Transport": "🚗", "Bolig": "🏠", "Annet": "📦" };
const profileColors = ["#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#64748b", "#84cc16"];

// ============================================================
// XSS PROTECTION
// ============================================================
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================================
// TOAST (erstatter alert)
// ============================================================
function showToast(message, type = 'success') {
    const existing = document.getElementById('appToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ============================================================
// INLINE MODAL (erstatter prompt / confirm)
// ============================================================
function showModal(title, { inputValue = '', placeholder = '', confirmText = 'OK', cancelText = 'Avbryt', dangerous = false } = {}) {
    return new Promise((resolve) => {
        const existing = document.getElementById('appModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'appModal';
        overlay.className = 'modal-overlay';

        const isConfirmOnly = inputValue === null;

        overlay.innerHTML = `
            <div class="modal-card animate-pop">
                <h3 class="text-lg font-black text-slate-900 mb-4">${escapeHtml(title)}</h3>
                ${isConfirmOnly ? '' : `
                    <input type="text" id="modalInput" value="${escapeHtml(inputValue)}" placeholder="${escapeHtml(placeholder)}"
                        class="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 outline-none font-bold text-lg text-slate-900 mb-4 focus:border-indigo-400 transition-colors">
                `}
                <div class="flex gap-3">
                    <button id="modalCancel" class="flex-1 py-3 rounded-2xl font-black text-sm uppercase tracking-widest bg-slate-100 text-slate-600 active:scale-95 transition-all">${escapeHtml(cancelText)}</button>
                    <button id="modalConfirm" class="flex-1 py-3 rounded-2xl font-black text-sm uppercase tracking-widest text-white active:scale-95 transition-all ${dangerous ? 'bg-rose-500' : 'bg-indigo-600'}">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('modal-visible'));

        const input = document.getElementById('modalInput');
        if (input) {
            input.focus();
            input.select();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') close(input.value);
                if (e.key === 'Escape') close(null);
            });
        }

        function close(value) {
            overlay.classList.remove('modal-visible');
            setTimeout(() => overlay.remove(), 200);
            resolve(value);
        }

        document.getElementById('modalCancel').onclick = () => close(null);
        document.getElementById('modalConfirm').onclick = () => {
            if (isConfirmOnly) close(true);
            else close(input ? input.value : true);
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
    });
}

// ============================================================
// SHARED CARD RENDERER (DRY — brukes av Hjem og Historikk)
// ============================================================
function renderPurchaseCard(p, onClick) {
    const card = document.createElement('div');
    card.className = "bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm active:scale-95 cursor-pointer transition-all hover:border-indigo-200";
    if (onClick) card.onclick = onClick;

    const bColor = getBuyerColor(p.buyer || 'Ukjent');
    const dateStr = new Date(p.createdAt).toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit' });
    const cName = p.category || 'Annet';
    const emojiStr = categoryEmojis[cName] ? categoryEmojis[cName] + " " : "";

    // Bygg kortet med safe DOM methods
    const topRow = document.createElement('div');
    topRow.className = "flex justify-between items-start";

    const leftCol = document.createElement('div');
    leftCol.className = "flex flex-col";

    const nameRow = document.createElement('div');
    nameRow.className = "flex items-center gap-2";

    const storeName = document.createElement('h3');
    storeName.className = "font-black text-sm uppercase text-slate-900";
    storeName.textContent = p.store || 'Butikk';

    const dateChip = document.createElement('span');
    dateChip.className = "text-[10px] font-black text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100";
    dateChip.textContent = dateStr;

    nameRow.appendChild(storeName);
    nameRow.appendChild(dateChip);
    leftCol.appendChild(nameRow);

    if (p.desc) {
        const descEl = document.createElement('p');
        descEl.className = "text-xs text-slate-400 font-bold mt-0.5";
        descEl.textContent = p.desc;
        leftCol.appendChild(descEl);
    }

    const priceEl = document.createElement('p');
    priceEl.className = "font-black text-lg text-slate-900";
    priceEl.textContent = (p.price || 0).toLocaleString() + " kr";

    topRow.appendChild(leftCol);
    topRow.appendChild(priceEl);
    card.appendChild(topRow);

    // Tags
    const tagsRow = document.createElement('div');
    tagsRow.className = "flex flex-wrap gap-2 mt-3";

    const typeChip = document.createElement('span');
    typeChip.className = `text-[10px] font-black px-2 py-1 rounded-lg border uppercase ${(p.type || 'Behov') === 'Behov' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`;
    typeChip.textContent = p.type || 'Behov';
    tagsRow.appendChild(typeChip);

    const catChip = document.createElement('span');
    catChip.className = "text-[10px] font-black px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 uppercase";
    catChip.textContent = emojiStr + cName;
    tagsRow.appendChild(catChip);

    const buyerChip = document.createElement('span');
    buyerChip.className = "text-[10px] font-black px-2 py-1 rounded-lg uppercase text-white shadow-sm";
    buyerChip.style.backgroundColor = bColor;
    buyerChip.textContent = p.buyer || 'Ukjent';
    tagsRow.appendChild(buyerChip);

    if (p.rating) {
        const ratingChip = document.createElement('span');
        ratingChip.className = "text-[10px] font-black text-amber-500 bg-amber-50 px-2 py-1 rounded-lg uppercase flex items-center gap-0.5 border border-amber-100";
        ratingChip.textContent = "★ " + p.rating;
        tagsRow.appendChild(ratingChip);
    }

    card.appendChild(tagsRow);
    return card;
}

// ============================================================
// AUTHENTICATION
// ============================================================
window.login = () => {
    const btn = document.getElementById('loginBtn');
    const oldText = btn.innerText;
    btn.innerText = "Logger inn...";
    signInWithPopup(auth, provider).catch(err => {
        showToast("Kunne ikke logge inn: " + err.message, 'error');
        btn.innerText = oldText;
    });
};

window.logout = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async (user) => {
    if (user) {
        onSnapshot(doc(db, "users", user.uid), (d) => {
            try {
                if (d.exists()) {
                    currentUserData = d.data() || {};
                    currentHid = currentUserData.hid || null;

                    renderColorPicker();
                    applyUserPreferences();

                    if (currentHid) {
                        startApp();
                    } else {
                        document.getElementById('loginScreen').classList.add('hidden');
                        document.getElementById('appContent').classList.add('hidden');
                        document.getElementById('onboardingScreen').classList.remove('hidden');
                    }
                } else {
                    const safeName = user.displayName ? user.displayName.split(' ')[0] : 'Bruker';
                    setDoc(doc(db, "users", user.uid), { name: safeName, email: user.email ? user.email.toLowerCase() : '', color: '#6366f1', darkMode: false, hid: null });
                }
            } catch (error) { console.error("Data error:", error); }
        });
    }
});

// ============================================================
// UI PREFERENCES
// ============================================================
function renderColorPicker() {
    const container = document.getElementById('colorPickerGrid');
    if (!container) return;
    container.innerHTML = '';
    const safeUserColor = currentUserData.color || '#4f46e5';

    profileColors.forEach(color => {
        const dot = document.createElement('div');
        dot.className = `color-dot ${safeUserColor === color ? 'active' : ''}`;
        dot.style.backgroundColor = color;
        dot.onclick = () => updateDoc(doc(db, "users", auth.currentUser.uid), { color });
        container.appendChild(dot);
    });
}

function applyUserPreferences() {
    const isDark = !!currentUserData.darkMode;
    const safeName = currentUserData.name || 'Meg';
    const safeColor = currentUserData.color || '#4f46e5';

    document.body.classList.toggle('dark-mode', isDark);

    const dot = document.getElementById('darkModeDot');
    if (dot) dot.style.left = isDark ? '28px' : '4px';

    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.style.backgroundColor = isDark ? '#4f46e5' : '#cbd5e1';

    const nameInput = document.getElementById('profileNameInput');
    if (nameInput) nameInput.value = safeName;

    document.documentElement.style.setProperty('--user-color', safeColor);

    const avatar = document.getElementById('profileAvatar');
    if (avatar) avatar.innerText = safeName.charAt(0).toUpperCase();
}

window.toggleDarkMode = async () => {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { darkMode: !currentUserData.darkMode });
};

// ============================================================
// APP INITIALIZATION
// ============================================================
async function startApp() {
    if (!currentHid) return;

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('onboardingScreen').classList.add('hidden');
    document.getElementById('appContent').classList.remove('hidden');

    document.getElementById('displayHid').innerText = currentHid;

    const safeUserName = currentUserData.name || 'Meg';
    document.getElementById('userNameDisplay').innerText = "Hei, " + safeUserName + "!";

    getDoc(doc(db, "households", currentHid, "settings", "global")).then(async (d) => {
        try {
            if (!d.exists() || !d.data().categoriesMigrated) {
                const defaultCats = ["Mat", "Shopping", "Transport", "Bolig", "Annet"];
                for (let c of defaultCats) {
                    await addDoc(collection(db, "households", currentHid, "categories"), { name: c });
                }
                await setDoc(doc(db, "households", currentHid, "settings", "global"), {
                    monthlyBudget: d.exists() ? (d.data().monthlyBudget || 5000) : 5000,
                    categoriesMigrated: true
                }, { merge: true });
            }
        } catch (e) { console.error("Migration error:", e); }
    });

    onSnapshot(doc(db, "households", currentHid), (d) => {
        if (d.exists()) {
            document.getElementById('hhNameDisplay').innerText = d.data().name || 'Min husstand';
            document.getElementById('householdNameInput').value = d.data().name || '';
        }
    });

    onSnapshot(doc(db, "households", currentHid, "settings", "global"), (d) => {
        if (d.exists()) {
            currentBudget = d.data().monthlyBudget || 5000;
            document.getElementById('budgetInput').value = currentBudget;
            document.getElementById('budgetLabel').innerText = "Budsjett: " + currentBudget.toLocaleString() + " kr";
        }
    });

    onSnapshot(query(collection(db, "users"), where("hid", "==", currentHid)), (snap) => {
        const list = document.getElementById('memberList');
        list.innerHTML = '';
        householdMembers = [];

        snap.forEach(d => {
            const u = d.data();
            householdMembers.push(u);

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

        const p = householdMembers.find(m => m.name !== (currentUserData.name || 'Meg'));
        if (p) document.getElementById('btnBuyer2').innerText = p.name || 'Partner';
        if (!selectedBuyer) window.setBuyerToggle(true);
    });

    // --- PURCHASES LISTENER ---
    onSnapshot(query(collection(db, "households", currentHid, "purchases"), orderBy("createdAt", "desc")), (snap) => {
        const list = document.getElementById('purchasesList');
        list.innerHTML = '';
        let total = 0, buyerSums = {}, catSums = {}, all = [];

        let myTotalLifetimePurchases = 0, myLyst = 0, myBehov = 0, myCatCounts = {};
        const now = new Date();
        const safeUserName = currentUserData.name || 'Meg';

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

        // Profile stats
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

        // Budget bar
        document.getElementById('totalMonth').innerText = total.toLocaleString() + " kr";
        const safeBudget = currentBudget || 1;
        document.getElementById('budgetBar').style.width = Math.min((total / safeBudget) * 100, 100) + "%";
        const diff = currentBudget - total;
        document.getElementById('budgetStatusChip').innerText = diff >= 0 ? `${diff.toLocaleString()} kr under` : `${Math.abs(diff).toLocaleString()} kr over`;
        document.getElementById('budgetStatusChip').className = `text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${diff >= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100 font-extrabold shadow-sm'}`;

        updateDuellen(buyerSums);
        updateDailyInsights(total);
        updateHistory(all);
        updateChart(catSums);
    });

    // --- CATEGORIES LISTENER ---
    onSnapshot(query(collection(db, "households", currentHid, "categories"), orderBy("name")), (snap) => {
        const sel = document.getElementById('category');
        const adminList = document.getElementById('customCatsList');
        sel.innerHTML = '';
        adminList.innerHTML = '';

        snap.forEach(d => {
            const name = d.data().name || 'Kategori';
            const catId = d.id;
            const emojiStr = categoryEmojis[name] ? categoryEmojis[name] + " " : "";

            // Select option (safe)
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = emojiStr + name;
            sel.appendChild(opt);

            // Admin chip (safe DOM)
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
    });
}

// ============================================================
// UI HELPERS
// ============================================================
function getBuyerColor(buyerName) {
    const safeUserName = currentUserData.name || 'Meg';
    if (buyerName === safeUserName) return currentUserData.color || '#4f46e5';
    const member = householdMembers.find(m => m.name === buyerName);
    if (member) return member.color || '#f43f5e';
    const otherMember = householdMembers.find(m => m.name !== safeUserName);
    if (otherMember) return otherMember.color || '#f43f5e';
    return '#f43f5e';
}

window.setBuyerToggle = (isMe) => {
    const btn1 = document.getElementById('btnBuyer1');
    const btn2 = document.getElementById('btnBuyer2');

    const safeUserName = currentUserData.name || 'Meg';
    const p = householdMembers.find(m => m.name !== safeUserName) || { name: 'Partner', color: '#f43f5e' };
    selectedBuyer = isMe ? safeUserName : p.name;

    btn1.style.backgroundColor = '#f8fafc'; btn1.style.color = '#94a3b8'; btn1.style.boxShadow = 'none'; btn1.style.borderColor = 'transparent';
    btn2.style.backgroundColor = '#f8fafc'; btn2.style.color = '#94a3b8'; btn2.style.boxShadow = 'none'; btn2.style.borderColor = 'transparent';

    if (isMe) {
        btn1.style.backgroundColor = currentUserData.color || '#4f46e5';
        btn1.style.color = 'white';
        btn1.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
    } else {
        btn2.style.backgroundColor = p.color || '#f43f5e';
        btn2.style.color = 'white';
        btn2.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
    }
};

window.syncBuyerUI = (dbName) => {
    const safeUserName = currentUserData.name || 'Meg';
    window.setBuyerToggle(dbName === safeUserName);
};

function updateDuellen(buyerSums) {
    let m1Name = currentUserData.name || "Meg";
    let m1Color = currentUserData.color || "#4f46e5";
    let m1Sum = buyerSums[m1Name] || 0;

    let p = householdMembers.find(m => m.name !== m1Name) || { name: 'Partner', color: '#f43f5e' };
    let m2Name = p.name || "Partner";
    let m2Color = p.color || '#f43f5e';

    let m2Sum = 0;
    Object.keys(buyerSums).forEach(name => {
        if (name !== m1Name) m2Sum += buyerSums[name];
    });

    document.getElementById('duelAvatar1').innerText = m1Name.charAt(0).toUpperCase();
    document.getElementById('duelAvatar1').style.backgroundColor = m1Color;
    document.getElementById('statKName').innerText = m1Name;

    document.getElementById('duelAvatar2').innerText = m2Name.charAt(0).toUpperCase();
    document.getElementById('duelAvatar2').style.backgroundColor = m2Color;
    document.getElementById('statHName').innerText = m2Name;

    let totalDuel = m1Sum + m2Sum;

    if (totalDuel === 0) {
        document.getElementById('battleK').style.width = "50%";
        document.getElementById('battleK').style.backgroundColor = '#f1f5f9';
        document.getElementById('battleH').style.backgroundColor = '#f1f5f9';
        document.getElementById('battleKAmount').innerText = "";
        document.getElementById('battleHAmount').innerText = "";
    } else {
        let kPct = (m1Sum / totalDuel) * 100;
        kPct = Math.max(15, Math.min(85, kPct));

        document.getElementById('battleK').style.width = `${kPct}%`;
        document.getElementById('battleK').style.backgroundColor = m1Color;
        document.getElementById('battleH').style.backgroundColor = m2Color;

        document.getElementById('battleKAmount').innerText = `${m1Sum.toLocaleString()} kr`;
        document.getElementById('battleHAmount').innerText = `${m2Sum.toLocaleString()} kr`;
    }
}

function updateDailyInsights(currentTotal) {
    const now = new Date();
    const currentDay = now.getDate() || 1;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const avg = Math.round(currentTotal / currentDay);
    document.getElementById('avgPerDay').innerText = `${avg.toLocaleString()} kr`;

    const diff = currentBudget - currentTotal;
    const daysLeft = (daysInMonth - currentDay) + 1;

    if (diff > 0 && daysLeft > 0) {
        const leftAvg = Math.round(diff / daysLeft);
        document.getElementById('leftPerDay').innerText = `${leftAvg.toLocaleString()} kr`;
        document.getElementById('leftPerDay').className = "text-xl font-black text-emerald-600";
    } else {
        document.getElementById('leftPerDay').innerText = "0 kr";
        document.getElementById('leftPerDay').className = "text-xl font-black text-rose-500";
    }
}

function updateHistory(purchases) {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    groupedHistory = {};

    purchases.forEach(p => {
        const d = new Date(p.createdAt);
        const sortKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0');
        const displayName = d.toLocaleString('no-NO', { month: 'long', year: 'numeric' });
        if (!groupedHistory[sortKey]) groupedHistory[sortKey] = { label: displayName, total: 0, items: [] };
        groupedHistory[sortKey].total += (p.price || 0);
        groupedHistory[sortKey].items.push(p);
    });

    const sortedKeys = Object.keys(groupedHistory).sort().reverse();
    if (sortedKeys.length === 0) {
        list.innerHTML = '<p class="text-center text-sm font-bold text-slate-400 uppercase mt-10">Ingen historikk enda</p>';
        if (activeTab === 'historikkDetaljer') window.switchTab('historikk');
        return;
    }

    sortedKeys.forEach(k => {
        const m = groupedHistory[k];
        const row = document.createElement('div');
        row.className = "bg-white p-6 rounded-[2rem] flex justify-between items-center border border-slate-200 mb-3 shadow-sm cursor-pointer active:scale-95 transition-all hover:border-indigo-200 hover:shadow-md";
        row.onclick = () => window.openMonth(k);

        const label = document.createElement('span');
        label.className = "font-black text-sm uppercase text-slate-900 tracking-widest";
        label.textContent = m.label;

        const right = document.createElement('div');
        right.className = "flex items-center gap-3";

        const amount = document.createElement('span');
        amount.className = "font-black text-lg text-indigo-600";
        amount.textContent = m.total.toLocaleString() + " kr";

        const chevronWrap = document.createElement('div');
        chevronWrap.className = "bg-indigo-50 p-1 rounded-full";
        const chevron = document.createElement('i');
        chevron.setAttribute('data-lucide', 'chevron-right');
        chevron.className = "w-5 h-5 text-indigo-400";
        chevronWrap.appendChild(chevron);

        right.appendChild(amount);
        right.appendChild(chevronWrap);

        row.appendChild(label);
        row.appendChild(right);
        list.appendChild(row);
    });
    lucide.createIcons();

    if (activeTab === 'historikkDetaljer' && currentOpenMonthKey) {
        if (groupedHistory[currentOpenMonthKey]) {
            window.openMonth(currentOpenMonthKey, true);
        } else {
            window.switchTab('historikk');
        }
    }
}

window.openMonth = (key, preventScroll = false) => {
    currentOpenMonthKey = key;
    window.switchTab('historikkDetaljer', preventScroll);

    const m = groupedHistory[key];
    document.getElementById('historikkDetaljerTitle').innerText = m.label;

    let sumMe = 0, sumPartner = 0;
    const safeUserName = currentUserData.name || 'Meg';
    let pName = householdMembers.find(mem => mem.name !== safeUserName)?.name || 'Partner';
    let myColor = currentUserData.color || '#4f46e5';
    let pColor = householdMembers.find(mem => mem.name !== safeUserName)?.color || '#f43f5e';
    let catsObj = {};

    m.items.forEach(p => {
        if (p.buyer === safeUserName) sumMe += (p.price || 0);
        else sumPartner += (p.price || 0);
        catsObj[p.category || 'Annet'] = (catsObj[p.category || 'Annet'] || 0) + (p.price || 0);
    });

    const sortedCats = Object.entries(catsObj).sort((a, b) => b[1] - a[1]);
    const topCat = sortedCats.length > 0 ? sortedCats[0] : ["Ingen", 0];

    const diff = currentBudget - m.total;
    const statusText = diff >= 0 ? `${diff.toLocaleString()} kr under budsjett` : `${Math.abs(diff).toLocaleString()} kr over budsjett`;
    const statusClass = diff >= 0 ? 'text-emerald-500 bg-emerald-50 border-emerald-100' : 'text-rose-500 bg-rose-50 border-rose-100';

    // Summary — safe DOM
    const summaryDiv = document.getElementById('historikkDetaljerSummary');
    summaryDiv.innerHTML = '';

    const summaryCard = document.createElement('div');
    summaryCard.className = "bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm mb-4";
    summaryCard.innerHTML = `
        <div class="flex justify-between items-end mb-4 border-b border-slate-100 pb-4">
            <div>
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Totalt forbruk</p>
                <p class="text-3xl font-black text-slate-900 leading-none">${m.total.toLocaleString()} kr</p>
            </div>
            <span class="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${statusClass}">${escapeHtml(statusText)}</span>
        </div>
        <div class="grid grid-cols-2 gap-4">
            <div class="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Duellen</p>
                <p class="text-sm font-black" style="color: ${escapeHtml(myColor)}">${escapeHtml(safeUserName)}: ${sumMe.toLocaleString()} kr</p>
                <p class="text-sm font-black mt-0.5" style="color: ${escapeHtml(pColor)}">${escapeHtml(pName)}: ${sumPartner.toLocaleString()} kr</p>
            </div>
            <div class="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Største Kategori</p>
                <p class="text-sm font-black text-slate-900 truncate">${escapeHtml(topCat[0])}</p>
                <p class="text-xs font-bold text-slate-400 mt-0.5">${topCat[1].toLocaleString()} kr</p>
            </div>
        </div>
    `;
    summaryDiv.appendChild(summaryCard);

    // Detail list — shared card renderer
    const detailList = document.getElementById('historikkDetaljerList');
    detailList.innerHTML = '';

    m.items.forEach(p => {
        const card = renderPurchaseCard(p, () => {
            window.editMode(p.id, p.store, p.desc, p.price, p.category, p.type, p.buyer, p.rating, p.createdAt);
        });
        detailList.appendChild(card);
    });
};

window.backToHistorikk = () => { window.switchTab('historikk'); };

function updateChart(catSums) {
    const ctx = document.getElementById('categoryChart');
    if (chart) chart.destroy();
    if (Object.keys(catSums).length === 0) {
        chart = new Chart(ctx, { type: 'doughnut', data: { labels: ['Ingen kjøp'], datasets: [{ data: [1], backgroundColor: ['#f8fafc'], borderWidth: 0 }] }, options: { cutout: '80%', maintainAspectRatio: false, plugins: { tooltip: { enabled: false }, legend: { display: false } } } });
        return;
    }
    chart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(catSums), datasets: [{ data: Object.values(catSums), backgroundColor: profileColors, borderWidth: 0 }] }, options: { cutout: '75%', maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter', weight: 'bold', size: 12 } } } } } });
}

// ============================================================
// APP ACTIONS (tabs, forms, CRUD)
// ============================================================
window.switchTab = (t, preventScroll = false) => {
    if (t !== 'add') activeTab = t;

    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('nav-active'));

    const targetSection = document.getElementById('section' + t.charAt(0).toUpperCase() + t.slice(1));
    if (targetSection) targetSection.classList.add('active');

    const navId = t === 'historikkDetaljer' ? 'historikk' : t;
    const navBtn = document.getElementById('nav-' + navId);
    if (navBtn) navBtn.classList.add('nav-active');

    if (t !== 'historikkDetaljer') {
        const displayTitle = t === 'innstillinger' ? 'Husstand' : t.charAt(0).toUpperCase() + t.slice(1);
        const titleElement = document.getElementById('pageTitleDisplay');
        if (titleElement) titleElement.innerText = displayTitle;
    }

    const fab = document.getElementById('fabAdd');
    if (fab) fab.classList.toggle('hidden', t === 'add');
    if (!preventScroll) window.scrollTo(0, 0);
};

window.openNewPurchase = () => { window.cancelEdit(); window.switchTab('add'); };
window.closeAddForm = () => { window.cancelEdit(); window.switchTab(activeTab); };

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
        buyer: selectedBuyer || currentUserData.name || 'Meg',
        createdAt: new Date(dInput).getTime(),
        type: selectedType || 'Behov',
        rating: parseInt(rate)
    };

    try {
        if (id) await updateDoc(doc(db, "households", currentHid, "purchases", id), obj);
        else await addDoc(collection(db, "households", currentHid, "purchases"), obj);
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
            await deleteDoc(doc(db, "households", currentHid, "purchases", document.getElementById('editId').value));
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
    selectedType = t;
    document.getElementById('btnBehov').className = t === 'Behov' ? "flex-1 py-3 rounded-xl text-xs font-black bg-white shadow-sm uppercase text-slate-900 border border-slate-200" : "flex-1 py-3 rounded-xl text-xs font-black text-slate-400 uppercase border border-transparent";
    document.getElementById('btnLyst').className = t === 'Lyst' ? "flex-1 py-3 rounded-xl text-xs font-black bg-white shadow-sm uppercase text-slate-900 border border-slate-200" : "flex-1 py-3 rounded-xl text-xs font-black text-slate-400 uppercase border border-transparent";
};

// ============================================================
// SETTINGS & PROFILE
// ============================================================
window.updateProfile = async () => {
    const newName = document.getElementById('profileNameInput').value.trim() || 'Meg';
    await updateDoc(doc(db, "users", auth.currentUser.uid), { name: newName });
    showToast("Profil lagret!");
};

window.updateHouseholdSettings = async () => {
    await updateDoc(doc(db, "households", currentHid), { name: document.getElementById('householdNameInput').value.trim() || 'Husstand' });
    await setDoc(doc(db, "households", currentHid, "settings", "global"), { monthlyBudget: parseFloat(document.getElementById('budgetInput').value) || 5000 }, { merge: true });
    showToast("Innstillinger lagret!");
};

window.addCategoryPrompt = async () => {
    const n = await showModal("Ny kategori", { placeholder: "F.eks. Underholdning", confirmText: 'Opprett' });
    if (n && n.trim()) {
        await addDoc(collection(db, "households", currentHid, "categories"), { name: n.trim() });
        showToast("Kategori opprettet!");
    }
};

window.editCategoryPrompt = async (id, current) => {
    const n = await showModal("Endre kategorinavn", { inputValue: current, confirmText: 'Lagre' });
    if (n && n.trim() && n !== current) {
        await updateDoc(doc(db, "households", currentHid, "categories", id), { name: n.trim() });
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
        await deleteDoc(doc(db, "households", currentHid, "categories", id));
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
    navigator.clipboard.writeText(currentHid);
    showToast("Invitasjonskode kopiert!");
};

// ============================================================
// SERVICE WORKER & INIT
// ============================================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log("Service Worker registrert!"))
        .catch(err => console.log("Service Worker feilet:", err));
}

lucide.createIcons();
window.switchTab('hjem');
