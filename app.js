import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, updateDoc, doc, setDoc, deleteDoc, getDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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

let currentHid = null, currentUserData = {}, currentBudget = 5000, selectedType = "Behov", selectedBuyer = "", householdMembers = [];
let groupedHistory = {};
let currentOpenMonthKey = null;
let activeTab = 'hjem';

const categoryEmojis = { "Mat": "🍔", "Shopping": "🛍️", "Transport": "🚗", "Bolig": "🏠", "Annet": "📦" };
const profileColors = ["#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#64748b", "#84cc16"];
let chart = null;

// --- AUTHENTICATION ---
window.login = () => {
    const btn = document.getElementById('loginBtn');
    const oldText = btn.innerText;
    btn.innerText = "Logger inn...";
    signInWithPopup(auth, provider).catch(err => {
        alert("Kunne ikke logge inn: " + err.message);
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

// --- UI PREFERENCES ---
function renderColorPicker() {
    const container = document.getElementById('colorPickerGrid');
    if (!container) return; container.innerHTML = '';
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

// --- APP INITIALIZATION ---
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
                await setDoc(doc(db, "households", currentHid, "settings", "global"), { monthlyBudget: d.exists() ? (d.data().monthlyBudget || 5000) : 5000, categoriesMigrated: true }, { merge: true });
            }
        } catch (e) { }
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
        const list = document.getElementById('memberList'); list.innerHTML = '';
        householdMembers = [];
        snap.forEach(d => {
            const u = d.data();
            householdMembers.push(u);
            list.innerHTML += `<div class="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl mb-2 border border-slate-200"><div class="w-4 h-4 rounded-full shadow-sm" style="background:${u.color || '#ccc'}"></div><span class="text-sm font-bold text-slate-700">${u.name || 'Ukjent'}</span></div>`;
        });

        const p = householdMembers.find(m => m.name !== (currentUserData.name || 'Meg'));
        if (p) document.getElementById('btnBuyer2').innerText = p.name || 'Partner';
        if (!selectedBuyer) window.setBuyerToggle(true);
    });

    onSnapshot(query(collection(db, "households", currentHid, "purchases"), orderBy("createdAt", "desc")), (snap) => {
        const list = document.getElementById('purchasesList'); list.innerHTML = '';
        let total = 0, buyerSums = {}, catSums = {}, all = [];

        let myTotalLifetimePurchases = 0, myLyst = 0, myBehov = 0, myCatCounts = {};
        const now = new Date();
        const safeUserName = currentUserData.name || 'Meg';

        snap.forEach(dDoc => {
            const p = dDoc.data(); const id = dDoc.id; const date = new Date(p.createdAt); all.push({ ...p, id });

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

                const card = document.createElement('div'); card.className = "bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm active:scale-95 cursor-pointer transition-all";
                card.onclick = () => window.editMode(id, p.store, p.desc, p.price, p.category, p.type, p.buyer, p.rating, p.createdAt);

                let bColor = getBuyerColor(bName);
                const dateStr = date.toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit' });
                const emojiStr = categoryEmojis[cName] ? categoryEmojis[cName] + " " : "";
                const ratingStr = p.rating ? `<span class="text-[7px] font-black text-amber-500 bg-amber-50 px-2 py-1 rounded-lg uppercase flex items-center gap-0.5 border border-amber-100">★ ${p.rating}</span>` : "";

                card.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <h3 class="font-black text-xs uppercase text-slate-900">${p.store || 'Butikk'}</h3>
                                <span class="text-[9px] font-black text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">${dateStr}</span>
                            </div>
                            <p class="text-[10px] text-slate-400 font-bold mt-0.5">${p.desc || ''}</p>
                        </div>
                        <p class="font-black text-lg text-slate-900">${(p.price || 0).toLocaleString()} kr</p>
                    </div>
                    <div class="flex flex-wrap gap-2 mt-3">
                        <span class="text-[7px] font-black px-2 py-1 rounded-lg border ${(p.type || 'Behov') === 'Behov' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'} uppercase">${p.type || 'Behov'}</span>
                        <span class="text-[7px] font-black px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 uppercase">${emojiStr}${cName}</span>
                        <span class="text-[7px] font-black px-2 py-1 rounded-lg uppercase text-white shadow-sm" style="background:${bColor}">${bName}</span>
                        ${ratingStr}
                    </div>
                `;
                list.appendChild(card);
            }
        });

        document.getElementById('profileTotalPurchases').innerText = myTotalLifetimePurchases;

        let favCat = "Ingen"; let maxCatCount = 0;
        for (let cat in myCatCounts) { if (myCatCounts[cat] > maxCatCount) { maxCatCount = myCatCounts[cat]; favCat = cat; } }
        document.getElementById('profileFavCat').innerText = favCat;

        let totalBL = myLyst + myBehov;
        let behovPct = totalBL > 0 ? Math.round((myBehov / totalBL) * 100) : 0;
        let lystPct = totalBL > 0 ? Math.round((myLyst / totalBL) * 100) : 0;
        document.getElementById('profileBehovPct').innerText = `${behovPct}%`;
        document.getElementById('profileLystPct').innerText = `${lystPct}%`;
        document.getElementById('profileBehovBar').style.width = `${behovPct}%`;

        document.getElementById('totalMonth').innerText = total.toLocaleString() + " kr";
        const safeBudget = currentBudget || 1;
        document.getElementById('budgetBar').style.width = Math.min((total / safeBudget) * 100, 100) + "%";
        const diff = currentBudget - total;
        document.getElementById('budgetStatusChip').innerText = diff >= 0 ? `${diff.toLocaleString()} kr under` : `${Math.abs(diff).toLocaleString()} kr over`;
        document.getElementById('budgetStatusChip').className = `text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${diff >= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100 font-extrabold shadow-sm'}`;

        updateDuellen(buyerSums);
        updateDailyInsights(total);
        updateHistory(all);
        updateChart(catSums);
    });

    onSnapshot(query(collection(db, "households", currentHid, "categories"), orderBy("name")), (snap) => {
        const sel = document.getElementById('category');
        const adminList = document.getElementById('customCatsList');
        sel.innerHTML = ''; adminList.innerHTML = '';

        snap.forEach(d => {
            const name = d.data().name || 'Kategori';
            const emojiStr = categoryEmojis[name] ? categoryEmojis[name] + " " : "";
            sel.innerHTML += `<option value="${name}">${emojiStr}${name}</option>`;
            adminList.innerHTML += `<span onclick="editCategoryPrompt('${d.id}', '${name}')" class="bg-white text-slate-700 px-3 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 border border-slate-200 cursor-pointer transition-all active:scale-95 shadow-sm hover:border-indigo-300">${emojiStr}${name} <i onclick="event.stopPropagation(); deleteCategory('${d.id}')" data-lucide="x" class="w-4 h-4 text-rose-500 bg-rose-50 rounded-full p-0.5 ml-1 border border-rose-100"></i></span>`;
        });
        lucide.createIcons();
    });
}

// --- UI HELPERS ---
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
        document.getElementById('battleK').style.width = "50%"; document.getElementById('battleK').style.backgroundColor = '#f1f5f9';
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
    let leftAvg = 0;

    if (diff > 0 && daysLeft > 0) {
        leftAvg = Math.round(diff / daysLeft);
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
        list.innerHTML = '<p class="text-center text-xs font-bold text-slate-400 uppercase mt-10">Ingen historikk enda</p>';
        if (activeTab === 'historikkDetaljer') window.switchTab('historikk');
        return;
    }

    sortedKeys.forEach(k => {
        const m = groupedHistory[k];
        list.innerHTML += `
        <div onclick="openMonth('${k}')" class="bg-white p-6 rounded-[2rem] flex justify-between items-center border border-slate-200 mb-3 shadow-sm cursor-pointer active:scale-95 transition-all hover:border-indigo-200 hover:shadow-md">
            <span class="font-black text-sm uppercase text-slate-900 tracking-widest">${m.label}</span>
            <div class="flex items-center gap-3">
                <span class="font-black text-lg text-indigo-600">${m.total.toLocaleString()} kr</span>
                <div class="bg-indigo-50 p-1 rounded-full"><i data-lucide="chevron-right" class="w-4 h-4 text-indigo-400"></i></div>
            </div>
        </div>`;
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

    const summaryDiv = document.getElementById('historikkDetaljerSummary');
    summaryDiv.innerHTML = `
        <div class="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm mb-4">
            <div class="flex justify-between items-end mb-4 border-b border-slate-100 pb-4">
                <div>
                    <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Totalt forbruk</p>
                    <p class="text-3xl font-black text-slate-900 leading-none">${m.total.toLocaleString()} kr</p>
                </div>
                <span class="text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${statusClass}">${statusText}</span>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Duellen</p>
                    <p class="text-xs font-black" style="color: ${myColor}">${safeUserName}: ${sumMe.toLocaleString()} kr</p>
                    <p class="text-xs font-black mt-0.5" style="color: ${pColor}">${pName}: ${sumPartner.toLocaleString()} kr</p>
                </div>
                <div class="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Største Kategori</p>
                    <p class="text-xs font-black text-slate-900 truncate">${topCat[0]}</p>
                    <p class="text-[10px] font-bold text-slate-400 mt-0.5">${topCat[1].toLocaleString()} kr</p>
                </div>
            </div>
        </div>
    `;

    const detailList = document.getElementById('historikkDetaljerList');
    detailList.innerHTML = '';

    m.items.forEach(p => {
        const card = document.createElement('div');
        card.className = "bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm cursor-pointer active:scale-95 transition-all hover:border-indigo-200";
        card.onclick = () => window.editMode(p.id, p.store, p.desc, p.price, p.category, p.type, p.buyer, p.rating, p.createdAt);

        let bColor = getBuyerColor(p.buyer || 'Ukjent');
        const dateStr = new Date(p.createdAt).toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit' });
        const cName = p.category || 'Annet';
        const emojiStr = categoryEmojis[cName] ? categoryEmojis[cName] + " " : "";
        const ratingStr = p.rating ? `<span class="text-[7px] font-black text-amber-500 bg-amber-50 px-2 py-1 rounded-lg uppercase flex items-center gap-0.5 border border-amber-100">★ ${p.rating}</span>` : "";

        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                        <h3 class="font-black text-xs uppercase text-slate-900">${p.store || 'Butikk'}</h3>
                        <span class="text-[9px] font-black text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">${dateStr}</span>
                    </div>
                    <p class="text-[10px] text-slate-400 font-bold mt-0.5">${p.desc || ''}</p>
                </div>
                <p class="font-black text-lg text-slate-900">${(p.price || 0).toLocaleString()} kr</p>
            </div>
            <div class="flex flex-wrap gap-2 mt-3">
                <span class="text-[7px] font-black px-2 py-1 rounded-lg border ${(p.type || 'Behov') === 'Behov' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'} uppercase">${p.type || 'Behov'}</span>
                <span class="text-[7px] font-black px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 uppercase">${emojiStr}${cName}</span>
                <span class="text-[7px] font-black px-2 py-1 rounded-lg uppercase text-white shadow-sm" style="background:${bColor}">${p.buyer || 'Ukjent'}</span>
                ${ratingStr}
            </div>
        `;
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
    chart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(catSums), datasets: [{ data: Object.values(catSums), backgroundColor: profileColors, borderWidth: 0 }] }, options: { cutout: '75%', maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter', weight: 'bold', size: 10 } } } } } });
}

// --- APP ACTIONS ---
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
    const s = document.getElementById('store').value;
    const d = document.getElementById('desc').value;
    const p = parseFloat(document.getElementById('price').value);
    const rate = document.querySelector('input[name="rating"]:checked')?.value || 0;

    if (!s || isNaN(p) || !dInput) return alert("Fyll inn minst Butikk, Pris og Dato!");

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
        window.closeAddForm();
    } catch (err) {
        alert("Kunne ikke lagre: " + err.message);
    }
};

window.deleteCurrentEdit = async () => {
    if (confirm("Er du sikker på at du vil slette dette kjøpet?")) {
        try {
            await deleteDoc(doc(db, "households", currentHid, "purchases", document.getElementById('editId').value));
            window.closeAddForm();
        } catch (e) { alert("Feil ved sletting: " + e.message); }
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
    document.getElementById('btnBehov').className = t === 'Behov' ? "flex-1 py-3 rounded-xl text-[10px] font-black bg-white shadow-sm uppercase text-slate-900 border border-slate-200" : "flex-1 py-3 rounded-xl text-[10px] font-black text-slate-400 uppercase border border-transparent";
    document.getElementById('btnLyst').className = t === 'Lyst' ? "flex-1 py-3 rounded-xl text-[10px] font-black bg-white shadow-sm uppercase text-slate-900 border border-slate-200" : "flex-1 py-3 rounded-xl text-[10px] font-black text-slate-400 uppercase border border-transparent";
};

// --- SETTINGS & PROFILE ---
window.updateProfile = async () => {
    const newName = document.getElementById('profileNameInput').value || 'Meg';
    await updateDoc(doc(db, "users", auth.currentUser.uid), { name: newName });
    alert("Profil lagret!");
};

window.updateHouseholdSettings = async () => {
    await updateDoc(doc(db, "households", currentHid), { name: document.getElementById('householdNameInput').value || 'Husstand' });
    await setDoc(doc(db, "households", currentHid, "settings", "global"), { monthlyBudget: parseFloat(document.getElementById('budgetInput').value) || 5000 }, { merge: true });
    alert("Lagret!");
};

window.addCategoryPrompt = async () => { const n = prompt("Kategori:"); if (n) await addDoc(collection(db, "households", currentHid, "categories"), { name: n.trim() }); };
window.editCategoryPrompt = async (id, current) => { const n = prompt("Endre kategorinavn:", current); if (n && n !== current) await updateDoc(doc(db, "households", currentHid, "categories", id), { name: n.trim() }); };
window.deleteCategory = async (id) => { if (confirm("Er du sikker på at du vil slette kategorien?")) await deleteDoc(doc(db, "households", currentHid, "categories", id)); };

window.createHousehold = async () => { const hid = "H-" + Math.random().toString(36).substr(2, 6).toUpperCase(); await setDoc(doc(db, "households", hid), { name: "Min husstand", migrated: true }); await setDoc(doc(db, "users", auth.currentUser.uid), { hid: hid }, { merge: true }); location.reload(); };
window.joinHousehold = async () => { const c = document.getElementById('joinCodeInput').value.trim(); if (c) { await setDoc(doc(db, "users", auth.currentUser.uid), { hid: c }, { merge: true }); location.reload(); } };
window.copyHid = () => { navigator.clipboard.writeText(currentHid); alert("Invitasjonskode kopiert!"); };

// Initier ikoner på start
lucide.createIcons();
window.switchTab('hjem');