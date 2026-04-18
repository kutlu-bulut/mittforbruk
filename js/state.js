// ============================================================
// Delt app-state, konstanter, avatar-emojier, achievements
// ============================================================

export const state = {
    currentHid: null,
    currentUserData: {},
    currentBudget: 5000,
    selectedType: "Behov",
    selectedBuyer: "",
    householdMembers: [],
    groupedHistory: {},
    currentOpenMonthKey: null,
    activeTab: 'hjem',
    chart: null
};

export const categoryEmojis = {
    "Mat": "🍔", "Shopping": "🛍️", "Transport": "🚗",
    "Bolig": "🏠", "Annet": "📦"
};

export const profileColors = [
    "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6",
    "#06b6d4", "#f97316", "#ec4899", "#64748b", "#84cc16"
];

export const avatarEmojis = [
    "😎", "🦊", "🐻", "🌸", "🎯", "🔥", "💎", "🎮",
    "🦁", "🐱", "🐶", "🦄", "🌈", "⚡", "🍕", "🎵",
    "🚀", "🌊", "🎨", "🧠", "👻", "🤖", "🦋", "🍀"
];

export const achievementDefs = [
    { id: 'first_purchase', icon: '🎉', name: 'Første kjøp', check: (s) => s.totalPurchases >= 1 },
    { id: 'ten_purchases', icon: '🔟', name: '10 kjøp', check: (s) => s.totalPurchases >= 10 },
    { id: 'fifty_purchases', icon: '💯', name: '50 kjøp', check: (s) => s.totalPurchases >= 50 },
    { id: 'under_budget', icon: '💰', name: 'Under budsjett', check: (s) => s.monthTotal > 0 && s.monthTotal <= s.budget },
    { id: 'behov_master', icon: '🧘', name: 'Zen-shopper', check: (s) => s.behovPct >= 80 },
    { id: 'rating_lover', icon: '⭐', name: 'Anmelder', check: (s) => s.ratedCount >= 5 },
];
