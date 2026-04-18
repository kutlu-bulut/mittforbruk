import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyD8KhKw3-sMepEOJ2zaxEcH7Wnxvi0c580",
    authDomain: "mitt-forbruk-79b13.firebaseapp.com",
    projectId: "mitt-forbruk-79b13",
    storageBucket: "mitt-forbruk-79b13.firebasestorage.app",
    messagingSenderId: "383383948424",
    appId: "1:383383948424:web:dee99653e93b55d977a33d"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
