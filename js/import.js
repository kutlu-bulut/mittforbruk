// ============================================================
// CSV Import — bank transaction import
// ============================================================

import { collection, doc, writeBatch, setDoc, getDoc, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';
import { showToast } from './ui.js';

// ---- Helpers ----

function parseNOKAmount(str) {
    if (!str || !str.trim()) return null;
    // Strip quotes, spaces, then replace Norwegian decimal comma
    const val = parseFloat(str.trim().replace(/"/g, '').replace(/\s/g, '').replace(',', '.'));
    return isNaN(val) ? null : val;
}

function unquote(str) {
    return (str || '').trim().replace(/^"|"$/g, '');
}

function isLikelyTransfer(desc) {
    const d = (desc || '').toLowerCase().trim();
    return d.startsWith('til :') ||
           d.startsWith('fra :') ||
           d.startsWith('til:') ||
           d.startsWith('fra:') ||
           d === 'mobil overføring' ||
           d.includes('overføring') ||
           d.startsWith('lån ') ||
           d.startsWith('uttak') ||
           d.includes('minibank') ||
           d.includes('gebyr') ||
           d.includes('renter') ||
           /^straksbet/.test(d) ||
           /^nettgiro til /i.test(d);
}

function detectSeparator(header) {
    if (header.includes('\t')) return '\t';
    if (header.includes(';')) return ';';
    return ',';
}

function parseCSV(text) {
    // Strip UTF-8 BOM if present
    text = text.replace(/^﻿/, '');
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const sep = detectSeparator(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep).map(unquote);
        if (cols.length < 4) continue;
        const dato = cols[0];
        const beskrivelse = cols[2];
        const ut = parseNOKAmount(cols[3]);
        const inn = parseNOKAmount(cols[4]);
        if (!ut && !inn) continue;
        if (!ut && inn) continue; // incoming money — not an expense
        if (!dato || !beskrivelse || !ut) continue;
        if (isLikelyTransfer(beskrivelse)) continue; // skip internal transfers entirely
        rows.push({
            date: dato,
            desc: beskrivelse,
            amount: ut,
            selected: true,
            category: autoCategory(beskrivelse),
        });
    }
    return rows;
}

function escText(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Auto-categorizer ----

const CAT_RULES = [
    { cat: 'Mat', test: d =>
        /rema|kiwi|meny|\bspar\b|coop|joker|bunnpris|extra|nærbu|eurospar|kolonial|adams matkasse|godtlevert/i.test(d) ||
        /narvesen|7.?eleven|mix\b/i.test(d)
    },
    { cat: 'Restaurant', test: d =>
        /mcdonalds|mcdonald|burger.?king|max.?burger|kfc|subway|dominos|pizz|sushi|restaurant|kro\b|café|cafe\b|bakeri|foodora|wolt|just.?eat|uber.?eats|starbucks|waynes|diner/i.test(d)
    },
    { cat: 'Transport', test: d =>
        /circle.?k|shell|esso|statoil|uno.?x|\bst1\b|\bbest\b|bensinstasjon/i.test(d) ||
        /easypark|apcoa|europark|parkeringshuset|autopay/i.test(d) ||
        /\bruter\b|atb\b|skyss|kolumbus|\bvy\b|flytoget|nsb\b|entur/i.test(d) ||
        /norwegian.?air|sas\b|wideroe|widerøe|\bflyr\b/i.test(d) ||
        /\buber\b|\bbolt\b|taxify/i.test(d)
    },
    { cat: 'Bolig', test: d =>
        /forsikring|gjensidige|tryg\b|if\b.{0,10}forsikring|jbf|codan/i.test(d) ||
        /hafslund|tibber|fortum|lyse.?energi|fjordkraft|ustekveikja/i.test(d) ||
        /fiber|altibox|telenor|telia|\bice\b|nextgentel|get\.no|viken.?fiber/i.test(d) ||
        /verisure|sector.?alarm|nokas|avarn/i.test(d) ||
        /husleie|kommunale|renovasjon|dnb.?livsforsikring/i.test(d)
    },
    { cat: 'Helse', test: d =>
        /apotek|farmasiet|boots|vitusapotek|lloyds|legesenteret|tannlege|fysioterapi|optiker|brilleland/i.test(d)
    },
    { cat: 'Shopping', test: d =>
        /\bh&m\b|h\.m\b|\bzara\b|nike|adidas|zalando|boozt|nelly\b|miinto/i.test(d) ||
        /ikea|elkjøp|power\b|komplett|mediamarkt|clas.ohlson|biltema|jula\b/i.test(d) ||
        /amazon|ebay|aliexpress|\bwish\b/i.test(d) ||
        /postnord|bring\b/i.test(d) ||
        /nille|normal\b|flying.tiger|lindex|cubus|dressmann|vero.moda|guttelus|carlings|weekday/i.test(d) ||
        /lofavør|maxbo|byggmax|jernia|k-rauta/i.test(d) ||
        /klarna/i.test(d)
    },
    { cat: 'Underholdning', test: d =>
        /spotify|netflix|hbo|disney|viaplay|tv2.?sumo|nrk.?sumo|apple.?tv/i.test(d) ||
        /google.?play|playstation|xbox|\bsteam\b|nintendo/i.test(d) ||
        /norsk.?tipping|lotteri|bingo/i.test(d) ||
        /sats\b|elixia|evo.?fitness|fresh.?fitness|treningssenter|3t\b/i.test(d) ||
        /kino|cinema|ticketmaster|billettservice/i.test(d)
    },
];

function autoCategory(desc) {
    for (const rule of CAT_RULES) {
        if (rule.test(desc)) return rule.cat;
    }
    return null;
}

// ---- Sheet entry point ----

window.openImportSheet = async () => {
    document.getElementById('importSheetOverlay')?.remove();
    const dark = document.body.classList.contains('dark-mode');

    const overlay = document.createElement('div');
    overlay.id = 'importSheetOverlay';
    overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-end';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl shadow-2xl border-t flex flex-col ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);max-height:90vh';

    renderFilePicker(sheet, dark);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};

// ---- Step 1: paste or file upload ----
// Primary method is paste (works on iOS PWA). File upload is a fallback
// because iOS PWA blocks <input type="file"> in dynamically created elements.

function renderFilePicker(sheet, dark) {
    sheet.innerHTML = `
        <div class="p-5">
            <div class="flex items-center justify-between mb-1">
                <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">Importer fra CSV</h3>
                <button id="_imp_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <p class="text-xs ${dark ? 'text-slate-400' : 'text-slate-500'} mb-3">Lim inn innholdet fra CSV-filen (DNB-format)</p>

            <textarea id="_imp_textarea" rows="6" placeholder="Lim inn CSV-innhold her..."
                class="w-full text-xs font-mono rounded-xl px-3 py-3 border resize-none outline-none focus:border-indigo-400 transition-colors ${dark ? 'bg-slate-900 border-slate-600 text-slate-200 placeholder-slate-600' : 'bg-slate-50 border-slate-200 text-slate-700 placeholder-slate-300'}"></textarea>

            <button id="_imp_paste_go" class="w-full mt-3 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white active:opacity-80">
                Fortsett
            </button>

            <div class="flex items-center gap-3 my-4">
                <div class="h-px flex-1 ${dark ? 'bg-slate-700' : 'bg-slate-200'}"></div>
                <span class="text-xs font-bold ${dark ? 'text-slate-600' : 'text-slate-400'}">eller velg fil</span>
                <div class="h-px flex-1 ${dark ? 'bg-slate-700' : 'bg-slate-200'}"></div>
            </div>

            <label class="flex items-center justify-center gap-2 py-3 rounded-xl border ${dark ? 'border-slate-600 text-slate-400' : 'border-slate-200 text-slate-400'} cursor-pointer active:opacity-70 transition-opacity text-sm font-bold">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Velg fil (.csv / .txt)
                <input type="file" accept=".csv,.txt,.tsv" class="sr-only" id="_imp_file">
            </label>
        </div>`;

    const processText = (text) => {
        const rows = parseCSV(text);
        if (!rows.length) { showToast('Ingen gyldige transaksjoner funnet', 'error'); return; }
        markDuplicates(rows);
        // Pre-uncheck likely duplicates
        rows.forEach(r => { if (r.isDuplicate) r.selected = false; });
        renderPreview(sheet, dark, rows);
    };

    sheet.querySelector('#_imp_close').onclick = () => document.getElementById('importSheetOverlay')?.remove();

    sheet.querySelector('#_imp_paste_go').onclick = () => {
        const text = sheet.querySelector('#_imp_textarea').value.trim();
        if (!text) { showToast('Lim inn CSV-innhold først', 'error'); return; }
        processText(text);
    };

    sheet.querySelector('#_imp_file').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => processText(ev.target.result);
        reader.readAsText(file, 'UTF-8');
    };
}

// ---- Step 2: preview + import ----

function renderPreview(sheet, dark, rows) {
    const categories = state.categoriesCache?.length
        ? state.categoriesCache
        : ['Mat', 'Shopping', 'Transport', 'Bolig', 'Annet'];

    let selectedCategory = categories[0];
    let selectedBuyer = state.currentUserData?.name || 'Meg';
    const buyerOptions = [...new Set(
        (state.householdMembers || []).map(m => m.name).filter(Boolean).concat([selectedBuyer])
    )];

    const fmt = n => n.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

    // Surgical updates — no scroll reset
    function updateStats() {
        const sel = rows.filter(r => r.selected);
        const total = sel.reduce((s, r) => s + r.amount, 0);
        const statsEl = sheet.querySelector('#_imp_stats');
        if (statsEl) statsEl.textContent = `${sel.length} av ${rows.length} valgt · ${fmt(total)} kr`;
        const btn = sheet.querySelector('#_imp_confirm');
        if (!btn) return;
        const hasAny = sel.length > 0;
        btn.textContent = hasAny ? `Importer ${sel.length} kjøp` : 'Velg minst ett kjøp';
        btn.className = `w-full py-3.5 rounded-2xl text-sm font-bold transition-all ${hasAny ? 'bg-indigo-600 text-white active:opacity-80' : (dark ? 'bg-slate-700 text-slate-500' : 'bg-slate-100 text-slate-300')}`;
        btn.onclick = hasAny ? () => doImport(rows, selectedCategory, selectedBuyer) : null;
    }

    function updateRow(i) {
        const r = rows[i];
        const toggleBtn = sheet.querySelector(`.imp-toggle[data-idx="${i}"]`);
        if (!toggleBtn) return;
        const row = toggleBtn.closest('[data-row]');
        if (r.selected) {
            toggleBtn.className = 'imp-toggle w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all bg-indigo-600 border-indigo-600';
            toggleBtn.innerHTML = '<svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
        } else {
            toggleBtn.className = `imp-toggle w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${dark ? 'border-slate-600' : 'border-slate-300'}`;
            toggleBtn.innerHTML = '';
        }
        if (row) {
            row.querySelector('.row-name').className = `row-name text-sm font-bold truncate ${r.selected ? (dark ? 'text-slate-100' : 'text-slate-900') : (dark ? 'text-slate-600' : 'text-slate-300')}`;
            row.querySelector('.row-amt').className  = `row-amt text-sm font-black shrink-0 ${r.selected ? (dark ? 'text-slate-200' : 'text-slate-700') : (dark ? 'text-slate-600' : 'text-slate-300')}`;
        }
    }

    // Initial full render (once only)
    sheet.innerHTML = `
        <div class="p-5 pb-2 shrink-0">
            <div class="flex items-center justify-between mb-1">
                <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">Forhåndsvisning</h3>
                <button id="_imp_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <p id="_imp_stats" class="text-xs ${dark ? 'text-slate-400' : 'text-slate-500'} mb-4"></p>

            <div class="flex gap-2 mb-3">
                <div class="flex-1">
                    <p class="text-[10px] font-bold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-400'} mb-1">Ukjent kategori</p>
                    <select id="_imp_cat" class="w-full text-sm font-bold rounded-xl px-3 py-2 border ${dark ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border-slate-200'} outline-none">
                        ${categories.map(c => `<option value="${escText(c)}" ${c === selectedCategory ? 'selected' : ''}>${escText(c)}</option>`).join('')}
                    </select>
                </div>
                <div class="flex-1">
                    <p class="text-[10px] font-bold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-400'} mb-1">Kjøper</p>
                    <select id="_imp_buyer" class="w-full text-sm font-bold rounded-xl px-3 py-2 border ${dark ? 'bg-slate-700 border-slate-600 text-slate-100' : 'bg-slate-50 border-slate-200'} outline-none">
                        ${buyerOptions.map(b => `<option value="${escText(b)}" ${b === selectedBuyer ? 'selected' : ''}>${escText(b)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="flex gap-3 mb-1">
                <button id="_imp_selall" class="text-[11px] font-bold text-indigo-500 active:opacity-70">Velg alle</button>
                <span class="${dark ? 'text-slate-600' : 'text-slate-200'}">·</span>
                <button id="_imp_deselall" class="text-[11px] font-bold ${dark ? 'text-slate-500' : 'text-slate-400'} active:opacity-70">Fjern alle</button>
            </div>
        </div>

        <div class="overflow-y-auto flex-1 px-5" id="_imp_rows">
            ${rows.map((r, i) => `
                <div data-row="${i}" class="flex items-center gap-3 py-2.5 border-b ${dark ? 'border-slate-700' : 'border-slate-100'} last:border-0">
                    <button data-idx="${i}" class="imp-toggle w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${r.selected ? 'bg-indigo-600 border-indigo-600' : (dark ? 'border-slate-600' : 'border-slate-300')}">
                        ${r.selected ? '<svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
                    </button>
                    <div class="flex-1 min-w-0">
                        <p class="row-name text-sm font-bold truncate ${r.selected ? (dark ? 'text-slate-100' : 'text-slate-900') : (dark ? 'text-slate-600' : 'text-slate-300')}">${escText(r.desc)}</p>
                        <p class="text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'} flex items-center gap-1.5 flex-wrap">
                            <span>${escText(r.date)}</span>
                            ${r.category ? `<span class="text-indigo-500 font-bold bg-indigo-50 rounded-full px-1.5 py-px">${escText(r.category)}</span>` : '<span class="text-slate-300">· ukjent</span>'}
                            ${r.isDuplicate ? '<span class="text-rose-400 font-bold bg-rose-50 rounded-full px-1.5 py-px">duplikat</span>' : ''}
                        </p>
                    </div>
                    <span class="row-amt text-sm font-black shrink-0 ${r.selected ? (dark ? 'text-slate-200' : 'text-slate-700') : (dark ? 'text-slate-600' : 'text-slate-300')}">
                        ${fmt(r.amount)} kr
                    </span>
                </div>`).join('')}
        </div>

        <div class="p-5 pt-3 shrink-0">
            <button id="_imp_confirm" class="w-full py-3.5 rounded-2xl text-sm font-bold transition-all bg-slate-100 text-slate-300"></button>
        </div>`;

    sheet.querySelector('#_imp_close').onclick = () => document.getElementById('importSheetOverlay')?.remove();
    sheet.querySelector('#_imp_cat').onchange = e => { selectedCategory = e.target.value; };
    sheet.querySelector('#_imp_buyer').onchange = e => { selectedBuyer = e.target.value; };

    sheet.querySelector('#_imp_selall').onclick = () => {
        rows.forEach((r, i) => { r.selected = true; updateRow(i); });
        updateStats();
    };
    sheet.querySelector('#_imp_deselall').onclick = () => {
        rows.forEach((r, i) => { r.selected = false; updateRow(i); });
        updateStats();
    };

    sheet.querySelectorAll('.imp-toggle').forEach(btn => {
        btn.onclick = () => {
            const i = parseInt(btn.dataset.idx);
            rows[i].selected ^= true;
            updateRow(i);
            updateStats();
        };
    });

    updateStats(); // populate initial state
}

// ---- Duplicate detection ----

function markDuplicates(rows) {
    rows.forEach(r => {
        const [y, m, d] = r.date.split('-').map(Number);
        const dayStart = new Date(y, m - 1, d).getTime();
        const dayEnd   = dayStart + 86400000;
        r.isDuplicate = (state.allPurchases || []).some(p =>
            p.price === r.amount &&
            p.createdAt >= dayStart && p.createdAt < dayEnd &&
            (p.store || '').toLowerCase() === r.desc.toLowerCase()
        );
    });
}

// ---- Write to Firestore ----

async function doImport(rows, fallbackCategory, buyer) {
    const toImport = rows.filter(r => r.selected);
    if (!toImport.length) return;
    try {
        // Create any new categories that don't exist yet
        const known = new Set(state.categoriesCache || []);
        const newCats = [...new Set(toImport.map(r => r.category).filter(Boolean).filter(c => !known.has(c)))];
        for (const name of newCats) {
            await addDoc(collection(db, "households", state.currentHid, "categories"), { name });
        }

        // Generate unique import batch ID
        const importId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const importedAt = Date.now();
        let totalAmount = 0;
        const usedCategories = new Set();

        const batch = writeBatch(db);
        toImport.forEach(r => {
            const [y, m, d] = r.date.split('-').map(Number);
            const createdAt = new Date(y, m - 1, d, 12, 0, 0).getTime();
            const category = r.category || fallbackCategory;
            totalAmount += r.amount;
            usedCategories.add(category);
            batch.set(doc(collection(db, "households", state.currentHid, "purchases")), {
                store: r.desc,
                desc: '',
                price: r.amount,
                category,
                buyer,
                type: 'Behov',
                rating: 0,
                createdAt,
                importId,
            });
        });
        await batch.commit();

        // Save import record to settings/importHistory

        const histRef = doc(db, "households", state.currentHid, "settings", "importHistory");
        const histSnap = await getDoc(histRef);
        const existing = histSnap.exists() ? (histSnap.data().imports || []) : [];
        await setDoc(histRef, {
            imports: [...existing, {
                id: importId,
                importedAt,
                count: toImport.length,
                totalAmount,
                buyer,
                categories: [...usedCategories],
            }]
        });

        document.getElementById('importSheetOverlay')?.remove();
        showToast(`${toImport.length} kjøp importert!`);
    } catch (err) {
        showToast('Feil ved import: ' + err.message, 'error');
    }
}

// ---- Import history sheet ----

window.openImportHistory = async () => {
    document.getElementById('importSheetOverlay')?.remove();
    const dark = document.body.classList.contains('dark-mode');

    const overlay = document.createElement('div');
    overlay.id = 'importSheetOverlay';
    overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-end';
    overlay.style.cssText = 'background:rgba(15,23,42,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)';

    const sheet = document.createElement('div');
    sheet.className = `w-full max-w-lg rounded-t-3xl shadow-2xl border-t flex flex-col ${dark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`;
    sheet.style.cssText = 'animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);max-height:85vh';

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    await renderHistorySheet(sheet, dark);
};

async function renderHistorySheet(sheet, dark) {
    sheet.innerHTML = `<div class="p-5 text-center text-slate-400 text-sm">Laster...</div>`;

    const histRef = doc(db, "households", state.currentHid, "settings", "importHistory");
    const histSnap = await getDoc(histRef);
    const imports = histSnap.exists() ? [...(histSnap.data().imports || [])].reverse() : [];

    function fmt(n) { return n.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
    function fmtDate(ts) {
        const d = new Date(ts);
        return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    sheet.innerHTML = `
        <div class="p-5 pb-2 shrink-0 flex items-center justify-between">
            <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">Importhistorikk</h3>
            <button id="_ih_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="overflow-y-auto flex-1 px-5 pb-5">
            ${imports.length === 0 ? `<p class="text-sm ${dark ? 'text-slate-500' : 'text-slate-400'} text-center py-10">Ingen importer ennå</p>` : imports.map(imp => `
            <div class="mb-3 p-4 rounded-2xl border ${dark ? 'bg-slate-700 border-slate-600' : 'bg-slate-50 border-slate-200'}">
                <div class="flex items-start justify-between gap-2 mb-2">
                    <div>
                        <p class="text-sm font-bold ${dark ? 'text-slate-100' : 'text-slate-900'}">${fmtDate(imp.importedAt)}</p>
                        <p class="text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}">${imp.count} kjøp · ${fmt(imp.totalAmount)} kr · ${escText(imp.buyer)}</p>
                        <div class="flex flex-wrap gap-1 mt-1.5">
                            ${(imp.categories || []).map(c => `<span class="text-[10px] font-bold bg-indigo-50 text-indigo-500 rounded-full px-2 py-px">${escText(c)}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="flex gap-2 mt-3">
                    <button data-imp="${escText(imp.id)}" class="ih-recat flex-1 py-2 rounded-xl text-xs font-bold ${dark ? 'bg-slate-600 text-slate-200' : 'bg-white text-slate-600 border border-slate-200'} active:opacity-70">
                        Endre kategori
                    </button>
                    <button data-imp="${escText(imp.id)}" data-count="${imp.count}" class="ih-del flex-1 py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-500 border border-rose-100 active:opacity-70">
                        Slett import
                    </button>
                </div>
            </div>`).join('')}
        </div>`;

    sheet.querySelector('#_ih_close').onclick = () => document.getElementById('importSheetOverlay')?.remove();

    // Old imports section — purchases with empty desc and no importId
    const oldImports = (state.allPurchases || []).filter(p => p.desc === '' && !p.importId);
    if (oldImports.length > 0) {
        const oldSection = document.createElement('div');
        oldSection.className = `mt-4 p-4 rounded-2xl border ${dark ? 'bg-slate-700 border-slate-600' : 'bg-amber-50 border-amber-200'}`;
        oldSection.innerHTML = `
            <p class="text-xs font-bold ${dark ? 'text-slate-300' : 'text-amber-800'} mb-1">Gammel import (uten logg)</p>
            <p class="text-xs ${dark ? 'text-slate-400' : 'text-amber-700'} mb-3">${oldImports.length} kjøp importert uten importlogg — sannsynligvis fra en tidligere import.</p>
            <button id="_ih_del_old" class="w-full py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-500 border border-rose-100 active:opacity-70">
                Slett alle (${oldImports.length} kjøp)
            </button>
        `;
        sheet.querySelector('.overflow-y-auto').appendChild(oldSection);

        oldSection.querySelector('#_ih_del_old').onclick = async () => {
            if (!confirm(`Slette ${oldImports.length} kjøp uten importlogg?`)) return;
            try {
                const batch = writeBatch(db);
                oldImports.forEach(p => batch.delete(doc(db, "households", state.currentHid, "purchases", p.id)));
                await batch.commit();
                showToast(`${oldImports.length} kjøp slettet`);
                await renderHistorySheet(sheet, dark);
            } catch (err) {
                showToast('Feil: ' + err.message, 'error');
            }
        };
    }

    sheet.querySelectorAll('.ih-del').forEach(btn => {
        btn.onclick = async () => {
            const importId = btn.dataset.imp;
            const count = parseInt(btn.dataset.count);
            if (!confirm(`Slette ${count} importerte kjøp?`)) return;
            try {
                const toDelete = (state.allPurchases || []).filter(p => p.importId === importId);
                const batch = writeBatch(db);
                toDelete.forEach(p => batch.delete(doc(db, "households", state.currentHid, "purchases", p.id)));
                await batch.commit();
                // Remove from history
                const snap = await getDoc(histRef);
                const updated = (snap.data()?.imports || []).filter(i => i.id !== importId);
                await setDoc(histRef, { imports: updated });
                showToast(`${toDelete.length} kjøp slettet`);
                await renderHistorySheet(sheet, dark);
            } catch (err) {
                showToast('Feil: ' + err.message, 'error');
            }
        };
    });

    sheet.querySelectorAll('.ih-recat').forEach(btn => {
        btn.onclick = () => showRecatSheet(btn.dataset.imp, dark, sheet, histRef);
    });
}

async function showRecatSheet(importId, dark, parentSheet, histRef) {
    const categories = state.categoriesCache?.length
        ? state.categoriesCache
        : ['Mat', 'Restaurant', 'Shopping', 'Transport', 'Bolig', 'Helse', 'Underholdning', 'Annet'];

    const overlay2 = document.createElement('div');
    overlay2.className = 'fixed inset-0 z-[60] flex items-center justify-center p-6';
    overlay2.style.cssText = 'background:rgba(15,23,42,0.4)';

    const card = document.createElement('div');
    card.className = `w-full max-w-xs rounded-2xl p-5 shadow-2xl ${dark ? 'bg-slate-800' : 'bg-white'}`;
    card.innerHTML = `
        <h3 class="font-bold text-sm mb-3 ${dark ? 'text-slate-100' : 'text-slate-900'}">Velg ny kategori</h3>
        <div class="space-y-2">
            ${categories.map(c => `<button data-cat="${escText(c)}" class="recat-opt w-full py-2.5 rounded-xl text-sm font-bold text-left px-4 ${dark ? 'bg-slate-700 text-slate-200' : 'bg-slate-50 text-slate-700'} active:opacity-70">${escText(c)}</button>`).join('')}
        </div>
        <button id="_rc_cancel" class="mt-3 w-full py-2.5 rounded-xl text-sm font-bold ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">Avbryt</button>`;

    overlay2.appendChild(card);
    document.body.appendChild(overlay2);
    overlay2.addEventListener('click', e => { if (e.target === overlay2) overlay2.remove(); });
    card.querySelector('#_rc_cancel').onclick = () => overlay2.remove();

    card.querySelectorAll('.recat-opt').forEach(btn => {
        btn.onclick = async () => {
            const newCat = btn.dataset.cat;
            overlay2.remove();
            try {
                const toUpdate = (state.allPurchases || []).filter(p => p.importId === importId);
                const batch = writeBatch(db);
                toUpdate.forEach(p => batch.update(doc(db, "households", state.currentHid, "purchases", p.id), { category: newCat }));
                await batch.commit();
                // Update categories list in history
                const snap = await getDoc(histRef);
                const updated = (snap.data()?.imports || []).map(i =>
                    i.id === importId ? { ...i, categories: [newCat] } : i
                );
                await setDoc(histRef, { imports: updated });
                showToast(`Kategori endret til ${newCat}!`);
                await renderHistorySheet(parentSheet, dark);
            } catch (err) {
                showToast('Feil: ' + err.message, 'error');
            }
        };
    });
}
