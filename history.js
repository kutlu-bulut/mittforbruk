// ============================================================
// Historikk — månedsliste og detaljevisning
// ============================================================

import { state } from './state.js';
import { escapeHtml } from './ui.js';
import { renderPurchaseCard } from './cards.js';

export function updateHistory(purchases) {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    state.groupedHistory = {};

    purchases.forEach(p => {
        const d = new Date(p.createdAt);
        const sortKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0');
        const displayName = d.toLocaleString('no-NO', { month: 'long', year: 'numeric' });
        if (!state.groupedHistory[sortKey]) state.groupedHistory[sortKey] = { label: displayName, total: 0, items: [] };
        state.groupedHistory[sortKey].total += (p.price || 0);
        state.groupedHistory[sortKey].items.push(p);
    });

    const sortedKeys = Object.keys(state.groupedHistory).sort().reverse();
    if (sortedKeys.length === 0) {
        list.innerHTML = '<p class="text-center text-sm font-bold text-slate-400 uppercase mt-10">Ingen historikk enda</p>';
        if (state.activeTab === 'historikkDetaljer') window.switchTab('historikk');
        return;
    }

    sortedKeys.forEach(k => {
        const m = state.groupedHistory[k];
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

    if (state.activeTab === 'historikkDetaljer' && state.currentOpenMonthKey) {
        if (state.groupedHistory[state.currentOpenMonthKey]) {
            window.openMonth(state.currentOpenMonthKey, true);
        } else {
            window.switchTab('historikk');
        }
    }
}

window.openMonth = (key, preventScroll = false) => {
    state.currentOpenMonthKey = key;
    window.switchTab('historikkDetaljer', preventScroll);

    const m = state.groupedHistory[key];
    document.getElementById('historikkDetaljerTitle').innerText = m.label;

    let sumMe = 0, sumPartner = 0;
    const safeUserName = state.currentUserData.name || 'Meg';
    let pName = state.householdMembers.find(mem => mem.name !== safeUserName)?.name || 'Partner';
    let myColor = state.currentUserData.color || '#4f46e5';
    let pColor = state.householdMembers.find(mem => mem.name !== safeUserName)?.color || '#f43f5e';
    let catsObj = {};

    m.items.forEach(p => {
        if (p.buyer === safeUserName) sumMe += (p.price || 0);
        else sumPartner += (p.price || 0);
        catsObj[p.category || 'Annet'] = (catsObj[p.category || 'Annet'] || 0) + (p.price || 0);
    });

    const sortedCats = Object.entries(catsObj).sort((a, b) => b[1] - a[1]);
    const topCat = sortedCats.length > 0 ? sortedCats[0] : ["Ingen", 0];

    const diff = state.currentBudget - m.total;
    const statusText = diff >= 0 ? `${diff.toLocaleString()} kr under budsjett` : `${Math.abs(diff).toLocaleString()} kr over budsjett`;
    const statusClass = diff >= 0 ? 'text-emerald-500 bg-emerald-50 border-emerald-100' : 'text-rose-500 bg-rose-50 border-rose-100';

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
