// ============================================================
// CSV Import — bank transaction import
// ============================================================

import { collection, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state } from './state.js';
import { showToast } from './ui.js';

// ---- Helpers ----

function parseNOKAmount(str) {
    if (!str || !str.trim()) return null;
    const val = parseFloat(str.trim().replace(/\s/g, '').replace(',', '.'));
    return isNaN(val) ? null : val;
}

function isLikelyTransfer(desc) {
    const d = (desc || '').toLowerCase().trim();
    return d.startsWith('til :') ||
           d.startsWith('fra :') ||
           d === 'mobil overføring' ||
           d.includes('overføring') ||
           d.startsWith('lån ');
}

function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (cols.length < 4) continue;
        const dato = (cols[0] || '').trim();
        const beskrivelse = (cols[2] || '').trim();
        const ut = parseNOKAmount(cols[3]);
        const inn = parseNOKAmount(cols[4]);
        if (!ut && !inn) continue;
        if (!ut && inn) continue; // incoming money — not an expense
        if (!dato || !beskrivelse || !ut) continue;
        rows.push({
            date: dato,
            desc: beskrivelse,
            amount: ut,
            isTransfer: isLikelyTransfer(beskrivelse),
            selected: !isLikelyTransfer(beskrivelse),
        });
    }
    return rows;
}

function escText(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ---- Step 1: file picker ----

function renderFilePicker(sheet, dark) {
    sheet.innerHTML = `
        <div class="p-5">
            <div class="flex items-center justify-between mb-1">
                <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">Importer fra CSV</h3>
                <button id="_imp_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <p class="text-xs ${dark ? 'text-slate-400' : 'text-slate-500'} mb-5">Fane-separert CSV-fil fra nettbanken (DNB-format)</p>
            <label class="flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed ${dark ? 'border-slate-600 bg-slate-900' : 'border-slate-200 bg-slate-50'} cursor-pointer active:opacity-70 transition-opacity">
                <svg class="w-10 h-10 ${dark ? 'text-slate-500' : 'text-slate-300'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span class="text-sm font-bold ${dark ? 'text-slate-400' : 'text-slate-500'}">Velg fil</span>
                <span class="text-xs ${dark ? 'text-slate-600' : 'text-slate-400'}">.csv · .txt · .tsv</span>
                <input type="file" accept=".csv,.txt,.tsv" class="sr-only" id="_imp_file">
            </label>
        </div>`;

    sheet.querySelector('#_imp_close').onclick = () => document.getElementById('importSheetOverlay')?.remove();
    sheet.querySelector('#_imp_file').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const rows = parseCSV(ev.target.result);
            if (!rows.length) { showToast('Ingen gyldige transaksjoner funnet', 'error'); return; }
            renderPreview(sheet, dark, rows);
        };
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

    function totalOf(rs) { return rs.reduce((s, r) => s + r.amount, 0); }

    function render() {
        const sel = rows.filter(r => r.selected);
        const total = totalOf(sel);

        sheet.innerHTML = `
            <div class="p-5 pb-2 shrink-0">
                <div class="flex items-center justify-between mb-1">
                    <h3 class="font-bold text-base ${dark ? 'text-slate-100' : 'text-slate-900'}">Forhåndsvisning</h3>
                    <button id="_imp_close" class="w-9 h-9 rounded-full flex items-center justify-center ${dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-400'} active:opacity-70">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <p class="text-xs ${dark ? 'text-slate-400' : 'text-slate-500'} mb-4">${sel.length} av ${rows.length} valgt &nbsp;·&nbsp; ${total.toLocaleString('nb-NO', {minimumFractionDigits:0, maximumFractionDigits:2})} kr</p>

                <div class="flex gap-2 mb-3">
                    <div class="flex-1">
                        <p class="text-[10px] font-bold uppercase tracking-wide ${dark ? 'text-slate-400' : 'text-slate-400'} mb-1">Kategori</p>
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
                    <div class="flex items-center gap-3 py-2.5 border-b ${dark ? 'border-slate-700' : 'border-slate-100'} last:border-0">
                        <button data-idx="${i}" class="imp-toggle w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${r.selected ? 'bg-indigo-600 border-indigo-600' : (dark ? 'border-slate-600' : 'border-slate-300')}">
                            ${r.selected ? '<svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
                        </button>
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-bold truncate ${r.selected ? (dark ? 'text-slate-100' : 'text-slate-900') : (dark ? 'text-slate-600' : 'text-slate-300')}">${escText(r.desc)}</p>
                            <p class="text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}">${escText(r.date)}${r.isTransfer ? ' <span class="text-amber-500 font-bold">· overføring</span>' : ''}</p>
                        </div>
                        <span class="text-sm font-black shrink-0 ${r.selected ? (dark ? 'text-slate-200' : 'text-slate-700') : (dark ? 'text-slate-600' : 'text-slate-300')}">
                            ${r.amount.toLocaleString('nb-NO', {minimumFractionDigits:0, maximumFractionDigits:2})} kr
                        </span>
                    </div>`).join('')}
            </div>

            <div class="p-5 pt-3 shrink-0">
                <button id="_imp_confirm" class="w-full py-3.5 rounded-2xl text-sm font-bold transition-all ${sel.length ? 'bg-indigo-600 text-white active:opacity-80' : `${dark ? 'bg-slate-700 text-slate-500' : 'bg-slate-100 text-slate-300'}`}">
                    ${sel.length ? `Importer ${sel.length} kjøp` : 'Velg minst ett kjøp'}
                </button>
            </div>`;

        sheet.querySelector('#_imp_close').onclick = () => document.getElementById('importSheetOverlay')?.remove();
        sheet.querySelector('#_imp_cat').onchange = e => { selectedCategory = e.target.value; };
        sheet.querySelector('#_imp_buyer').onchange = e => { selectedBuyer = e.target.value; };
        sheet.querySelector('#_imp_selall').onclick = () => { rows.forEach(r => r.selected = true); render(); };
        sheet.querySelector('#_imp_deselall').onclick = () => { rows.forEach(r => r.selected = false); render(); };
        sheet.querySelectorAll('.imp-toggle').forEach(btn => {
            btn.onclick = () => { rows[parseInt(btn.dataset.idx)].selected ^= true; render(); };
        });
        if (sel.length) {
            sheet.querySelector('#_imp_confirm').onclick = () => doImport(rows, selectedCategory, selectedBuyer);
        }
    }

    render();
}

// ---- Write to Firestore ----

async function doImport(rows, category, buyer) {
    const toImport = rows.filter(r => r.selected);
    if (!toImport.length) return;
    try {
        const batch = writeBatch(db);
        toImport.forEach(r => {
            const [y, m, d] = r.date.split('-').map(Number);
            const createdAt = new Date(y, m - 1, d, 12, 0, 0).getTime();
            batch.set(doc(collection(db, "households", state.currentHid, "purchases")), {
                store: r.desc,
                desc: '',
                price: r.amount,
                category,
                buyer,
                type: 'Behov',
                rating: 0,
                createdAt,
            });
        });
        await batch.commit();
        document.getElementById('importSheetOverlay')?.remove();
        showToast(`${toImport.length} kjøp importert!`);
    } catch (err) {
        showToast('Feil ved import: ' + err.message, 'error');
    }
}
