// ============================================================
// Navigasjon — tab-switching og FAB
// ============================================================

import { state } from './state.js';

const tabTitles = {
    'hjem': 'Hjem',
    'innsikt': 'Innsikt',
    'historikk': 'Historikk',
    'liste': 'Handleliste',
    'innstillinger': 'Innstillinger',
    'add': 'Nytt kjøp'
};

window.switchTab = (t, preventScroll = false) => {
    if (t !== 'add') {
        state.activeTab = t;
        try { sessionStorage.setItem('mittforbruk_tab', t); } catch {}
    }

    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('nav-active'));

    const targetSection = document.getElementById('section' + t.charAt(0).toUpperCase() + t.slice(1));
    if (targetSection) targetSection.classList.add('active');

    const navId = t === 'historikkDetaljer' ? 'historikk' : t;
    const navBtn = document.getElementById('nav-' + navId);
    if (navBtn) navBtn.classList.add('nav-active');

    // Only show the full header (user name + budget bar) on the Hjem tab
    const headerBudget = document.getElementById('headerUserBudget');
    if (headerBudget) headerBudget.classList.toggle('hidden', t !== 'hjem');

    // Show add-purchase button only on Hjem
    const addBar = document.getElementById('addPurchaseBar');
    if (addBar) addBar.classList.toggle('hidden', t !== 'hjem');

    if (!preventScroll) window.scrollTo(0, 0);
};

// ============================================================
// Pull-to-refresh (PWA standalone only — browser has it natively)
// ============================================================
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

if (isStandalone) {
    const THRESHOLD = 75;
    let startY = 0, active = false, triggered = false;

    const ptr    = document.getElementById('ptrIndicator');
    const ptrIcon = document.getElementById('ptrIcon');

    document.addEventListener('touchstart', e => {
        if (window.scrollY === 0) {
            startY   = e.touches[0].clientY;
            active   = true;
            triggered = false;
        }
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!active || !ptr) return;
        const dist = e.touches[0].clientY - startY;
        if (dist <= 0) return;
        const pct = Math.min(dist / THRESHOLD, 1);
        ptr.style.opacity = pct;
        ptrIcon.style.transform = `rotate(${pct * 180}deg)`;
        triggered = dist >= THRESHOLD;
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (!active || !ptr) return;
        active = false;
        if (triggered) {
            ptrIcon.style.transform = 'rotate(180deg)';
            ptr.style.opacity = '1';
            setTimeout(() => window.location.reload(), 250);
        } else {
            ptr.style.opacity = '0';
            ptrIcon.style.transform = 'rotate(0deg)';
        }
    }, { passive: true });
}
