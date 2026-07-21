import { FamilyData } from '../../types/types';
import type { ViewTransform } from '../../components/Tree/viewport';

export interface AppState {
    familyData: FamilyData | null;
    fullFamilyData: FamilyData | null;
    visibleNodes: Set<string>;
    highlightedNodes: Set<string>;
    selectedNodeId: string | null;
    transform: ViewTransform | null;
    isPatrilineal: boolean;
    isSidebarOpen: boolean;
    isDarkMode: boolean;
}

type Listener = (state: AppState) => void;

export class FamilyTreeStore {
    private state: AppState;
    private listeners: Set<Listener>;
    private debounceTimer: any;

    constructor() {
        this.listeners = new Set();
        this.state = {
            familyData: null,
            fullFamilyData: null,
            visibleNodes: new Set(),
            highlightedNodes: new Set(),
            selectedNodeId: null,
            transform: null,
            isPatrilineal: false,
            isSidebarOpen: false,
            isDarkMode: false,
        };

        // Load initial preferences
        this.state.isPatrilineal = localStorage.getItem('soyagaci_patrilineal_mode') === 'true';
    }

    getState(): AppState {
        return this.state;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(listener => listener(this.state));
        this.persistState();
    }

    private persistState() {
        // Debounce URL updates
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            if (this.state.familyData) {
                // We need a way to pass the "tree" object or just the data needed for URL
                // For now, let's just update localStorage for preferences
                localStorage.setItem('soyagaci_patrilineal_mode', String(this.state.isPatrilineal));
                if (this.state.selectedNodeId) {
                    localStorage.setItem('soyagaci_last_node', this.state.selectedNodeId);
                }
            }
        }, 500);
    }

    // Actions
    setData(data: FamilyData) {
        this.state.familyData = data;
        this.state.fullFamilyData = JSON.parse(JSON.stringify(data)); // Deep copy for reset
        this.notify();
    }

    setPatrilineal(isPatrilineal: boolean) {
        this.state.isPatrilineal = isPatrilineal;
        this.notify();
    }

    setSelectedNode(nodeId: string | null) {
        this.state.selectedNodeId = nodeId;
        this.notify();
    }

    setSidebarOpen(isOpen: boolean) {
        this.state.isSidebarOpen = isOpen;
        this.notify();
    }

    setVisibleNodes(nodes: Set<string>) {
        this.state.visibleNodes = nodes;
        this.notify();
    }

    setTransform(transform: ViewTransform | null) {
        this.state.transform = transform;
        // Don't notify for transform to avoid performance issues, or throttle it
    }
}

export const store = new FamilyTreeStore();
