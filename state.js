// ============================================================
// Delt app-state — importeres av moduler som trenger tilgang
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
    "Mat": "🍔",
    "Shopping": "🛍️",
    "Transport": "🚗",
    "Bolig": "🏠",
    "Annet": "📦"
};

export const profileColors = [
    "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6",
    "#06b6d4", "#f97316", "#ec4899", "#64748b", "#84cc16"
];
