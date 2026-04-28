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
    if (t !== 'add') state.activeTab = t;

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
