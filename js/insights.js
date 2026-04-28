// ============================================================
// Innsikt — adaptiv duell, daglig oversikt, kategori/butikk-barer
// ============================================================

import { state, profileColors, categoryEmojis } from './state.js';
import { escapeHtml } from './ui.js';

const MONTH_NAMES = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember'];

let insightsYear  = new Date().getFullYear();
let insightsMonth = new Date().getMonth();
let insightsPerson = null; // null = all household members

// ============================================================
// Public entry point — called from app.js and month/person nav
// ============================================================
export function refreshInsightsView(year, month) {
    if (year  !== undefined) insightsYear  = year;
    if (month !== undefined) insightsMonth = month;

    const all = state.allPurchases || [];
    const myName = state.currentUserData.name || 'Meg';

    // Filter by month
    let purchases = all.filter(p => {
        const d = new Date(p.createdAt);
        return d.getFullYear() === insightsYear && d.getMonth() === insightsMonth;
    });

    // Filter by selected person
    if (insightsPerson !== null) {
        purchases = purchases.filter(p => (p.buyer || 'Ukjent') === insightsPerson);
    }

    let total = 0, buyerSums = {}, catSums = {}, storeSums = {}, daySums = {};
    let myTotal = 0, myCount = 0, myBehov = 0, myLyst = 0, myCatSums = {};

    purchases.forEach(p => {
        const price = p.price || 0;
        total += price;
        const buyer = p.buyer || 'Ukjent';
        const cat   = p.category || 'Annet';
        const store = p.store || 'Ukjent';
        const day   = new Date(p.createdAt).getDate();
        buyerSums[buyer] = (buyerSums[buyer] || 0) + price;
        catSums[cat]     = (catSums[cat]     || 0) + price;
        storeSums[store] = (storeSums[store] || 0) + price;
        daySums[day]     = (daySums[day]     || 0) + price;

        if (buyer === myName) {
            myTotal += price;
            myCount++;
            myCatSums[cat] = (myCatSums[cat] || 0) + price;
            if ((p.type || 'Behov') === 'Lyst') myLyst++; else myBehov++;
        }
    });

    let myTopCat = null, myTopCatAmt = 0;
    for (const [c, amt] of Object.entries(myCatSums)) {
        if (amt > myTopCatAmt) { myTopCatAmt = amt; myTopCat = c; }
    }
    const totalBL = myBehov + myLyst;
    const myBehovPct = totalBL > 0 ? Math.round((myBehov / totalBL) * 100) : 0;
    const myLystPct  = 100 - myBehovPct;

    renderInsightsMonthNav(all);
    renderInsightsPersonNav();

    if (insightsPerson !== null) {
        renderDuelPersonal(insightsPerson, total, purchases.length);
        const myEl = document.getElementById('myMonthSection');
        if (myEl) myEl.innerHTML = '';
    } else {
        updateDuellen(buyerSums);
        renderMyMonthSection({ myTotal, myCount, myTopCat, myTopCatAmt, myBehovPct, myLystPct });
    }

    updateDailyInsights(total, insightsYear, insightsMonth);
    updateDailyChart(daySums, insightsYear, insightsMonth);
    updateCategoryBars(catSums);
    updateStoreBars(storeSums);
}

// ============================================================
// Month navigation
// ============================================================
function renderInsightsMonthNav(all) {
    const el = document.getElementById('insightsMonthNav');
    if (!el) return;

    const now = new Date();
    const isCurrentMonth = insightsYear === now.getFullYear() && insightsMonth === now.getMonth();

    let hasPrev = false;
    if (all.length > 0) {
        const minTs   = Math.min(...all.map(p => p.createdAt || Infinity));
        const earliest = new Date(minTs);
        hasPrev = insightsYear > earliest.getFullYear() ||
                  (insightsYear === earliest.getFullYear() && insightsMonth > earliest.getMonth());
    }

    el.innerHTML = `
        <div class="flex items-center justify-between bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
            <button onclick="window.insightsPrevMonth()" class="w-9 h-9 rounded-full flex items-center justify-center transition-colors ${hasPrev ? 'text-slate-600 active:bg-slate-100' : 'text-slate-200 pointer-events-none'}">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div class="text-center">
                <p class="text-sm font-black text-slate-900">${MONTH_NAMES[insightsMonth]} ${insightsYear}</p>
                ${isCurrentMonth ? '<p class="text-[10px] font-semibold text-indigo-500 mt-0.5">Denne måneden</p>' : ''}
            </div>
            <button onclick="window.insightsNextMonth()" class="w-9 h-9 rounded-full flex items-center justify-center transition-colors ${!isCurrentMonth ? 'text-slate-600 active:bg-slate-100' : 'text-slate-200 pointer-events-none'}">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
        </div>
    `;
}

window.insightsPrevMonth = () => {
    let m = insightsMonth - 1, y = insightsYear;
    if (m < 0) { m = 11; y--; }
    refreshInsightsView(y, m);
};

window.insightsNextMonth = () => {
    const now = new Date();
    let m = insightsMonth + 1, y = insightsYear;
    if (m > 11) { m = 0; y++; }
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return;
    refreshInsightsView(y, m);
};

// ============================================================
// Person selector
// ============================================================
function renderInsightsPersonNav() {
    const el = document.getElementById('insightsPersonNav');
    if (!el) return;

    if (state.householdMembers.length <= 1) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'flex gap-2 flex-wrap';

    // "Alle" pill
    const allBtn = document.createElement('button');
    allBtn.className = `px-3 py-1.5 rounded-full text-xs font-bold transition-all ${insightsPerson === null ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200'}`;
    allBtn.textContent = 'Alle';
    allBtn.onclick = () => { insightsPerson = null; refreshInsightsView(); };
    row.appendChild(allBtn);

    state.householdMembers.forEach(m => {
        const name   = m.name   || 'Ukjent';
        const color  = m.color  || '#4f46e5';
        const avatar = m.avatar || name.charAt(0).toUpperCase();
        const isSelected = insightsPerson === name;

        const btn = document.createElement('button');
        btn.className = `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${isSelected ? 'shadow-sm text-white' : 'bg-white text-slate-500 border border-slate-200'}`;
        if (isSelected) btn.style.backgroundColor = color;

        const dot = document.createElement('span');
        dot.className = 'w-4 h-4 rounded-full inline-flex items-center justify-center text-white font-black text-[9px] shrink-0';
        dot.style.backgroundColor = isSelected ? 'rgba(255,255,255,0.3)' : color;
        dot.textContent = avatar;

        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(name));
        btn.onclick = () => { insightsPerson = name; refreshInsightsView(); };
        row.appendChild(btn);
    });

    el.appendChild(row);
}

// ============================================================
// Personal view when a person is selected
// ============================================================
function renderDuelPersonal(personName, total, count) {
    const container = document.getElementById('duelSection');
    if (!container) return;

    const member  = state.householdMembers.find(m => m.name === personName) || {};
    const color   = member.color  || state.currentUserData.color  || '#4f46e5';
    const avatar  = member.avatar || personName.charAt(0).toUpperCase();
    const isMe    = personName === (state.currentUserData.name || 'Meg');

    container.innerHTML = `
        <div class="px-2 mb-3">
            <h3 class="section-title">${escapeHtml(isMe ? 'Din måned' : personName + 's måned')}</h3>
        </div>
        <div class="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm text-center">
            <div class="w-14 h-14 rounded-full text-white flex items-center justify-center text-2xl shadow-md border-2 border-white mx-auto mb-3" style="background:${escapeHtml(color)}">${escapeHtml(avatar)}</div>
            <p class="text-2xl font-black text-slate-900">${total.toLocaleString()} kr</p>
            <p class="text-xs font-semibold text-slate-400 mt-1">${count} kjøp denne måneden</p>
        </div>
    `;
}

// ============================================================
// Personal "Din andel" card (shown in all-household view only)
// ============================================================
function renderMyMonthSection({ myTotal, myCount, myTopCat, myTopCatAmt, myBehovPct, myLystPct }) {
    const el = document.getElementById('myMonthSection');
    if (!el) return;

    if (state.householdMembers.length <= 1 || myCount === 0) {
        el.innerHTML = '';
        return;
    }

    const me      = state.currentUserData;
    const myName  = me.name   || 'Meg';
    const myColor = me.color  || '#4f46e5';
    const myAvatar = me.avatar || myName.charAt(0).toUpperCase();

    el.innerHTML = `
        <div class="px-2 mb-3"><h3 class="section-title">Din andel</h3></div>
        <div class="bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm">
            <div class="flex items-center gap-3 mb-4">
                <div class="w-12 h-12 rounded-full text-white flex items-center justify-center text-xl font-black shadow-md border-2 border-white flex-shrink-0" style="background:${escapeHtml(myColor)}">${escapeHtml(myAvatar)}</div>
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">${escapeHtml(myName)}</p>
                    <p class="text-2xl font-black text-slate-900 leading-none">${myTotal.toLocaleString()} kr</p>
                    <p class="text-xs text-slate-400 font-semibold mt-0.5">${myCount} kjøp</p>
                </div>
                ${myTopCat ? `<div class="text-right flex-shrink-0">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Topp kategori</p>
                    <p class="text-sm font-black text-slate-900">${escapeHtml(myTopCat)}</p>
                    <p class="text-xs text-slate-400 font-semibold">${myTopCatAmt.toLocaleString()} kr</p>
                </div>` : ''}
            </div>
            <div>
                <div class="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                    <span>Behov ${myBehovPct}%</span>
                    <span>Lyst ${myLystPct}%</span>
                </div>
                <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                    <div class="h-full bg-indigo-400 rounded-full transition-all duration-700" style="width:${myBehovPct}%"></div>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Daily chart
// ============================================================
function updateDailyChart(daySums, year, month) {
    const el = document.getElementById('dailyChart');
    if (!el) return;

    const daysInMonth   = new Date(year, month + 1, 0).getDate();
    const now           = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const today         = now.getDate();

    const values = Array.from({ length: daysInMonth }, (_, i) => daySums[i + 1] || 0);
    const maxVal = Math.max(...values, 1);

    const chartH = 72;
    const barW   = 7;
    const gap    = 3;
    const totalW = daysInMonth * (barW + gap) - gap;
    const svgH   = chartH + 18;

    const bars = values.map((v, i) => {
        const day      = i + 1;
        const h        = v > 0 ? Math.max((v / maxVal) * chartH, 3) : 0;
        const x        = i * (barW + gap);
        const y        = chartH - h;
        const isToday  = isCurrentMonth && day === today;
        const isFuture = isCurrentMonth && day > today;
        const fill     = isToday ? '#6366f1' : isFuture ? '#e2e8f0' : v > 0 ? '#a5b4fc' : '#f1f5f9';
        return `<rect x="${x}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1) || 0}" rx="2" fill="${fill}"/>`;
    }).join('');

    const labels = [];
    for (let i = 0; i < daysInMonth; i++) {
        const day = i + 1;
        if (day === 1 || day % 5 === 0 || day === daysInMonth) {
            const x = i * (barW + gap) + barW / 2;
            labels.push(`<text x="${x.toFixed(1)}" y="${svgH - 2}" text-anchor="middle" font-size="6.5" fill="#94a3b8" font-family="Inter,sans-serif" font-weight="600">${day}</text>`);
        }
    }

    el.innerHTML = `<svg viewBox="0 0 ${totalW} ${svgH}" preserveAspectRatio="none" style="width:100%;height:${svgH}px">${bars}${labels.join('')}</svg>`;
}

// ============================================================
// Duell / Ranking — tilpasser seg antall medlemmer
// ============================================================
export function updateDuellen(buyerSums) {
    const container = document.getElementById('duelSection');
    if (!container) return;

    const memberCount = state.householdMembers.length;

    if (memberCount <= 1) {
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
        renderDuel2(buyerSums);
        return;
    }

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

    const rankings = state.householdMembers.map(m => ({
        name: m.name || 'Ukjent',
        avatar: m.avatar || (m.name || 'U').charAt(0).toUpperCase(),
        color: m.color || '#64748b',
        amount: buyerSums[m.name] || 0
    })).sort((a, b) => a.amount - b.amount);

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
export function updateDailyInsights(currentTotal, year, month) {
    const now            = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const daysInMonth    = new Date(year, month + 1, 0).getDate();
    const daysElapsed    = isCurrentMonth ? (now.getDate() || 1) : daysInMonth;

    const avg = currentTotal > 0 ? Math.round(currentTotal / daysElapsed) : 0;
    document.getElementById('avgPerDay').innerText = `${avg.toLocaleString()} kr`;

    if (isCurrentMonth && insightsPerson === null) {
        const diff     = state.currentBudget - currentTotal;
        const daysLeft = (daysInMonth - now.getDate()) + 1;
        if (diff > 0 && daysLeft > 0) {
            document.getElementById('leftPerDay').innerText   = `${Math.round(diff / daysLeft).toLocaleString()} kr`;
            document.getElementById('leftPerDay').className   = "text-lg font-black text-emerald-600";
        } else {
            document.getElementById('leftPerDay').innerText   = "0 kr";
            document.getElementById('leftPerDay').className   = "text-lg font-black text-rose-500";
        }
    } else {
        document.getElementById('leftPerDay').innerText = "—";
        document.getElementById('leftPerDay').className = "text-lg font-black text-slate-300";
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
