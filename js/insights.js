// ============================================================
// Innsikt — duellen med VS, daglig oversikt, kategori-barer
// ============================================================

import { state, profileColors, categoryEmojis } from './state.js';

export function updateDuellen(buyerSums) {
    let m1Name = state.currentUserData.name || "Meg";
    let m1Color = state.currentUserData.color || "#4f46e5";
    let m1Sum = buyerSums[m1Name] || 0;

    let p = state.householdMembers.find(m => m.name !== m1Name) || { name: 'Partner', color: '#f43f5e' };
    let m2Name = p.name || "Partner";
    let m2Color = p.color || '#f43f5e';

    let m2Sum = 0;
    Object.keys(buyerSums).forEach(name => {
        if (name !== m1Name) m2Sum += buyerSums[name];
    });

    // Avatars
    const emoji1 = state.currentUserData.avatar || m1Name.charAt(0).toUpperCase();
    const otherMember = state.householdMembers.find(m => m.name !== m1Name);
    const emoji2 = otherMember?.avatar || m2Name.charAt(0).toUpperCase();

    document.getElementById('duelAvatar1').innerText = emoji1;
    document.getElementById('duelAvatar1').style.backgroundColor = m1Color;
    document.getElementById('statKName').innerText = m1Name;

    document.getElementById('duelAvatar2').innerText = emoji2;
    document.getElementById('duelAvatar2').style.backgroundColor = m2Color;
    document.getElementById('statHName').innerText = m2Name;

    // Winner badges
    const badge1 = document.getElementById('duelWinBadge1');
    const badge2 = document.getElementById('duelWinBadge2');
    const verdict = document.getElementById('duelVerdict');

    badge1.classList.add('hidden');
    badge2.classList.add('hidden');
    verdict.classList.add('hidden');

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

        // Show winner (lowest spender wins)
        const diff = Math.abs(m1Sum - m2Sum);
        if (m1Sum < m2Sum) {
            badge1.classList.remove('hidden');
            verdict.textContent = `${m1Name} leder med ${diff.toLocaleString()} kr`;
        } else if (m2Sum < m1Sum) {
            badge2.classList.remove('hidden');
            verdict.textContent = `${m2Name} leder med ${diff.toLocaleString()} kr`;
        } else {
            verdict.textContent = "Helt likt! 🤝";
        }
        verdict.classList.remove('hidden');
    }
}

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

export function updateCategoryBars(catSums) {
    const container = document.getElementById('categoryBars');
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

        // Animate in
        requestAnimationFrame(() => {
            setTimeout(() => { fill.style.width = pct + '%'; }, i * 80);
        });
    });
}
