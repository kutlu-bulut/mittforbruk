// ============================================================
// UI Utilities — XSS-beskyttelse, toast, modal
// ============================================================

export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function showToast(message, type = 'success') {
    const existing = document.getElementById('appToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

export function showModal(title, { inputValue = '', placeholder = '', confirmText = 'OK', cancelText = 'Avbryt', dangerous = false } = {}) {
    return new Promise((resolve) => {
        const existing = document.getElementById('appModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'appModal';
        overlay.className = 'modal-overlay';

        const isConfirmOnly = inputValue === null;

        overlay.innerHTML = `
            <div class="modal-card animate-pop">
                <h3 class="text-lg font-black text-slate-900 mb-4">${escapeHtml(title)}</h3>
                ${isConfirmOnly ? '' : `
                    <input type="text" id="modalInput" value="${escapeHtml(inputValue)}" placeholder="${escapeHtml(placeholder)}"
                        class="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 outline-none font-bold text-lg text-slate-900 mb-4 focus:border-indigo-400 transition-colors">
                `}
                <div class="flex gap-3">
                    <button id="modalCancel" class="flex-1 py-3 rounded-2xl font-black text-sm uppercase tracking-widest bg-slate-100 text-slate-600 active:scale-95 transition-all">${escapeHtml(cancelText)}</button>
                    <button id="modalConfirm" class="flex-1 py-3 rounded-2xl font-black text-sm uppercase tracking-widest text-white active:scale-95 transition-all ${dangerous ? 'bg-rose-500' : 'bg-indigo-600'}">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('modal-visible'));

        const input = document.getElementById('modalInput');
        if (input) {
            input.focus();
            input.select();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') close(input.value);
                if (e.key === 'Escape') close(null);
            });
        }

        function close(value) {
            overlay.classList.remove('modal-visible');
            setTimeout(() => overlay.remove(), 200);
            resolve(value);
        }

        document.getElementById('modalCancel').onclick = () => close(null);
        document.getElementById('modalConfirm').onclick = () => {
            if (isConfirmOnly) close(true);
            else close(input ? input.value : true);
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
    });
}
