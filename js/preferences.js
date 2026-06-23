// ============================================================
// Brukerpreferanser — fargevelger, dark mode, profil, emoji avatar
// ============================================================

import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from './firebase.js';
import { state, profileColors, avatarEmojis } from './state.js';
import { showToast } from './ui.js';

export function getBuyerColor(buyerName) {
    const safeUserName = state.currentUserData.name || 'Meg';
    if (buyerName === safeUserName) return state.currentUserData.color || '#4f46e5';
    const member = state.householdMembers.find(m => m.name === buyerName);
    if (member) return member.color || '#f43f5e';
    const otherMember = state.householdMembers.find(m => m.name !== safeUserName);
    if (otherMember) return otherMember.color || '#f43f5e';
    return '#f43f5e';
}

export function renderColorPicker() {
    const container = document.getElementById('colorPickerGrid');
    if (!container) return;
    container.innerHTML = '';
    const safeUserColor = state.currentUserData.color || '#4f46e5';

    profileColors.forEach(color => {
        const dot = document.createElement('div');
        dot.className = `color-dot ${safeUserColor === color ? 'active' : ''}`;
        dot.style.backgroundColor = color;
        dot.onclick = () => updateDoc(doc(db, "users", auth.currentUser.uid), { color });
        container.appendChild(dot);
    });
}

function getAvatarDisplay() {
    const avatar = state.currentUserData.avatar;
    if (avatar) return avatar;
    const name = state.currentUserData.name || 'Meg';
    return name.charAt(0).toUpperCase();
}

export function renderDefaultTabSetting() {
    const container = document.getElementById('defaultTabSetting');
    if (!container) return;
    const tabs = [
        { id: 'hjem',         label: 'Hjem',         emoji: '🏠' },
        { id: 'innsikt',      label: 'Innsikt',       emoji: '📊' },
        { id: 'historikk',    label: 'Historikk',     emoji: '📋' },
        { id: 'liste',        label: 'Liste',          emoji: '🛒' },
        { id: 'innstillinger',label: 'Innstillinger', emoji: '⚙️' },
    ];
    const current = state.currentUserData.defaultTab || 'hjem';
    container.innerHTML = '';
    tabs.forEach(tab => {
        const btn = document.createElement('button');
        const active = current === tab.id;
        btn.className = [
            'flex-1 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl font-bold transition-all',
            active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-50 text-slate-500 border border-slate-200 active:bg-slate-100',
        ].join(' ');
        btn.innerHTML = `<span class="text-base">${tab.emoji}</span><span class="text-[10px]">${tab.label}</span>`;
        btn.onclick = () => window.setDefaultTab(tab.id);
        container.appendChild(btn);
    });

    renderDefaultListSetting();
}

// Vises kun når startsiden er 'liste': velg hvilken handleliste som åpnes.
// null = vis oversikten over alle lister.
window.renderDefaultListSetting = function renderDefaultListSetting() {
    const wrap = document.getElementById('defaultListSetting');
    const container = document.getElementById('defaultListSettingOptions');
    if (!wrap || !container) return;

    const tabIsListe = (state.currentUserData.defaultTab || 'hjem') === 'liste';
    wrap.classList.toggle('hidden', !tabIsListe);
    if (!tabIsListe) return;

    const lists = (window.getShoppingLists?.() || []);
    const currentListId = state.currentUserData.defaultListId || null;
    container.innerHTML = '';

    const addOption = (id, emoji, label) => {
        const btn = document.createElement('button');
        const active = (id === null && !currentListId) || id === currentListId;
        btn.className = [
            'flex items-center gap-1.5 py-2 px-3 rounded-xl font-bold text-xs transition-all',
            active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-50 text-slate-500 border border-slate-200 active:bg-slate-100',
        ].join(' ');
        const emojiEl = document.createElement('span');
        emojiEl.className = 'text-base';
        emojiEl.textContent = emoji;
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        btn.appendChild(emojiEl);
        btn.appendChild(labelEl);
        btn.onclick = () => window.setDefaultList(id);
        container.appendChild(btn);
    };

    addOption(null, '🗂️', 'Oversikt');
    lists.forEach(l => addOption(l.id, l.emoji || '🛒', l.name || 'Liste'));
};

window.setDefaultTab = async (tab) => {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { defaultTab: tab });
    showToast('Startside lagret!');
};

window.setDefaultList = async (listId) => {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { defaultListId: listId });
    showToast('Startliste lagret!');
};

export function applyUserPreferences() {
    const isDark = !!state.currentUserData.darkMode;
    const safeName = state.currentUserData.name || 'Meg';
    const safeColor = state.currentUserData.color || '#4f46e5';

    document.body.classList.toggle('dark-mode', isDark);

    const dot = document.getElementById('darkModeDot');
    if (dot) dot.style.left = isDark ? '28px' : '4px';

    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.style.backgroundColor = isDark ? 'var(--t-primary)' : '#cbd5e1';

    const nameInput = document.getElementById('profileNameInput');
    if (nameInput) nameInput.value = safeName;

    document.documentElement.style.setProperty('--user-color', safeColor);

    applyTheme(state.currentUserData.theme || '');

    // Profile avatar
    const avatarDisplay = getAvatarDisplay();
    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar) profileAvatar.innerText = avatarDisplay;

    // Header avatar
    const headerAvatar = document.getElementById('headerAvatar');
    if (headerAvatar) headerAvatar.innerText = avatarDisplay;

    renderDefaultTabSetting();
    renderThemePicker();
}

export function applyTheme(theme) {
    ['rose', 'emerald', 'amber', 'violet', 'sky'].forEach(t => document.body.classList.remove('theme-' + t));
    if (theme) document.body.classList.add('theme-' + theme);
}

export function renderThemePicker() {
    const container = document.getElementById('themePickerGrid');
    if (!container) return;

    const themes = [
        { id: '',        label: 'Indigo',  color: '#4f46e5' },
        { id: 'rose',    label: 'Rose',    color: '#f43f5e' },
        { id: 'emerald', label: 'Grønn',   color: '#10b981' },
        { id: 'amber',   label: 'Amber',   color: '#f59e0b' },
        { id: 'violet',  label: 'Violet',  color: '#7c3aed' },
        { id: 'sky',     label: 'Himmel',  color: '#0ea5e9' },
    ];

    const current = state.currentUserData.theme || '';
    container.innerHTML = '';

    themes.forEach(theme => {
        const btn = document.createElement('button');
        btn.className = 'flex flex-col items-center gap-1.5';
        btn.innerHTML = `
            <div class="theme-swatch ${current === theme.id ? 'active' : ''}" style="background:${theme.color}"></div>
            <span class="text-[10px] font-bold text-slate-400">${theme.label}</span>`;
        btn.onclick = () => window.setTheme(theme.id);
        container.appendChild(btn);
    });
}

window.toggleDarkMode = async () => {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { darkMode: !state.currentUserData.darkMode });
};

window.setTheme = async (theme) => {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { theme });
    showToast('Tema lagret!');
};

window.updateProfile = async () => {
    const newName = document.getElementById('profileNameInput').value.trim() || 'Meg';
    await updateDoc(doc(db, "users", auth.currentUser.uid), { name: newName });
    showToast("Profil lagret!");
};

window.openEmojiPicker = () => {
    const existing = document.getElementById('emojiModal');
    if (existing) existing.remove();

    const currentEmoji = state.currentUserData.avatar || '';

    const overlay = document.createElement('div');
    overlay.id = 'emojiModal';
    overlay.className = 'modal-overlay';

    const grid = avatarEmojis.map(emoji => {
        const selected = currentEmoji === emoji ? 'selected' : '';
        return `<div class="emoji-option ${selected}" data-emoji="${emoji}">${emoji}</div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="modal-card animate-pop">
            <h3 class="text-lg font-black text-slate-900 mb-4 text-center">Velg avatar</h3>
            <div class="grid grid-cols-6 gap-2 mb-4">${grid}</div>
            <button id="emojiModalClose" class="w-full py-3 rounded-2xl font-bold text-sm uppercase tracking-wider bg-slate-100 text-slate-600 active:scale-95 transition-all">Lukk</button>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('modal-visible'));

    // Handle emoji clicks
    overlay.querySelectorAll('.emoji-option').forEach(opt => {
        opt.addEventListener('click', async () => {
            const emoji = opt.dataset.emoji;
            await updateDoc(doc(db, "users", auth.currentUser.uid), { avatar: emoji });
            showToast("Avatar oppdatert!");
            closeEmojiModal();
        });
    });

    document.getElementById('emojiModalClose').onclick = closeEmojiModal;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeEmojiModal();
    });

    function closeEmojiModal() {
        overlay.classList.remove('modal-visible');
        setTimeout(() => overlay.remove(), 200);
    }
};
