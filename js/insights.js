// ============================================================
// Innsikt — adaptiv duell, daglig oversikt, kategori/butikk-barer
// ============================================================

import { state, profileColors, categoryEmojis } from './state.js';
import { escapeHtml } from './ui.js';

// ============================================================
// Duell / Ranking — tilpasser seg antall medlemmer
// ============================================================
export function updateDuellen(buyerSums) {
    const container = document.getElementById('duelSection');
    if (!container) return;

    const memberCount = state.householdMembers.length;

    if (memberCount <= 1) {
        // Solo — vis personlig oversikt i stedet for duell
        const myName = state.currentUserData.name || 'Meg';
        const mySum = buyerSums[myName] || 0;
        container.innerHTML = `
            <div class="px-2 mb-3"><h3 class="section-title">Din måned</h3></div>
            <div class="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm text-center">
                <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-md border-2 border-white mx-auto mb-3" style="background: ${escapeHtml(state.currentUserData.color || '#4f46e5')}">${escapeHtml(state.currentUserData.avatar || myName.charAt(0).toUpperCase())}</div>
                <p class="text-2xl font-black text-slate-900">${mySum.toLocaleString()} kr</p>
                <p class="text-xs font-semibold text-slate-400 mt-1">brukt denne måneden</p>
            </div>
        `;
        return;
    }

    if (memberCount === 2) {
        // Classic 1v1 duell
        renderDuel2(buyerSums);
        return;
    }

    // 3+ — rangert liste
    renderDuelMulti(buyerSums);
}

function renderDuel2(buyerSums) {
    const container = document.getElementById('duelSection');
    const me = state.currentUserData;
    const myName = me.name || 'Meg';
    const other = state.householdMembers.find(m => m.name !== myName) || {};
    const otherName = other.name || 'Partner';

    const mySum = buyerSums[myName] || 0;
    const otherSum = buyerSums[otherName] || 0;
    const total = mySum + otherSum;

    const myAvatar = me.avatar || myName.charAt(0).toUpperCase();
    const otherAvatar = other.avatar || otherName.charAt(0).toUpperCase();
    const myColor = me.color || '#4f46e5';
    const otherColor = other.color || '#f43f5e';

    let myWin = '', otherWin = '', verdict = '';
    if (total > 0) {
        const diff = Math.abs(mySum - otherSum);
        if (mySum < otherSum) {
            myWin = '👑';
            verdict = `${escapeHtml(myName)} leder med ${diff.toLocaleString()} kr`;
        } else if (otherSum < mySum) {
            otherWin = '👑';
            verdict = `${escapeHtml(otherName)} leder med ${diff.toLocaleString()} kr`;
        } else {
            verdict = 'Helt likt! 🤝';
        }
    }

    let kPct = total > 0 ? Math.max(15, Math.min(85, (mySum / total) * 100)) : 50;
    const barMyBg = total > 0 ? myColor : '#f1f5f9';
    const barOtherBg = total > 0 ? otherColor : '#f1f5f9';

    container.innerHTML = `
        <div class="px-2 mb-3"><h3 class="section-title">Månedens duell</h3></div>
        <div class="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm">
            <div class="flex justify-between items-center mb-3 px-1">
                <div class="flex items-center gap-2">
                    <div class="w-10 h-10 rounded-full text-white flex items-center justify-center text-lg font-black shadow-md border-2 border-white" style="background:${escapeHtml(myColor)}">${escapeHtml(myAvatar)}</div>
                    <div>
                        <span class="font-bold text-sm text-slate-700 block leading-tight">${escapeHtml(myName)}</span>
                        <span class="text-xs">${myWin}</span>
                    </div>
                </div>
                <div class="vs-badge">VS</div>
                <div class="flex items-center gap-2">
                    <div class="text-right">
                        <span class="font-bold text-sm text-slate-700 block leading-tight">${escapeHtml(otherName)}</span>
                        <span class="text-xs">${otherWin}</span>
                    </div>
                    <div class="w-10 h-10 rounded-full text-white flex items-center justify-center text-lg font-black shadow-md border-2 border-white" style="background:${escapeHtml(otherColor)}">${escapeHtml(otherAvatar)}</div>
                </div>
            </div>
            <div class="w-full h-10 bg-slate-100 rounded-xl overflow-hidden flex shadow-inner relative border border-slate-200 p-0.5 gap-0.5">
                <div class="h-full transition-all duration-1000 flex items-center relative progress-3d rounded-l-lg" style="width:${kPct}%; background:${barMyBg}">
                    <span class="absolute left-3 text-xs text-white font-black truncate drop-shadow-md">${total > 0 ? mySum.toLocaleString() + ' kr' : ''}</span>
                </div>
                <div class="h-full transition-all duration-1000 flex items-center justify-end flex-1 relative progress-3d rounded-r-lg" style="background:${barOtherBg}">
                    <span class="absolute right-3 text-xs text-white font-black truncate drop-shadow-md">${total > 0 ? otherSum.toLocaleString() + ' kr' : ''}</span>
                </div>
            </div>
            ${verdict ? `<p class="text-center text-xs font-bold text-slate-400 mt-3">${verdict}</p>` : ''}
        </div>
    `;
}

function renderDuelMulti(buyerSums) {
    const container = document.getElementById('duelSection');

    // Bygg rangert liste over alle medlemmer
    const rankings = state.householdMembers.map(m => ({
        name: m.name || 'Ukjent',
        avatar: m.avatar || (m.name || 'U').charAt(0).toUpperCase(),
        color: m.color || '#64748b',
        amount: buyerSums[m.name] || 0
    })).sort((a, b) => a.amount - b.amount); // Lavest først = vinner

    const rows = rankings.map((r, i) => {
        const medal = i === 0 && rankings.length > 1 ? '👑 ' : '';
        return `
            <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span class="text-sm font-black text-slate-300 w-5 text-center">${i + 1}</span>
                <div class="w-9 h-9 rounded-full text-white flex items-center justify-center text-base font-black shadow-sm border-2 border-white" style="background:${escapeHtml(r.color)}">${escapeHtml(r.avatar)}</div>
                <span class="flex-1 text-sm font-bold text-slate-700">${medal}${escapeHtml(r.name)}</span>
                <span class="text-sm font-black text-slate-900">${r.amount.toLocaleString()} kr</span>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="px-2 mb-3"><h3 class="section-title">Månedens ranking</h3></div>
        <div class="bg-white p-4 rounded-[2rem] border border-slate-200 shadow-sm space-y-2">
            ${rows || '<p class="text-sm text-slate-400 text-center py-4">Ingen kjøp ennå</p>'}
        </div>
    `;
}

// ============================================================
// Daglig oversikt
// ============================================================
export function updateDailyInsights(currentTotal) {
    const now = new Date();
    const currentDay = now.getDate() || 1;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const avg = Math.round(currentTotal / currentDay);
    document.getElementById('avgPerDay').innerText = `${avg.toLocaleString()} kr`;

    const diff = state.currentBudget - currentTotal;
    const daysLeft = (daysInMonth - currentDay) + 1;

    if (diff > 0 && daysLeft > 0) {
        const leftAvg = Math.round(diff / daysLeft);
        document.getElementById('leftPerDay').innerText = `${leftAvg.toLocaleString()} kr`;
        document.getElementById('leftPerDay').className = "text-lg font-black text-emerald-600";
    } else {
        document.getElementById('leftPerDay').innerText = "0 kr";
        document.getElementById('leftPerDay').className = "text-lg font-black text-rose-500";
    }
}

// ============================================================
// Kategori-barer
// ============================================================
export function updateCategoryBars(catSums) {
    const container = document.getElementById('categoryBars');
    if (!container) return;
    container.innerHTML = '';

    const entries = Object.entries(catSums).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        container.innerHTML = '<p class="text-sm text-slate-400 font-semibold text-center py-4">Ingen data ennå</p>';
        return;
    }

    const maxVal = entries[0][1];

    entries.forEach(([name, amount], i) => {
        const emojiStr = categoryEmojis[name] ? categoryEmojis[name] + " " : "";
        const pct = maxVal > 0 ? (amount / maxVal) * 100 : 0;
        const color = profileColors[i % profileColors.length];

        const row = document.createElement('div');
        row.className = "space-y-1";

        const labelRow = document.createElement('div');
        labelRow.className = "flex justify-between items-center";

        const label = document.createElement('span');
        label.className = "text-sm font-semibold text-slate-700";
        label.textContent = emojiStr + name;

        const value = document.createElement('span');
        value.className = "text-sm font-bold text-slate-900";
        value.textContent = amount.toLocaleString() + " kr";

        labelRow.appendChild(label);
        labelRow.appendChild(value);

        const track = document.createElement('div');
        track.className = "cat-bar-track";

        const fill = document.createElement('div');
        fill.className = "cat-bar-fill";
        fill.style.backgroundColor = color;
        fill.style.width = '0%';

        track.appendChild(fill);
        row.appendChild(labelRow);
        row.appendChild(track);
        container.appendChild(row);

        requestAnimationFrame(() => {
            setTimeout(() => { fill.style.width = pct + '%'; }, i * 80);
        });
    });
}

// ============================================================
// Shared bar renderer
// ============================================================
function renderBars(container, entries, colors) {
    container.innerHTML = '';

    if (entries.length === 0) {
        container.innerHTML = '<p class="text-sm text-slate-400 font-semibold text-center py-4">Ingen data ennå</p>';
        return;
    }

    const maxVal = entries[0][1];

    entries.forEach(([name, amount], i) => {
        const pct = maxVal > 0 ? (amount / maxVal) * 100 : 0;
        const color = colors[i % colors.length];

        const row = document.createElement('div');
        row.className = "space-y-1";

        const labelRow = document.createElement('div');
        labelRow.className = "flex justify-between items-center";

        const label = document.createElement('span');
        label.className = "text-sm font-semibold text-slate-700";
        label.textContent = name;

        const value = document.createElement('span');
        value.className = "text-sm font-bold text-slate-900";
        value.textContent = amount.toLocaleString() + " kr";

        labelRow.appendChild(label);
        labelRow.appendChild(value);

        const track = document.createElement('div');
        track.className = "cat-bar-track";

        const fill = document.createElement('div');
        fill.className = "cat-bar-fill";
        fill.style.backgroundColor = color;
        fill.style.width = '0%';

        track.appendChild(fill);
        row.appendChild(labelRow);
        row.appendChild(track);
        container.appendChild(row);

        requestAnimationFrame(() => {
            setTimeout(() => { fill.style.width = pct + '%'; }, i * 80);
        });
    });
}

export function updateStoreBars(storeSums) {
    const container = document.getElementById('storeBars');
    if (!container) return;
    const storeColors = ["#f97316", "#06b6d4", "#8b5cf6", "#f43f5e", "#10b981", "#f59e0b", "#6366f1", "#ec4899"];
    const entries = Object.entries(storeSums).sort((a, b) => b[1] - a[1]);
    renderBars(container, entries, storeColors);
}

export function updateProfileStoreBars(myStoreSums) {
    const container = document.getElementById('profileStoreBars');
    if (!container) return;
    const storeColors = ["#f97316", "#06b6d4", "#8b5cf6", "#f43f5e", "#10b981", "#f59e0b", "#6366f1", "#ec4899"];
    const entries = Object.entries(myStoreSums).sort((a, b) => b[1] - a[1]).slice(0, 5);
    renderBars(container, entries, storeColors);
}
