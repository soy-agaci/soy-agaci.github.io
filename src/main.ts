import * as d3 from 'd3';
import './styles.css';
import { familyGraphToFamilyData, proposalFrame, selectedFamilySlugs } from './services/data/familyGraphAdapter';
import { uniqueSearchEntries } from './services/data/searchIndex';
import {
    getFamilyGraphBySlugs,
    listPublicFamilies,
    type FamilyGraph,
    type PublicFamily,
} from './services/data/familyRepository';
import { LatestOnly } from './services/data/latestOnly';
import { Familienbaum } from './components/Tree/Familienbaum';
import { closeEditorSidebar, initEditor } from './ui/editor/index';
import { initDarkMode } from './utils/darkMode';
import { FamilyData } from './types/types';
import { filterPatrilineal } from './utils/patrilinealFilter';
import { buildIdMaps, decodeState, updateDataQuery, updateURL, shareCurrentState } from './services/state/urlState';
import { store } from './services/state/store';
import { get_name, is_member } from './components/Tree/dagWithFamilyData';
import { initAdminReview } from './ui/admin';

// Initialize Dark Mode
initDarkMode();

function normalizeString(str: string): string {
    return str.toLowerCase()
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/â/g, 'a')
        .replace(/î/g, 'i')
        .replace(/û/g, 'u')
        .replace(/[^a-z0-9]/g, '');
}

function displayFamily(family: PublicFamily): PublicFamily {
    return family.slug === 'selcuk' ? { ...family, name: 'Selçuk' } : family;
}

function selectableFamilies(families: PublicFamily[]): PublicFamily[] {
    return families.filter(family => !family.slug.startsWith('demo-')).map(displayFamily);
}

function triggerCirkinMode(familienbaum: Familienbaum) {
    const targetGrandchildren = ["gulru", "gokcen", "ayse", "gulnihal", "feyza"];
    let foundNodes: string[] = [];

    // Reset all ugly flags first
    for (let node of familienbaum.dag_all.nodes()) {
        if (node.added_data.is_ugly) node.added_data.is_ugly = false;
    }
    
    // 1. Find the top "Davut" (Gen 5)
    // We expect: Davut -> Resit -> Davut -> Children -> Grandchildren (Targets)
    
    const potentialDavuts = familienbaum.dag_all.nodes().filter(n => is_member(n) && normalizeString(get_name(n)).includes("davut"));
    
    for (let davut of potentialDavuts) {
        // Find child "Resit" (Gen 6)
        const childrenUnions = davut.children ? davut.children() : [];
        for (let u1 of childrenUnions) {
            const children1 = u1.children ? u1.children() : [];
            for (let child1 of children1) {
                if (normalizeString(get_name(child1)).includes("resit")) {
                    // Found Resit. Now find HIS child "Davut" (Gen 7)
                    const resit = child1;
                    const childrenUnions2 = resit.children ? resit.children() : [];
                    for (let u2 of childrenUnions2) {
                        const children2 = u2.children ? u2.children() : [];
                        for (let child2 of children2) {
                             if (normalizeString(get_name(child2)).includes("davut")) {
                                 // Found Davut (Gen 7). Now traverse down to his grandchildren (Gen 9)
                                 const davut2 = child2;
                                 
                                 // Gen 8 (Children of Davut 2)
                                 const childrenUnions3 = davut2.children ? davut2.children() : [];
                                 for (let u3 of childrenUnions3) {
                                     const children3 = u3.children ? u3.children() : [];
                                     for (let gen8 of children3) {
                                         // Gen 9 (Grandchildren of Davut 2)
                                         const childrenUnions4 = gen8.children ? gen8.children() : [];
                                         for (let u4 of childrenUnions4) {
                                             const children4 = u4.children ? u4.children() : [];
                                             for (let gen9 of children4) {
                                                 const gName = normalizeString(get_name(gen9));
                                                 // Check against target list
                                                 if (targetGrandchildren.some(t => gName.includes(t))) {
                                                     foundNodes.push(gen9.data);
                                                     gen9.added_data.is_ugly = true;
                                                 }
                                             }
                                         }
                                     }
                                 }
                             }
                        }
                    }
                }
            }
        }
    }
    
    if (foundNodes.length === 0) {
        console.warn("Cirkin mode: No matching lineage (Davut -> Resit -> Davut -> ... -> Targets) found.");
        return;
    }

    // 1. Hide everything
    for (let n of familienbaum.dag_all.nodes()) {
        n.added_data.is_visible = false;
    }
    
    // 2. Show targets and their full ancestors
    for (let id of foundNodes) {
        const node = familienbaum.dag_all.find_node(id);
        if (!node) continue;
        
        node.added_data.is_visible = true;
        
        // Walk up parents
        let parents = Array.from(familienbaum.dag_all.parents(node));
        while (parents.length > 0) {
            let p = parents.pop()!;
            p.added_data.is_visible = true;
            parents = parents.concat(familienbaum.dag_all.parents(p));
        }
    }

    // 3. Draw first to compute layout positions without recentering
    familienbaum.draw(false);

    // 4. Calculate bounding box of targets to center the view
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    // Note: In renderer, SVG X = node.y, SVG Y = node.x
    // We must search in the filtered DAG (familienbaum.dag) which has the computed coordinates
    let foundCount = 0;
    if (familienbaum.dag) {
        for (let id of foundNodes) {
            try {
                const node = familienbaum.dag.find_node(id);
                if (node) {
                    const x = node.y; // SVG x
                    const y = node.x; // SVG y
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    foundCount++;
                }
            } catch(e) { /* Node might not be in filtered DAG if something went wrong, ignore */ }
        }
    }
    
    if (foundCount === 0) return;

    // Viewport dimensions
    const width = parseFloat(familienbaum.svg.attr("width"));
    const height = parseFloat(familienbaum.svg.attr("height"));
    
    // Calculate center of bounding box
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    
    // Fit to bounds with padding
    const padding = 150;
    const boxWidth = maxX - minX + padding * 2;
    const boxHeight = maxY - minY + padding * 2;
    
    let scale = 1;
    // Only scale down if they don't fit, or if we want to ensure they are well-framed
    // Let's try to fit them in 90% of screen if they are spread out
    if (boxWidth > 0 && boxHeight > 0) {
        scale = Math.min(width / boxWidth, height / boxHeight);
    }
    
    // Clamp scale to reasonable limits
    scale = Math.min(scale, 1.2); // Allow slight zoom in
    scale = Math.max(scale, 0.3); // Don't zoom out too much

    // Calculate translate to center the bounding box
    const tx = width / 2 - cx * scale;
    const ty = height / 2 - cy * scale;

    // Apply transform with transition
    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    
    familienbaum.svg.transition()
        .duration(1000)
        .call(familienbaum.zoom.transform, transform);
}

function setupGlobalSearch(familienbaum: Familienbaum) {
    const input = document.getElementById('global-search-input') as HTMLInputElement;
    const dropdownEl = document.getElementById('search-dropdown');

    if (!input || !dropdownEl) return;
    const dropdown = dropdownEl as HTMLElement;

    const nodes = familienbaum.dag_all.nodes().filter(n => is_member(n));
    const searchEntries = uniqueSearchEntries(nodes.map(n => {
        const name = get_name(n);
        const bdate = (n.added_data.input as any).birth_date;
        let extra = "";
        if (bdate) extra += ` (d. ${bdate})`;

        try {
            const unions = familienbaum.dag_all.parents(n);
            if (unions.length > 0) {
                const parents = familienbaum.dag_all.parents(unions[0]);
                const father = parents.find(p => (p.added_data.input as any)?.gender === 'E');
                const parentName = father ? get_name(father) : (parents.length > 0 ? get_name(parents[0]) : "");
                if (parentName) extra += ` - Baba: ${parentName}`;
            }
        } catch(e) {}

        return { display: `${name}${extra}`, id: n.data };
    }), normalizeString);

    let selectedIndex = -1;

    function showDropdown(matches: typeof searchEntries) {
        dropdown.innerHTML = '';
        if (matches.length === 0) {
            dropdown.style.display = 'none';
            return;
        }

        matches.slice(0, 20).forEach((entry, idx) => {
            const div = document.createElement('div');
            div.textContent = entry.display;
            div.dataset.nodeId = entry.id;
            div.setAttribute('role', 'option');
            div.style.cssText = 'padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee;';
            div.onmouseenter = () => {
                selectedIndex = idx;
                highlightSelected();
            };
            div.onclick = () => selectEntry(entry);
            dropdown.appendChild(div);
        });

        dropdown.style.display = 'block';
        selectedIndex = -1;
    }

    function highlightSelected() {
        const items = dropdown.children;
        for (let i = 0; i < items.length; i++) {
            (items[i] as HTMLElement).style.background = i === selectedIndex ? '#e0e0e0' : 'transparent';
        }
    }

    function selectEntry(entry: typeof searchEntries[0]) {
        // Clear ugly mode
        for (let node of familienbaum.dag_all.nodes()) {
            if (node.added_data.is_ugly) node.added_data.is_ugly = false;
        }

        familienbaum.connectToVisible(entry.id);
        input.value = '';
        dropdown.style.display = 'none';
        input.blur();
    }

    input.oninput = () => {
        const val = input.value.trim();
        const normalizedVal = normalizeString(val);

        if (normalizedVal === 'cirkin') {
            triggerCirkinMode(familienbaum);
            input.value = '';
            dropdown.style.display = 'none';
            input.blur();
            return;
        }

        if (val.length < 2) {
            dropdown.style.display = 'none';
            return;
        }

        // Filter by normalized partial match
        const matches = searchEntries.filter(e => e.normalized.includes(normalizedVal));
        matches.sort((a, b) => {
            const aName = a.display.split(/ \(|- Baba:/)[0].trim();
            const bName = b.display.split(/ \(|- Baba:/)[0].trim();
            const aNameMatches = normalizeString(aName).includes(normalizedVal);
            const bNameMatches = normalizeString(bName).includes(normalizedVal);
            if (aNameMatches && !bNameMatches) return -1;
            if (!aNameMatches && bNameMatches) return 1;
            return 0;
        });
        showDropdown(matches);
    };

    input.onkeydown = (e) => {
        const items = dropdown.children;
        if (dropdown.style.display === 'none' || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            highlightSelected();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            highlightSelected();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0) {
                const normalizedVal = normalizeString(input.value.trim());
                const matches = searchEntries.filter(e => e.normalized.includes(normalizedVal));
                if (matches[selectedIndex]) {
                    selectEntry(matches[selectedIndex]);
                }
            }
        } else if (e.key === 'Escape') {
            dropdown.style.display = 'none';
        }
    };

    input.onblur = () => {
        // Delay to allow click on dropdown
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
    };

    input.onfocus = () => {
        if (input.value.trim().length >= 2) {
            input.oninput?.(new Event('input'));
        }
    };
}

// Main initialization
async function init() {
    const treeContainer = document.getElementById('tree-container')!;
    const showLoadState = (message: string, error = false) => {
        const status = document.createElement('div');
        status.setAttribute('role', error ? 'alert' : 'status');
        status.textContent = message;
        status.style.cssText = 'display:grid;place-items:center;height:100%;padding:2rem;text-align:center;font:500 1rem Inter,sans-serif;color:#475569';
        treeContainer.replaceChildren(status);
    };
    showLoadState('Loading family tree...');

    // Check if we're doing a reset (skip localStorage)
    const urlParams = new URLSearchParams(window.location.search);
    const isReset = urlParams.has('reset') || sessionStorage.getItem('soyagaci_reset_requested') === '1';

    if (isReset) {
        sessionStorage.removeItem('soyagaci_reset_requested');
        console.log('Reset mode: clearing localStorage and fetching fresh data');
        for (const key of ['soyagaci_last_node', 'soyagaci_visible_nodes', 'soyagaci_view_transform', 'soyagaci_patrilineal_mode']) {
            localStorage.removeItem(key);
        }
        urlParams.delete('reset');
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('reset');
        history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }

    let inputData: FamilyData;
    let graph: FamilyGraph;
    let publicFamilies: PublicFamily[] = [];
    let familySlugs = selectedFamilySlugs(window.location.search, import.meta.env.VITE_FAMILY_SLUGS);
    let includePending = urlParams.get('view') === 'pending';
    let proposalId = includePending ? urlParams.get('proposal') ?? undefined : undefined;
    const latestLoad = new LatestOnly();
    try {
        publicFamilies = await listPublicFamilies();
        const families = selectableFamilies(publicFamilies);
        familySlugs = familySlugs.filter(slug => families.some(family => family.slug === slug));
        if (!familySlugs.length && families.length) familySlugs = [families[0].slug];
        graph = await getFamilyGraphBySlugs(familySlugs, includePending);
        if (proposalId && !graph.submissions.some(submission => submission.id === proposalId)) proposalId = undefined;
        inputData = familyGraphToFamilyData(graph, proposalId);
        if (!Object.keys(inputData.members).length) throw new Error('The selected families contain no visible people.');
        updateDataQuery(familySlugs, includePending, proposalId);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown data loading error.';
        console.error('Failed to load family tree:', error);
        showLoadState(`Could not load family tree: ${message}`, true);
        return;
    }

    // Initialize Store
    store.setData(inputData);
    buildIdMaps(inputData); // Build maps on full data

    // State restoration
    let urlState = decodeState();
    let patrilinealMode = store.getState().isPatrilineal; // Loaded from localStorage in Store constructor
    let lastNodeId: string | null = null;
    let savedVisibleNodes: Set<string> | null = null;
    let savedTransform: any = null;

    if (urlState) {
        console.log('Loading state from URL');
        patrilinealMode = urlState.patrilineal;
        store.setPatrilineal(patrilinealMode);
        lastNodeId = urlState.currentNode;
        savedVisibleNodes = urlState.visibleNodes;
        savedTransform = urlState.transform;
    } else if (!isReset) {
        console.log('Loading state from localStorage');
        // patrilinealMode already set in store constructor from localStorage
        lastNodeId = localStorage.getItem('soyagaci_last_node');

        const savedVisibleNodesJson = localStorage.getItem('soyagaci_visible_nodes');
        if (savedVisibleNodesJson) {
            try {
                savedVisibleNodes = new Set(JSON.parse(savedVisibleNodesJson));
            } catch (e) { console.warn("Failed to restore visible nodes", e); }
        }

        const savedTransformJson = localStorage.getItem('soyagaci_view_transform');
        if (savedTransformJson) {
            try {
                savedTransform = JSON.parse(savedTransformJson);
            } catch (e) { console.warn("Failed to restore transform", e); }
        }
    } else {
        store.setPatrilineal(false);
        store.setVisibleNodes(new Set());
        store.getState().selectedNodeId = null;
        store.getState().transform = null;
    }



    // Sync loaded state to Store
    if (savedVisibleNodes) store.setVisibleNodes(savedVisibleNodes);

    // Validate visibility restoration before applying transform
    // We can't check dag_all here easily as it's not created yet.
    // But we can trust savedVisibleNodes size if we assume they will map correctly.
    // However, if mapping failed, savedVisibleNodes might be empty or contain wrong IDs.

    // Better approach: We apply the transform in renderTreeInternal, where we have the DAG.
    // So here we just set it to store.
    if (savedTransform) store.setTransform(savedTransform);

    // Set start node
    if (lastNodeId && inputData.members[lastNodeId]) {
        inputData.start = lastNodeId;
    }

    // UI Elements
    const globalToggle = document.getElementById('patrilineal-global-toggle');
    treeContainer.replaceChildren();
    const svg = d3.select("#tree-container").append("svg").attr("id", "tree-svg");

    // Dimensions
    const updateDimensions = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        svg.attr("width", width).attr("height", height);
    };
    window.addEventListener("resize", updateDimensions);
    updateDimensions();

    let familienbaum: Familienbaum;

    const proposalPanel = document.getElementById('proposal-panel')!;
    const proposalList = document.getElementById('proposal-list')!;
    const proposalStatus = document.getElementById('proposal-status')!;
    const revisionToggle = document.getElementById('revision-toggle') as HTMLButtonElement;

    const renderProposalPanel = () => {
        proposalPanel.hidden = !includePending || graph.submissions.length === 0;
        proposalList.replaceChildren();
        for (const submission of graph.submissions) {
            const familyProposal = graph.family_creation_proposals.find(item => item.submission_id === submission.id);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'proposal-item';
            button.setAttribute('aria-pressed', String(submission.id === proposalId));
            button.textContent = familyProposal
                ? `${familyProposal.name} (${familyProposal.slug})`
                : submission.status === 'pending' ? 'Beklemede' : submission.status === 'approved' ? 'Onaylandı' : 'Reddedildi';
            if (familyProposal) {
                const context = document.createElement('small');
                context.textContent = `${familyProposal.source_family_name} · Kök: ${familyProposal.root_display_name}`;
                button.append(context);
            }
            const date = document.createElement('small');
            date.textContent = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
                .format(new Date(submission.created_at));
            button.append(date);
            button.onclick = () => {
                proposalId = submission.id === proposalId ? undefined : submission.id;
                updateDataQuery(familySlugs, includePending, proposalId, 'push');
                applyGraph(true);
            };
            proposalList.append(button);
        }
        proposalStatus.textContent = proposalId ? 'Seçili değişiklik ağa uygulanıyor.' : 'Onaylı ağa uygulanacak bir değişiklik seçin.';
        revisionToggle.setAttribute('aria-pressed', String(includePending));
    };

    const applyGraph = (frameProposal = false) => {
        const nextData = familyGraphToFamilyData(graph, proposalId);
        const frame = frameProposal && proposalId ? proposalFrame(graph, nextData, proposalId) : undefined;
        const selectedId = frame?.focusId ?? store.getState().selectedNodeId;
        if (selectedId && nextData.members[selectedId]) nextData.start = selectedId;
        if (frame) {
            savedVisibleNodes = frame.visibleNodes;
            savedTransform = null;
        }
        store.setData(nextData);
        if (frame) store.setSelectedNode(frame.focusId);
        buildIdMaps(nextData);
        renderTree();
        renderProposalPanel();
    };

    const reloadData = async (frameProposal = false, normalizeUrl = true) => {
        proposalStatus.textContent = 'Yükleniyor…';
        try {
            await latestLoad.run(
                () => getFamilyGraphBySlugs(familySlugs, includePending),
                next => {
                    graph = next;
                    if (proposalId && !graph.submissions.some(submission => submission.id === proposalId)) proposalId = undefined;
                    if (normalizeUrl) updateDataQuery(familySlugs, includePending, proposalId);
                    applyGraph(frameProposal);
                },
            );
        } catch (error) {
            proposalPanel.hidden = false;
            proposalStatus.textContent = error instanceof Error ? error.message : 'Aile verisi yüklenemedi.';
        }
    };

    const familyOptions = document.getElementById('family-options') as HTMLFieldSetElement;
    const familyPickerLabel = document.getElementById('family-picker-label')!;
    const updateFamilyLabel = () => {
        const selectedNames = selectableFamilies(publicFamilies)
            .filter(family => familySlugs.includes(family.slug))
            .map(family => family.name);
        familyPickerLabel.textContent = selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length} aile`;
    };
    const renderFamilyOptions = () => {
        familyOptions.replaceChildren();
        const families = selectableFamilies(publicFamilies);
        familySlugs = familySlugs.filter(slug => families.some(family => family.slug === slug));
        if (!familySlugs.length && families.length) familySlugs = [families[0].slug];
        const legend = document.createElement('legend');
        legend.textContent = 'Aileler';
        familyOptions.append(legend);
        for (const family of families) {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = family.slug;
            input.checked = familySlugs.includes(family.slug);
            input.onchange = () => {
                const selected = Array.from(familyOptions.querySelectorAll<HTMLInputElement>('input:checked'))
                    .map(item => item.value);
                if (!selected.length) {
                    input.checked = true;
                    return;
                }
                familySlugs = selected;
                proposalId = undefined;
                updateFamilyLabel();
                updateDataQuery(familySlugs, includePending, undefined, 'push');
                void reloadData(false, false);
            };
            label.append(input, document.createTextNode(family.name));
            familyOptions.append(label);
        }
        updateFamilyLabel();
    };
    renderFamilyOptions();
    initAdminReview(async () => {
        publicFamilies = await listPublicFamilies();
        renderFamilyOptions();
        await reloadData(false, false);
    });

    revisionToggle.onclick = () => {
        includePending = !includePending;
        proposalId = undefined;
        updateDataQuery(familySlugs, includePending, undefined, 'push');
        void reloadData(false, false);
    };

    // State for preserving Full Tree visibility
    let fullTreeVisibleNodes: Set<string> | null = null;

    // Render Function
    function renderTree() {


        const currentFullData = store.getState().fullFamilyData!;
        let displayData = currentFullData;

        if (store.getState().isPatrilineal) {
            displayData = filterPatrilineal(currentFullData);
        }
        globalToggle?.setAttribute('aria-pressed', String(store.getState().isPatrilineal));

        renderTreeInternal(displayData);
    }

    function renderTreeInternal(displayData: FamilyData) {
        // If familienbaum already exists, just update data
        if (familienbaum) {
            familienbaum.setPaternalAncestorsOnly(familySlugs.length > 1);
            // If we have saved state (from toggle), restore it
            if (savedVisibleNodes && savedVisibleNodes.size > 0) {
                familienbaum.updateData(displayData, savedVisibleNodes);
                savedVisibleNodes = null; // Clear
            } else {
                familienbaum.updateData(displayData);
            }

            setupGlobalSearch(familienbaum); // Update search list with new data

            if (savedTransform) {
                try {
                    const transform = d3.zoomIdentity.translate(savedTransform.x, savedTransform.y).scale(savedTransform.k);
                    familienbaum.svg.call(familienbaum.zoom.transform, transform);
                } catch (e) { console.warn("Failed to restore transform", e); }
                savedTransform = null;
            }
            return;
        }

        // Otherwise create new instance (first load)
        const svg = d3.select("#tree-svg");
        svg.selectAll("*").remove(); // Clear previous if any (though usually empty on first load)

        familienbaum = new Familienbaum(displayData, svg as any, undefined, familySlugs.length > 1);
        setupGlobalSearch(familienbaum); // Initialize search list

        const onViewChange = () => {
            // On view change (zoom/pan/expand)

            // 1. Update store with current visibility and transform
            if (familienbaum && familienbaum.dag_all) {
                const visible = new Set<string>();
                for (let node of familienbaum.dag_all.nodes()) {
                    if (node.added_data.is_visible) visible.add(node.data);
                }
                store.setVisibleNodes(visible);
            }

            if (familienbaum && familienbaum.g) {
                const t = d3.zoomTransform(familienbaum.g.node()!);
                store.setTransform({ k: t.k, x: t.x, y: t.y });
            }

            // 2. Update URL state using the updated store
            const state = store.getState();
            updateURL(state);
        };

        // Initialize Editor (Sidebar, etc.)
        initEditor(familienbaum, {
            getGraph: () => graph,
            getFamilies: () => selectableFamilies(publicFamilies).filter(family => familySlugs.includes(family.slug)),
            onSubmitted: async result => {
                includePending = true;
                proposalId = result.submission_id;
                updateDataQuery(familySlugs, true, proposalId, 'push');
                await reloadData(true, false);
            },
        });

        // Restore state if available FROM URL (explicit user action)
        // Don't restore from localStorage here - that's already handled at init time
        // and we don't want to override the default view unless there's explicit URL state
        const state = store.getState();

        // Only restore visibility if we have URL state (savedVisibleNodes was set from URL)
        // or if we have a significantly large saved state (indicating user had expanded the tree)
        const hasExplicitState = savedVisibleNodes && (Boolean(urlState) || savedVisibleNodes.size > 3); // More than just root + couple nodes or from shared URL

        if (hasExplicitState && familienbaum.dag_all) {
            // Validate that saved nodes actually exist in current DAG
            let validNodeCount = 0;
            const allNodeIds = new Set<string>();
            for (let node of familienbaum.dag_all.nodes()) {
                allNodeIds.add(node.data);
                if (savedVisibleNodes!.has(node.data)) {
                    validNodeCount++;
                }
            }

            // Only restore if we have at least some matching nodes
            // We used to require 50%, but this causes full reset when switching to Patrilineal mode
            // (where many nodes are filtered out). Now we accept any match > 0.
            if (validNodeCount > 0) {
                console.log(`Restoring visibility: ${validNodeCount}/${savedVisibleNodes!.size} nodes exist in current DAG`);

                // Restore visibility from explicit state
                for (let node of familienbaum.dag_all.nodes()) {
                    if (savedVisibleNodes!.has(node.data)) {
                        node.added_data.is_visible = true;
                    } else {
                        node.added_data.is_visible = false;
                    }
                }

                // Ensure root is always visible
                const root = familienbaum.dag_all.find_node(displayData.start);
                if (root) {
                    root.added_data.is_visible = true;
                }

                // CRITICAL FIX: Ensure connectivity after restoring visibility
                // Problem: Saved state may have member nodes but not the union nodes connecting them
                // Solution: For each visible node, ensure its unions are visible if they lead to other visible nodes
                for (let node of familienbaum.dag_all.nodes()) {
                    if (!node.added_data.is_visible) continue;

                    // Make child unions visible if they have visible children
                    const children = node.children ? node.children() : [];
                    for (let union of children) {
                        const unionChildren = union.children ? union.children() : [];
                        const hasVisibleChild = unionChildren.some((c: any) => c.added_data.is_visible);
                        if (hasVisibleChild) {
                            union.added_data.is_visible = true;
                        }
                    }

                    // Make parent unions visible if they have visible parents
                    const parents = (familienbaum.dag_all as any).parents ? (familienbaum.dag_all as any).parents(node) : [];
                    for (let union of parents) {
                        const unionParents = (familienbaum.dag_all as any).parents ? (familienbaum.dag_all as any).parents(union) : [];
                        const hasVisibleParent = unionParents.some((p: any) => p.added_data.is_visible);
                        if (hasVisibleParent) {
                            union.added_data.is_visible = true;
                        }
                    }
                }
            } else {
                console.warn(`Skipping visibility restoration: only ${validNodeCount}/${savedVisibleNodes!.size} nodes exist. Using default view.`);
                // Don't restore - trust default from reset_dags()

                // Clear invalid state to prevent future issues
                try {
                    localStorage.removeItem('soyagaci_visible_nodes');
                    localStorage.removeItem('soyagaci_view_transform');
                } catch (e) { }
            }
        }
        // Otherwise, trust the default visibility set by reset_dags() (root + children)

        // Draw initial tree
        let shouldRecenter = !state.transform;

        // Safety check: If we have a transform but the tree is collapsed (only root visible),
        // or if the number of visible nodes is significantly less than expected (restoration failed),
        // the transform is likely invalid. We should discard it and recenter.
        if (state.transform) {
            let visibleCount = 0;
            let matchCount = 0;

            if (familienbaum.dag_all) {
                for (let node of familienbaum.dag_all.nodes()) {
                    if (node.added_data.is_visible) {
                        visibleCount++;
                        if (state.visibleNodes.has(node.data)) {
                            matchCount++;
                        }
                    }
                }
            }

            // Check 1: Almost empty tree
            if (visibleCount <= 1) {
                console.warn("Saved transform exists but only 1 node is visible. Discarding transform.");
                shouldRecenter = true;
            }

            // Check 2: Restoration mismatch (Count)
            // If we expected many nodes but got few, the transform is likely for the large tree.
            if (state.visibleNodes.size > 5 && visibleCount < state.visibleNodes.size * 0.5) {
                console.warn(`Visibility restoration mismatch (Count). Expected ${state.visibleNodes.size}, got ${visibleCount}. Discarding transform.`);
                shouldRecenter = true;
            }

            // Check 3: Intersection mismatch (Specific Nodes)
            // If we expected specific nodes but they aren't visible, we are looking at wrong tree.
            if (state.visibleNodes.size > 0) {
                const matchRate = matchCount / state.visibleNodes.size;
                if (matchRate < 0.5) {
                    console.warn(`Visibility restoration mismatch (Intersection). Match rate ${matchRate.toFixed(2)}. Discarding transform.`);
                    shouldRecenter = true;
                }
            } else {
                // Check 4: No visible nodes restored (e.g. ID mapping failed)
                // If we have a transform but no restored nodes, we are likely falling back to default view.
                // The transform is likely invalid for the default view.
                console.warn("Saved transform exists but no visible nodes were restored from URL. Discarding transform.");
                shouldRecenter = true;
            }
        }

        familienbaum.draw(shouldRecenter, displayData.start, false);

        // Restore transform if available and valid
        if (state.transform && !shouldRecenter) {
            const t = state.transform;
            const transform = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
            familienbaum.svg.call(familienbaum.zoom.transform, transform);
        }

        // Attach callback AFTER initial draw to avoid overwriting URL with partial state during init
        familienbaum.onViewChange = onViewChange;
    }

    // Initial Render with slight delay to ensure DOM is ready
    setTimeout(() => {
        renderTree();
        renderProposalPanel();
    }, 50);

    // Event Listeners
    if (globalToggle) {
        globalToggle.addEventListener('click', () => {
            const isSwitchingToPatrilineal = !store.getState().isPatrilineal;

            // Capture current state before switching
            if (familienbaum && familienbaum.g) {
                const t = d3.zoomTransform(familienbaum.g.node()!);
                savedTransform = { k: t.k, x: t.x, y: t.y };

                // Capture current visible nodes
                const currentVisible = new Set(store.getState().visibleNodes);

                if (isSwitchingToPatrilineal) {
                    // Switching TO Patrilineal -> Save Full state
                    fullTreeVisibleNodes = new Set(currentVisible);
                    savedVisibleNodes = currentVisible; // Use current for transition (intersection will happen naturally)
                } else {
                    // Switching TO Full -> Restore Full state
                    if (fullTreeVisibleNodes) {
                        // Merge current visible (from filtered view) into full state
                        // so that nodes opened in filtered view stay open
                        for (let id of currentVisible) {
                            fullTreeVisibleNodes.add(id);
                        }
                        savedVisibleNodes = fullTreeVisibleNodes;
                    } else {
                        savedVisibleNodes = currentVisible;
                    }
                }
            }

            store.setPatrilineal(isSwitchingToPatrilineal);
            renderTree();
        });
    }

    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => shareCurrentState(store.getState()));
    }

    const resetViewBtn = document.getElementById('reset-view-btn');
    if (resetViewBtn) {
        resetViewBtn.addEventListener('click', () => {
            const url = new URL(window.location.href);
            url.searchParams.delete('reset');
            url.hash = '';
            sessionStorage.setItem('soyagaci_reset_requested', '1');
            window.location.href = url.pathname + url.search;
        });
    }

    // Note: btn-open-sheet click handler is set dynamically in editor/index.ts
    // based on which person is selected, so we don't set a global handler here

    const closeSidebarBtn = document.querySelector('.close-btn');
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', closeEditorSidebar);
    }

    window.addEventListener('popstate', async () => {
        const query = new URLSearchParams(window.location.search);
        const nextFamilies = selectedFamilySlugs(window.location.search, import.meta.env.VITE_FAMILY_SLUGS);
        const nextPending = query.get('view') === 'pending';
        const nextProposal = nextPending ? query.get('proposal') ?? undefined : undefined;
        const queryChanged = nextPending !== includePending || nextProposal !== proposalId
            || nextFamilies.join('\0') !== familySlugs.join('\0');
        if (queryChanged) {
            const families = selectableFamilies(publicFamilies);
            familySlugs = nextFamilies.filter(slug => families.some(family => family.slug === slug));
            if (!familySlugs.length && families.length) familySlugs = [families[0].slug];
            includePending = nextPending;
            proposalId = nextProposal;
            renderFamilyOptions();
            await reloadData(Boolean(proposalId), false);
        }
        const urlState = decodeState();
        if (urlState) {
            // 1. Restore Patrilineal Mode if changed
            if (urlState.patrilineal !== store.getState().isPatrilineal) {
                store.setPatrilineal(urlState.patrilineal);
                // We need to ensure the tree is in the correct mode before restoring visibility
                // renderTree() sets up the data but might reset visibility if we aren't careful.
                // However, renderTreeInternal uses savedVisibleNodes if set.
                // So we can set savedVisibleNodes here if we were to call renderTree, 
                // but since we have access to familienbaum, we can just update it directly if it exists.
            }

            if (familienbaum && familienbaum.dag_all) {
                // 2. Restore Visibility
                if (urlState.visibleNodes) {
                    const visibleSet = urlState.visibleNodes;
                    store.setVisibleNodes(visibleSet);

                    // Apply to dag_all
                    for (let node of familienbaum.dag_all.nodes()) {
                        node.added_data.is_visible = visibleSet.has(node.data);
                    }

                    // Ensure currentNode is visible
                    if (urlState.currentNode) {
                        const node = familienbaum.dag_all.find_node(urlState.currentNode);
                        if (node) node.added_data.is_visible = true;
                    }
                }

                // 3. Restore Transform
                if (urlState.transform) {
                    store.setTransform(urlState.transform);
                    if (familienbaum.svg && familienbaum.zoom) {
                        const t = urlState.transform;
                        const transform = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
                        familienbaum.svg.call(familienbaum.zoom.transform, transform);
                    }
                }

                // 4. Draw and Focus
                // We pass false to recenter if we have a transform, otherwise true to center on node
                const shouldRecenter = !urlState.transform;

                if (urlState.currentNode && familienbaum.data.members[urlState.currentNode]) {
                    familienbaum.draw(shouldRecenter, urlState.currentNode);
                } else {
                    familienbaum.draw(false);
                }
            }
        }
    });

    // Save state on unload
    window.addEventListener("beforeunload", () => {
        if (familienbaum && familienbaum.g) {
            const transform = d3.zoomTransform(familienbaum.g.node()!);
            localStorage.setItem('soyagaci_view_transform', JSON.stringify({ k: transform.k, x: transform.x, y: transform.y }));

            if (familienbaum.dag_all) {
                const visibleNodes: string[] = [];
                for (let node of familienbaum.dag_all.nodes()) {
                    if (node.added_data?.is_visible) visibleNodes.push(node.data);
                }
                localStorage.setItem('soyagaci_visible_nodes', JSON.stringify(visibleNodes));
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') document.body.classList.add('show-plus');
        if (e.key === 'Escape') {
            const sidebar = document.getElementById('family-sidebar');
            if (sidebar?.classList.contains('active')) {
                closeEditorSidebar();
            }
        }
    });
    document.addEventListener('keyup', (e) => { if (e.key === 'Shift') document.body.classList.remove('show-plus'); });
}

init();
