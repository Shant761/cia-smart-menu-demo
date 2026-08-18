import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCE3QRts6mWqkDFySX8F4Bim7dIb7IaLq0',
  authDomain: 'cia-smart-menu.firebaseapp.com',
  projectId: 'cia-smart-menu',
  storageBucket: 'cia-smart-menu.firebasestorage.app',
  messagingSenderId: '62965932851',
  appId: '1:62965932851:web:56a31d76521be03fda9446'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.ciaFirebase = {
  app,
  db,
  projectId: firebaseConfig.projectId,
  ready: true
};

window.dispatchEvent(new CustomEvent('cia:firebase-ready'));
