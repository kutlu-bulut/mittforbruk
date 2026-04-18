// ============================================================
// Authentication — login, logout, auth state listener
// Bruker callback i stedet for direkte import av app.js (unngår sirkulær avhengighet)
// ============================================================

import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { db, auth, provider } from './firebase.js';
import { state } from './state.js';
import { showToast } from './ui.js';
import { renderColorPicker, applyUserPreferences } from './preferences.js';

let _onReady = null;

export function initAuth(onReady) {
    _onReady = onReady;

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            onSnapshot(doc(db, "users", user.uid), (d) => {
                try {
                    if (d.exists()) {
                        state.currentUserData = d.data() || {};
                        state.currentHid = state.currentUserData.hid || null;

                        renderColorPicker();
                        applyUserPreferences();

                        if (state.currentHid) {
                            if (_onReady) _onReady();
                        } else {
                            document.getElementById('loginScreen').classList.add('hidden');
                            document.getElementById('appContent').classList.add('hidden');
                            document.getElementById('onboardingScreen').classList.remove('hidden');
                        }
                    } else {
                        const safeName = user.displayName ? user.displayName.split(' ')[0] : 'Bruker';
                        setDoc(doc(db, "users", user.uid), {
                            name: safeName,
                            email: user.email ? user.email.toLowerCase() : '',
                            color: '#6366f1',
                            darkMode: false,
                            hid: null
                        });
                    }
                } catch (error) { console.error("Data error:", error); }
            });
        }
    });
}

window.login = () => {
    const btn = document.getElementById('loginBtn');
    const oldText = btn.innerText;
    btn.innerText = "Logger inn...";
    signInWithPopup(auth, provider).catch(err => {
        showToast("Kunne ikke logge inn: " + err.message, 'error');
        btn.innerText = oldText;
    });
};

window.logout = () => signOut(auth).then(() => location.reload());
