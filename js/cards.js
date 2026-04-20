// ============================================================
// Gjenbrukbar kjøpskort-renderer
// ============================================================

import { categoryEmojis } from './state.js';
import { getBuyerColor } from './preferences.js';

export function renderPurchaseCard(p, onClick) {
    const card = document.createElement('div');
    card.className = "bg-white p-5 rounded-[2rem] border border-slate-200 shadow-sm active:scale-95 cursor-pointer transition-all hover:border-indigo-200";
    if (onClick) card.onclick = onClick;

    const bColor = getBuyerColor(p.buyer || 'Ukjent');
    const dateStr = new Date(p.createdAt).toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit' });
    const cName = p.category || 'Annet';
    const emojiStr = categoryEmojis[cName] ? categoryEmojis[cName] + " " : "";

    const topRow = document.createElement('div');
    topRow.className = "flex justify-between items-start";

    const leftCol = document.createElement('div');
    leftCol.className = "flex flex-col";

    const storeName = document.createElement('h3');
    storeName.className = "font-black text-sm uppercase text-slate-900";
    storeName.textContent = p.store || 'Butikk';
    leftCol.appendChild(storeName);

    if (p.desc) {
        const descEl = document.createElement('p');
        descEl.className = "text-xs text-slate-400 font-bold mt-0.5";
        descEl.textContent = p.desc;
        leftCol.appendChild(descEl);
    }

    const rightCol = document.createElement('div');
    rightCol.className = "flex flex-col items-end gap-0.5 shrink-0 ml-3";

    const dateChip = document.createElement('span');
    dateChip.className = "text-[10px] font-black text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100";
    dateChip.textContent = dateStr;

    const priceEl = document.createElement('p');
    priceEl.className = "font-black text-lg text-slate-900";
    priceEl.textContent = (p.price || 0).toLocaleString() + " kr";

    rightCol.appendChild(dateChip);
    rightCol.appendChild(priceEl);

    topRow.appendChild(leftCol);
    topRow.appendChild(rightCol);
    card.appendChild(topRow);

    const tagsRow = document.createElement('div');
    tagsRow.className = "flex flex-wrap gap-2 mt-3";

    const typeChip = document.createElement('span');
    typeChip.className = `text-[10px] font-black px-2 py-1 rounded-lg border uppercase ${(p.type || 'Behov') === 'Behov' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`;
    typeChip.textContent = p.type || 'Behov';
    tagsRow.appendChild(typeChip);

    const catChip = document.createElement('span');
    catChip.className = "text-[10px] font-black px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 uppercase";
    catChip.textContent = emojiStr + cName;
    tagsRow.appendChild(catChip);

    const buyerChip = document.createElement('span');
    buyerChip.className = "text-[10px] font-black px-2 py-1 rounded-lg uppercase text-white shadow-sm";
    buyerChip.style.backgroundColor = bColor;
    buyerChip.textContent = p.buyer || 'Ukjent';
    tagsRow.appendChild(buyerChip);

    if (p.rating) {
        const ratingChip = document.createElement('span');
        ratingChip.className = "text-[10px] font-black text-amber-500 bg-amber-50 px-2 py-1 rounded-lg uppercase flex items-center gap-0.5 border border-amber-100";
        ratingChip.textContent = "★ " + p.rating;
        tagsRow.appendChild(ratingChip);
    }

    card.appendChild(tagsRow);
    return card;
}
