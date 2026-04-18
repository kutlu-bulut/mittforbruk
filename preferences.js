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

export function applyUserPreferences() {
    const isDark = !!state.currentUserData.darkMode;
    const safeName = state.currentUserData.name || 'Meg';
    const safeColor = state.currentUserData.color || '#4f46e5';

    document.body.classList.toggle('dark-mode', isDark);

    const dot = document.getElementById('darkModeDot');
    if (dot) dot.style.left = isDark ? '28px' : '4px';

    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.style.backgroundColor = isDark ? '#4f46e5' : '#cbd5e1';

    const nameInput = document.getElementById('profileNameInput');
    if (nameInput) nameInput.value = safeName;

    document.documentElement.style.setProperty('--user-color', safeColor);

    // Profile avatar
    const avatarDisplay = getAvatarDisplay();
    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar) profileAvatar.innerText = avatarDisplay;

    // Header avatar
    const headerAvatar = document.getElementById('headerAvatar');
    if (headerAvatar) headerAvatar.innerText = avatarDisplay;
}

window.toggleDarkMode = async () => {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { darkMode: !state.currentUserData.darkMode });
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
