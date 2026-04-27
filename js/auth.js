// ============================================================
// Authentication — login, logout, auth state listener
// SIKRING: Aldri overskriv eksisterende brukerdata
// ============================================================

import { doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { db, auth, provider } from './firebase.js';
import { state } from './state.js';
import { showToast } from './ui.js';
import { renderColorPicker, applyUserPreferences } from './preferences.js';

let _onReady = null;
let listenerInitialized = false;

export function initAuth(onReady) {
    _onReady = onReady;

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("Auth: user logged in", user.uid);

            // Opprett bruker-dokument KUN hvis det virkelig ikke finnes
            // Bruk getDoc (engangslesing) for å sjekke — ikke stol på onSnapshot alene
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (!userDoc.exists()) {
                    console.log("Auth: creating new user doc (verified not exists)");
                    const safeName = user.displayName ? user.displayName.split(' ')[0] : 'Bruker';
                    // Bruk merge:true selv for nye brukere — i tilfelle dokumentet
                    // ble opprettet mellom getDoc og setDoc
                    await setDoc(doc(db, "users", user.uid), {
                        name: safeName,
                        email: user.email ? user.email.toLowerCase() : '',
                        color: '#6366f1',
                        darkMode: false,
                        hid: null
                    }, { merge: true });
                }
            } catch (e) {
                console.error("Auth: error checking/creating user doc:", e);
            }

            // Start sanntidslytter (bare én gang)
            if (!listenerInitialized) {
                listenerInitialized = true;
                onSnapshot(doc(db, "users", user.uid), (d) => {
                    try {
                        if (d.exists()) {
                            state.currentUserData = d.data() || {};
                            state.currentHid = state.currentUserData.hid || null;
                            console.log("Auth: hid =", state.currentHid);

                            renderColorPicker();
                            applyUserPreferences();

                            if (state.currentHid) {
                                localStorage.setItem('mittforbruk_authed', '1');
                                if (_onReady) _onReady();
                            } else {
                                localStorage.setItem('mittforbruk_authed', '1');
                                document.getElementById('loginScreen').classList.add('hidden');
                                document.getElementById('appContent').classList.add('hidden');
                                document.getElementById('onboardingScreen').classList.remove('hidden');
                            }
                        }
                        // Hvis d.exists() er false her, gjør vi INGENTING.
                        // Vi har allerede sikret opprettelse ovenfor.
                        // Dette forhindrer at en midlertidig glitch overskriver data.
                    } catch (error) {
                        console.error("Auth data error:", error);
                    }
                }, (error) => {
                    console.error("Auth: Firestore listener error:", error);
                });
            }
        } else {
            listenerInitialized = false;
            localStorage.removeItem('mittforbruk_authed');
            document.documentElement.classList.remove('auth-cached');
            document.getElementById('loginScreen').classList.remove('hidden');
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
