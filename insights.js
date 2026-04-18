// ============================================================
// Innsikt — duellen, daglig oversikt, kategori-chart
// ============================================================

import { state, profileColors } from './state.js';

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
        document.getElementById('leftPerDay').className = "text-xl font-black text-emerald-600";
    } else {
        document.getElementById('leftPerDay').innerText = "0 kr";
        document.getElementById('leftPerDay').className = "text-xl font-black text-rose-500";
    }
}

export function updateChart(catSums) {
    const ctx = document.getElementById('categoryChart');
    if (state.chart) state.chart.destroy();

    if (Object.keys(catSums).length === 0) {
        state.chart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['Ingen kjøp'], datasets: [{ data: [1], backgroundColor: ['#f8fafc'], borderWidth: 0 }] },
            options: { cutout: '80%', maintainAspectRatio: false, plugins: { tooltip: { enabled: false }, legend: { display: false } } }
        });
        return;
    }

    state.chart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: Object.keys(catSums), datasets: [{ data: Object.values(catSums), backgroundColor: profileColors, borderWidth: 0 }] },
        options: { cutout: '75%', maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter', weight: 'bold', size: 12 } } } } }
    });
}
