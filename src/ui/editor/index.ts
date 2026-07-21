import type { Familienbaum } from '../../components/Tree/Familienbaum';
import type { D3Node } from '../../types/types';
import {
    type FamilyGraph, type MergedPersonFields, type PublicFamily, type SubmissionResult,
} from '../../services/data/familyRepository';
import { personSearchEntries, rankPersonSearchEntries } from '../../services/data/personSearch';
import { REMOVED_PHOTO_URL } from '../../constants/media';
import { initImageCropper, uploadPhotoAndGetUrl } from './image';
import {
    displayDate,
    FamilyCreationSubmitter,
    FamilyEditAttempt,
    FamilyEditSubmitter,
    PersonMergeSubmitter,
    mapChildEdit,
    mapParentEdit,
    mapFamilyJoin,
    mapProfileEdit,
    mapSpouseEdit,
    partnershipEndpointsInFamily,
    type PersonFields,
} from './submission';

type EditorContext = {
    getGraph: () => FamilyGraph;
    getFamilies: () => PublicFamily[];
    onSubmitted: (result: SubmissionResult) => Promise<void>;
};

export function suggestFamilySlug(name: string): string {
    return name.toLocaleLowerCase('tr-TR')
        .replace(/[çğıöşü]/g, letter => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[letter]!)
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/g, '');
}

let editorInvoker: (Element & { focus: () => void }) | null = null;

export function openEditorSidebar(sidebar: HTMLElement, invoker = document.activeElement) {
    editorInvoker = invoker && 'focus' in invoker ? invoker as Element & { focus: () => void } : null;
    sidebar.removeAttribute('inert');
    sidebar.classList.add('active');
    sidebar.setAttribute('aria-hidden', 'false');
}

export function closeEditorSidebar() {
    const sidebar = document.getElementById('family-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('active');
    sidebar.setAttribute('aria-hidden', 'true');
    sidebar.setAttribute('inert', '');
    editorInvoker?.focus();
    editorInvoker = null;
}

export function closeEditorSidebarOnMobile() {
    if (!window.matchMedia?.('(max-width: 760px)').matches) return false;
    closeEditorSidebar();
    return true;
}

const fieldDefinitions: Array<[keyof PersonFields, string, 'text' | 'select']> = [
    ['first_name', 'Ad', 'text'],
    ['last_name', 'Soyad', 'text'],
    ['gender', 'Cinsiyet', 'select'],
    ['birth_date', 'Doğum tarihi', 'text'],
    ['birthplace', 'Doğum yeri', 'text'],
    ['death_date', 'Ölüm tarihi', 'text'],
    ['death_place', 'Ölüm yeri', 'text'],
    ['occupation', 'Meslek', 'text'],
    ['marriage', 'Evlilik tarihi', 'text'],
    ['note', 'Not', 'text'],
];

function blankPerson(): PersonFields {
    return {
        first_name: '', last_name: '', gender: '', birth_date: '', birthplace: '',
        death_date: '', death_place: '', occupation: '', marriage: '', note: '',
    };
}

function personId(node: D3Node): string {
    const id = (node.added_data.input as { persistentId?: string } | undefined)?.persistentId;
    if (!id) throw new Error('Seçilen kişinin kalıcı kimliği bulunamadı.');
    return id;
}

function graphFields(graph: FamilyGraph, id: string): PersonFields {
    const person = graph.people.find(candidate => candidate.id === id)?.current_revision;
    if (!person) return blankPerson();
    const event = (type: string) => graph.life_events.find(candidate =>
        candidate.person_id === id && candidate.current_revision?.event_type === type)?.current_revision;
    const birth = event('birth');
    const death = event('death');
    const occupation = event('occupation');
    const partnerships = graph.partnerships.filter(partnership => partnership.current_revision
        && [partnership.person1_id, partnership.person2_id].includes(id));

    const normalizedGender = (() => {
        const val = person.gender;
        const normalized = val?.toLocaleLowerCase('tr').trim();
        if (['male', 'm', 'erkek', 'e'].includes(normalized ?? '')) return 'E';
        if (['female', 'f', 'kadın', 'kadin', 'k'].includes(normalized ?? '')) return 'K';
        return 'U';
    })();

    return {
        first_name: person.given_name ?? '',
        last_name: person.family_name ?? '',
        gender: normalizedGender,
        birth_date: displayDate(birth),
        birthplace: birth?.place_text ?? '',
        death_date: displayDate(death),
        death_place: death?.place_text ?? '',
        occupation: occupation?.details ?? '',
        marriage: partnerships.length === 1
            ? displayDate(partnerships[0].current_revision)
            : '',
        note: person.summary ?? '',
    };
}

type MergeChoice = 'target' | 'source';
const mergeFields = [
    ['given_name', 'Ad'], ['middle_names', 'İkinci ad'], ['family_name', 'Soyad'],
    ['gender', 'Cinsiyet'], ['is_living', 'Yaşıyor'], ['summary', 'Not'],
    ['birth_date', 'Doğum tarihi'], ['birthplace', 'Doğum yeri'],
    ['death_date', 'Ölüm tarihi'], ['death_place', 'Ölüm yeri'], ['occupation', 'Meslek'],
] as const;
type MergeField = typeof mergeFields[number][0];

export function resolvedMergeFields(
    graph: FamilyGraph,
    targetId: string,
    sourceId: string,
    choices: Partial<Record<MergeField, MergeChoice>> = {},
): { fields: MergedPersonFields; conflicts: Array<{ key: MergeField; label: string; target: string; source: string }> } {
    const revision = (id: string) => graph.people.find(person => person.id === id)?.current_revision;
    const targetRevision = revision(targetId);
    const sourceRevision = revision(sourceId);
    if (!targetRevision || !sourceRevision) throw new Error('Birleştirilecek iki kişinin de onaylı kaydı olmalıdır.');
    const values = (id: string, current: typeof targetRevision): Record<MergeField, string> => {
        const profile = graphFields(graph, id);
        return {
            given_name: current.given_name ?? '', middle_names: current.middle_names ?? '',
            family_name: current.family_name ?? '', gender: current.gender ?? '',
            is_living: current.is_living === null ? '' : current.is_living ? 'Evet' : 'Hayır',
            summary: current.summary ?? '', birth_date: profile.birth_date,
            birthplace: profile.birthplace, death_date: profile.death_date,
            death_place: profile.death_place, occupation: profile.occupation,
        };
    };
    const target = values(targetId, targetRevision);
    const source = values(sourceId, sourceRevision);
    const merged = {} as Record<MergeField, string>;
    const conflicts: Array<{ key: MergeField; label: string; target: string; source: string }> = [];
    for (const [key, label] of mergeFields) {
        const left = target[key].trim();
        const right = source[key].trim();
        if (!left || !right || left === right) merged[key] = left || right;
        else if (choices[key]) merged[key] = choices[key] === 'target' ? left : right;
        else conflicts.push({ key, label, target: left, source: right });
    }
    return {
        fields: {
            given_name: merged.given_name || null, middle_names: merged.middle_names || null,
            family_name: merged.family_name || null, gender: merged.gender || null,
            is_living: merged.is_living ? merged.is_living === 'Evet' : null,
            summary: merged.summary || null,
            aliases: [...new Set([...targetRevision.aliases, ...sourceRevision.aliases])],
            birth_date: merged.birth_date || null, birthplace: merged.birthplace || null,
            death_date: merged.death_date || null, death_place: merged.death_place || null,
            occupation: merged.occupation || null,
        },
        conflicts,
    };
}

function renderPathSearch(tree: Familienbaum, startId: string): void {
    const host = document.getElementById('sidebar-path');
    if (!host) return;
    host.replaceChildren();
    host.hidden = false;

    const title = document.createElement('h3');
    title.textContent = 'En kısa yol bul';
    const input = document.createElement('input');
    input.className = 'sidebar-input';
    input.placeholder = 'Hedef kişi bul...';
    input.autocomplete = 'off';
    const dropdown = document.createElement('div');
    dropdown.className = 'person-search-dropdown';
    dropdown.hidden = true;
    const find = document.createElement('button');
    find.type = 'button';
    find.className = 'action-btn btn-primary';
    find.textContent = 'Yolu göster';
    find.disabled = true;

    const entries = () => personSearchEntries(tree.dag_all);
    let selectedId = '';
    let selectedIndex = -1;

    const renderMatches = () => {
        const matches = rankPersonSearchEntries(entries(), input.value);
        dropdown.replaceChildren();
        selectedIndex = -1;
        if (matches.length === 0) {
            dropdown.hidden = true;
            return;
        }
        matches.slice(0, 20).forEach((entry, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'person-search-option';
            option.textContent = entry.display;
            option.onmousedown = event => event.preventDefault();
            option.onclick = () => {
                selectedId = entry.id;
                input.value = entry.display;
                dropdown.hidden = true;
                find.disabled = false;
            };
            option.onmouseenter = () => { selectedIndex = index; };
            dropdown.append(option);
        });
        dropdown.hidden = false;
    };

    input.oninput = () => {
        selectedId = '';
        find.disabled = true;
        renderMatches();
    };
    input.onkeydown = event => {
        const options = [...dropdown.querySelectorAll<HTMLButtonElement>('.person-search-option')];
        if (event.key === 'ArrowDown' && options.length) {
            event.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
            options[selectedIndex].focus();
        } else if (event.key === 'ArrowUp' && options.length) {
            event.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            options[selectedIndex].focus();
        } else if (event.key === 'Enter' && options[selectedIndex]) {
            event.preventDefault();
            options[selectedIndex].click();
        } else if (event.key === 'Escape') {
            dropdown.hidden = true;
        }
    };
    input.onblur = () => setTimeout(() => { dropdown.hidden = true; }, 150);
    find.onclick = () => {
        if (!selectedId) return;
        tree.findPath(startId, selectedId);
        closeEditorSidebarOnMobile();
    };
    host.append(title, input, dropdown, find);
}

function addInput(container: HTMLElement, key: keyof PersonFields, label: string, type: 'text' | 'select', value = '') {
    const wrapper = document.createElement('label');
    wrapper.className = 'editor-field';
    let input: HTMLInputElement | HTMLSelectElement;
    if (type === 'select') {
        input = document.createElement('select');
        for (const [optionValue, optionLabel] of [['', 'Belirsiz'], ['E', 'Erkek'], ['K', 'Kadın'], ['U', 'Belirsiz']]) {
            input.add(new Option(`${label}: ${optionLabel}`, optionValue));
        }
    } else {
        input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.placeholder = label;
    }
    input.className = 'sidebar-input';
    input.setAttribute('aria-label', label);
    input.name = String(key);
    input.value = value;
    wrapper.append(input);
    container.append(wrapper);
    return input;
}

function addPersonFields(container: HTMLElement, values: PersonFields, prefix = '') {
    for (const [key, label, type] of fieldDefinitions) {
        if (prefix && key === 'marriage') continue;
        addInput(container, `${prefix}${key}` as keyof PersonFields, label, type, values[key] ?? '');
    }
}

function readPerson(form: HTMLFormElement, prefix = ''): PersonFields {
    const value = (key: keyof PersonFields) =>
        (form.elements.namedItem(`${prefix}${key}`) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() ?? '';
    return {
        first_name: value('first_name'), last_name: value('last_name'), gender: value('gender'),
        birth_date: value('birth_date'), birthplace: value('birthplace'), death_date: value('death_date'),
        death_place: value('death_place'), occupation: value('occupation'), marriage: value('marriage'), note: value('note'),
        media_url: value('media_url'),
    };
}

function addPhotoInput(form: HTMLFormElement) {
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'media_url'; form.append(input);
    const hint = document.createElement('p'); hint.className = 'family-creation-context'; hint.textContent = 'Fotoğrafı yüklemek için üstteki görsele tıklayın.'; form.append(hint);
}

export function editableFamilies(graph: FamilyGraph, id: string, families: PublicFamily[]): PublicFamily[] {
    const displayFamilyIds = new Set(graph.memberships.filter(membership => membership.person_id === id
        && membership.current_revision).map(membership => membership.family_id));
    return graph.families.filter(family => displayFamilyIds.has(family.id))
        .map(family => families.find(candidate => candidate.id === family.id)!)
        .filter(Boolean);
}

function statusElement(form: HTMLFormElement) {
    const status = document.createElement('div');
    status.className = 'editor-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.append(status);
    return status;
}

async function flashSubmitted(button: HTMLButtonElement) {
    const label = button.textContent;
    const ariaLabel = button.getAttribute('aria-label');
    button.textContent = '✓';
    button.setAttribute('aria-label', 'Gönderildi');
    await new Promise(resolve => setTimeout(resolve, 1000));
    button.textContent = label;
    if (ariaLabel === null) button.removeAttribute('aria-label');
    else button.setAttribute('aria-label', ariaLabel);
}

export function initEditor(tree: Familienbaum, context: EditorContext) {
    const submitter = new FamilyEditSubmitter();
    const familyCreationSubmitter = new FamilyCreationSubmitter();
    const personMergeSubmitter = new PersonMergeSubmitter();
    initImageCropper(file => {
        const input = document.querySelector('input[name="media_url"]') as HTMLInputElement | null;
        if (!input) return;
        const status = document.querySelector('.edit-form .editor-status') as HTMLElement | null;
        if (status) {
            status.textContent = 'Fotoğraf yükleniyor…';
            status.className = 'editor-status';
        }
        void uploadPhotoAndGetUrl(file).then(url => {
            input.value = url;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const image = document.getElementById('sidebar-image') as HTMLImageElement | null;
            if (image) {
                image.src = url;
                image.style.display = 'block';
            }
            if (status) {
                status.textContent = 'Fotoğraf yüklendi. Değişikliği önermek için "Kaydet" butonuna tıklayın.';
                status.className = 'editor-status success';
            }
        }).catch(err => {
            if (status) {
                status.textContent = err instanceof Error ? err.message : 'Fotoğraf yüklenemedi.';
                status.className = 'editor-status error';
            }
        });
    });

    tree.create_editing_form = (node: D3Node, nodeAll: D3Node) => {
        const sidebar = document.getElementById('family-sidebar');
        const title = document.getElementById('sidebar-title');
        const details = document.getElementById('sidebar-details');
        const image = document.getElementById('sidebar-image') as HTMLImageElement | null;
        const deletePhoto = document.getElementById('delete-photo-btn') as HTMLButtonElement | null;
        if (!sidebar || !title || !details) return;

        let selectedId: string;
        try { selectedId = personId(node); } catch (error) {
            details.textContent = error instanceof Error ? error.message : 'Kişi açılamadı.';
            return;
        }
        const graph = context.getGraph();
        const values = graphFields(graph, selectedId);
        const families = editableFamilies(graph, selectedId, context.getFamilies());
        const canAssignFamily = nodeAll.added_data.input?.has_family === false;
        title.textContent = `${values.first_name} ${values.last_name}`.trim() || 'İsimsiz';
        const placeholder = "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png";
        const imagePath = (node.added_data.input as { image_path?: string } | undefined)?.image_path ?? '';
        if (image) {
            image.src = imagePath || placeholder;
            image.style.display = 'block';
            image.onclick = null;
            image.title = "Fotoğrafı değiştirmek için tıklayın";
        }
        openEditorSidebar(sidebar);
        renderPathSearch(tree, nodeAll.data);

        const render = (mode: 'profile' | 'spouse' | 'child' | 'family' | 'photo' | 'father' | 'merge') => {
            const attempt = new FamilyEditAttempt(submitter);
            details.replaceChildren();
            if (image) image.onclick = mode === 'profile' || mode === 'photo' ? () => { render('photo'); (document.getElementById('image-upload-input') as HTMLInputElement | null)?.click(); } : null;
            if (mode === 'profile' && image) image.src = imagePath || placeholder;
            if (deletePhoto) deletePhoto.style.display = mode === 'profile' && imagePath ? 'block' : 'none';
            if (mode === 'profile') {
                const modeActions = document.createElement('div');
                modeActions.className = 'editor-mode-actions';
                const spouse = document.createElement('button');
                spouse.type = 'button';
                spouse.className = 'action-btn btn-secondary';
                spouse.textContent = '+ Eş / partner';
                spouse.onclick = () => render('spouse');
                const child = document.createElement('button');
                child.type = 'button';
                child.className = 'action-btn btn-primary';
                child.textContent = '+ Çocuk';
                child.onclick = () => render('child');

                const hasFather = graph.parent_links.some(link =>
                    link.child_id === selectedId &&
                    graph.people.some(p => p.id === link.parent_id && p.current_revision?.gender === 'E')
                );
                const father = document.createElement('button');
                father.type = 'button';
                father.className = 'action-btn btn-secondary';
                father.textContent = '+ Baba';
                father.onclick = () => render('father');

                const family = document.createElement('button');
                family.type = 'button';
                family.className = 'action-btn btn-secondary';
                family.textContent = 'Aile Ekle';
                family.onclick = () => render('family');

                const merge = document.createElement('button');
                merge.type = 'button';
                merge.className = 'action-btn btn-secondary';
                merge.textContent = 'Kişi Birleştir';
                merge.onclick = () => render('merge');

                modeActions.append(spouse, child, merge);
                if (!hasFather) modeActions.append(father);
                if (canAssignFamily) modeActions.append(family);
                details.append(modeActions);
            }
            if (mode === 'merge') {
                const form = document.createElement('form');
                form.className = 'edit-form';
                const input = addInput(form, 'merge_target' as keyof PersonFields, 'Bu kişiyle birleştirilecek kayıt', 'text') as HTMLInputElement;
                const options = personSearchEntries(tree.dag_all).map(entry => ({
                    ...entry, id: personId(tree.dag_all.find_node(entry.id)),
                })).filter(entry => entry.id !== selectedId);
                input.autocomplete = 'off';
                const dropdown = document.createElement('div'); dropdown.className = 'person-search-dropdown'; dropdown.hidden = true;
                let mergeTargetId = '';
                input.addEventListener('input', () => {
                    mergeTargetId = '';
                    dropdown.replaceChildren();
                    const matches = rankPersonSearchEntries(options, input.value).slice(0, 20);
                    for (const entry of matches) {
                        const option = document.createElement('button'); option.type = 'button'; option.className = 'person-search-option'; option.textContent = entry.display;
                        option.onmousedown = event => event.preventDefault();
                        option.onclick = () => { mergeTargetId = entry.id; input.value = entry.display; dropdown.hidden = true; };
                        dropdown.append(option);
                    }
                    dropdown.hidden = matches.length === 0;
                });
                input.addEventListener('blur', () => setTimeout(() => { dropdown.hidden = true; }, 150));
                form.append(dropdown);
                const conflicts = document.createElement('div');
                conflicts.className = 'merge-conflicts';
                form.append(conflicts);
                const actions = document.createElement('div'); actions.className = 'editor-actions';
                const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'action-btn btn-secondary'; cancel.textContent = 'İptal'; cancel.onclick = () => render('profile');
                const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'action-btn btn-danger'; submit.textContent = 'Birleştir';
                actions.append(cancel, submit); form.append(actions);
                const status = statusElement(form);
                input.addEventListener('input', () => { conflicts.replaceChildren(); submit.textContent = 'Birleştir'; });
                form.onsubmit = async event => {
                    event.preventDefault();
                    const ranked = rankPersonSearchEntries(options, input.value);
                    const match = options.find(entry => entry.id === mergeTargetId) ?? (ranked.length === 1 ? ranked[0] : undefined);
                    if (!match) { status.textContent = 'Listeden bir kişi seçin.'; status.className = 'editor-status error'; return; }
                    const choices = Object.fromEntries([...conflicts.querySelectorAll<HTMLSelectElement>('select')]
                        .filter(select => select.value).map(select => [select.name, select.value])) as Partial<Record<MergeField, MergeChoice>>;
                    const resolved = resolvedMergeFields(graph, selectedId, match.id, choices);
                    if (resolved.conflicts.length) {
                        conflicts.replaceChildren();
                        const hint = document.createElement('p');
                        hint.textContent = 'Farklı alanlar için korunacak değeri seçin.';
                        conflicts.append(hint);
                        for (const conflict of resolved.conflicts) {
                            const label = document.createElement('label'); label.className = 'editor-field'; label.textContent = conflict.label;
                            const select = document.createElement('select'); select.className = 'sidebar-input'; select.name = conflict.key; select.required = true;
                            select.add(new Option('Seçin', '')); select.add(new Option(conflict.target, 'target')); select.add(new Option(conflict.source, 'source'));
                            label.append(select); conflicts.append(label);
                        }
                        submit.textContent = 'Seçimleri birleştir';
                        conflicts.querySelector('select')?.focus();
                        return;
                    }
                    const familyId = families[0]?.id;
                    if (!familyId) { status.textContent = 'Bu kişi için düzenlenebilir bir hedef aile yok.'; status.className = 'editor-status error'; return; }
                    if (!window.confirm(`${match.display} kaydı bu kişiyle kalıcı olarak birleştirilsin mi?`)) return;
                    submit.disabled = true;
                    try {
                        const result = await personMergeSubmitter.send(familyId, match.id, selectedId, resolved.fields);
                        await context.onSubmitted(result);
                        status.textContent = '';
                        await flashSubmitted(submit);
                        submit.textContent = '✓ Onay bekliyor';
                    } catch (error) {
                        status.textContent = error instanceof Error ? error.message : 'Kişiler birleştirilemedi.';
                        status.className = 'editor-status error';
                        submit.disabled = false;
                    }
                };
                details.append(form); input.focus(); return;
            }
            if (mode === 'family') {
                const form = document.createElement('form');
                form.className = 'edit-form family-creation-form';
                form.noValidate = true;
                const availableFamilies = context.getFamilies();
                const name = addInput(form, 'family_name' as keyof PersonFields, 'Aile', 'text') as HTMLInputElement;
                name.required = true; name.maxLength = 200; name.setAttribute('list', 'available-families');
                const familyList = document.createElement('datalist');
                familyList.id = 'available-families';
                for (const family of availableFamilies) familyList.append(new Option(family.name));
                form.append(familyList);
                const root = document.createElement('p');
                root.className = 'family-creation-context';
                root.textContent = `Eklenecek kişi: ${values.first_name} ${values.last_name}`.trim();
                form.addEventListener('input', () => familyCreationSubmitter.invalidate());
                const actions = document.createElement('div');
                actions.className = 'editor-actions';
                const cancel = document.createElement('button');
                cancel.type = 'button'; cancel.className = 'action-btn btn-secondary'; cancel.textContent = 'İptal';
                cancel.onclick = () => render('profile');
                const submit = document.createElement('button');
                submit.type = 'submit'; submit.className = 'action-btn btn-success'; submit.textContent = 'Ekle';
                actions.append(cancel, submit);
                form.append(root, actions);
                const status = statusElement(form);
                let sending = false;
                let submitted = false;
                form.onsubmit = async event => {
                    event.preventDefault();
                    if (sending) return;
                    const existingFamily = availableFamilies.find(family =>
                        family.name.localeCompare(name.value.trim(), 'tr-TR', { sensitivity: 'base' }) === 0);
                    const newSlug = suggestFamilySlug(name.value);
                    const sourceFamilyId = families[0]?.id;
                    if (!form.checkValidity() || (!existingFamily && (!sourceFamilyId || !newSlug))) {
                        (form.querySelector(':invalid') as HTMLElement | null)?.focus();
                        status.textContent = sourceFamilyId ? 'Geçerli bir aile adı girin.' : 'Görünür kaynak aile gereklidir.';
                        status.className = 'editor-status error';
                        return;
                    }
                    try {
                        sending = true; submit.disabled = true; status.className = 'editor-status'; status.textContent = 'Gönderiliyor…';
                        const result = !existingFamily
                            ? await familyCreationSubmitter.send({
                                sourceFamilyId, personId: selectedId, name: name.value.trim(), slug: newSlug,
                            })
                            : await attempt.send(existingFamily.id, () => mapFamilyJoin(graph, selectedId, existingFamily.id));
                        await context.onSubmitted(result);
                        status.textContent = '';
                        await flashSubmitted(submit);
                        submitted = true;
                        submit.textContent = '✓ Onay bekliyor';
                    } catch (error) {
                        status.textContent = error instanceof Error ? error.message : 'Gönderilemedi. Tekrar deneyin.';
                        status.className = 'editor-status error';
                    } finally { sending = false; submit.disabled = submitted; }
                };
                details.append(form);
                name.focus();
                return;
            }
            const form = document.createElement('form');
            form.className = 'edit-form';
            form.noValidate = true;
            const familyInput = document.createElement('input');
            familyInput.type = 'hidden'; familyInput.name = 'family_id'; familyInput.value = families[0]?.id ?? '';
            form.append(familyInput);
            if (mode === 'photo') addPhotoInput(form);
            else {
                const defaultValues = mode === 'profile'
                    ? values
                    : { ...blankPerson(), last_name: values.last_name, ...(mode === 'father' ? { gender: 'E' } : {}) };
                addPersonFields(form, defaultValues);
            }
            if (mode === 'profile') {
                const partnership = graph.partnerships.filter(candidate => candidate.current_revision
                    && [candidate.person1_id, candidate.person2_id].includes(selectedId));
                const marriage = form.elements.namedItem('marriage') as HTMLInputElement;
                const family = form.elements.namedItem('family_id') as HTMLInputElement;
                const updateMarriage = () => {
                    const editable = partnership.length === 1
                        && partnershipEndpointsInFamily(graph, partnership[0].id, family.value);
                    marriage.disabled = !editable;
                    marriage.title = editable ? '' : 'Her iki kişiyi içeren hedef aile gereklidir.';
                };
                family.addEventListener('change', updateMarriage);
                updateMarriage();
            }
            if (mode === 'child') {
                const label = document.createElement('label');
                label.className = 'editor-field';
                label.textContent = 'İkinci ebeveyn';
                const select = document.createElement('select');
                select.name = 'second_parent';
                select.className = 'sidebar-input';
                select.add(new Option('Yok / bilinmiyor', ''));
                select.add(new Option('Yeni ebeveyn ekle', 'new'));
                for (const person of graph.people) {
                    if (person.id !== selectedId && person.current_revision) {
                        select.add(new Option(person.current_revision.display_name, person.id));
                    }
                }
                label.append(select);
                form.append(label);
                const newParent = document.createElement('fieldset');
                newParent.className = 'new-parent-fields';
                newParent.hidden = true;
                const legend = document.createElement('legend');
                legend.textContent = 'Yeni ebeveyn';
                newParent.append(legend);
                addPersonFields(newParent, blankPerson(), 'parent_');
                form.append(newParent);
                select.onchange = () => { newParent.hidden = select.value !== 'new'; };
            }
            const actions = document.createElement('div');
            actions.className = 'editor-actions';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'action-btn btn-secondary';
            cancel.textContent = 'İptal';
            cancel.onclick = () => render('profile');
            const submit = document.createElement('button');
            submit.type = 'submit';
            submit.className = 'action-btn btn-success';
            submit.textContent = (mode === 'profile' || mode === 'photo') ? 'Kaydet' : mode === 'spouse' ? 'Eş / partner ekle' : mode === 'father' ? 'Baba ekle' : 'Çocuk ekle';
            actions.append(cancel, submit);
            form.append(actions);
            const status = statusElement(form);
            let sending = false;
            const invalidate = () => attempt.invalidate();
            form.addEventListener('input', invalidate);
            form.addEventListener('change', invalidate);
            form.onsubmit = async event => {
                event.preventDefault();
                if (sending) return;
                status.className = 'editor-status';
                const formFields = readPerson(form);
                const fields = mode === 'photo'
                    ? { ...values, media_url: formFields.media_url }
                    : formFields;

                if (mode === 'photo' && !fields.media_url) {
                    status.textContent = 'Lütfen bir fotoğraf seçin.';
                    status.classList.add('error');
                    return;
                }
                if (!fields.first_name || !fields.last_name) {
                    status.textContent = 'Ad ve soyad gereklidir.';
                    status.classList.add('error');
                    return;
                }
                const familyId = (form.elements.namedItem('family_id') as HTMLSelectElement).value;
                if (!familyId) {
                    status.textContent = 'Bu kişi için düzenlenebilir bir hedef aile yok.';
                    status.classList.add('error');
                    return;
                }
                try {
                    sending = true;
                    submit.disabled = true;
                    status.textContent = 'Gönderiliyor…';
                    const result = await attempt.send(familyId, () => {
                        const currentFields = readPerson(form);
                        const fields = mode === 'photo'
                            ? { ...values, media_url: currentFields.media_url }
                            : currentFields;
                        if (mode === 'profile' || mode === 'photo') return mapProfileEdit(graph, selectedId, fields, familyId);
                        if (mode === 'spouse') return mapSpouseEdit(graph, selectedId, fields, fields.marriage);
                        if (mode === 'father') {
                            const parentFields = readPerson(form);
                            parentFields.gender = 'E';
                            return mapParentEdit(graph, selectedId, parentFields);
                        }
                        const choice = (form.elements.namedItem('second_parent') as HTMLSelectElement).value;
                        if (choice === 'new') {
                            const parent = readPerson(form, 'parent_');
                            if (!parent.first_name || !parent.last_name) {
                                throw new Error('Yeni ebeveyn için ad ve soyad gereklidir.');
                            }
                        }
                        return mapChildEdit(graph, selectedId, currentFields, (() => {
                                const choice = (form.elements.namedItem('second_parent') as HTMLSelectElement).value;
                                if (choice === 'new') return { fields: readPerson(form, 'parent_') };
                                return choice ? { personId: choice } : {};
                            })(), familyId);
                    });
                    await context.onSubmitted(result);
                    status.textContent = '';
                    if (!closeEditorSidebarOnMobile()) await flashSubmitted(submit);
                } catch (error) {
                    status.textContent = error instanceof Error ? error.message : 'Gönderilemedi. Bağlantıyı kontrol edip tekrar deneyin.';
                    status.classList.add('error');
                } finally {
                    sending = false;
                    submit.disabled = false;
                }
            };
            details.append(form);
            (form.querySelector('input[name="first_name"]') as HTMLInputElement | null)?.focus();
        };

        if (deletePhoto) {
            deletePhoto.type = 'button';
            deletePhoto.title = 'Fotoğrafı kaldır';
            deletePhoto.setAttribute('aria-label', 'Fotoğrafı kaldır');
            deletePhoto.onclick = event => {
                event.stopPropagation();
                render('photo');
                const input = document.querySelector<HTMLInputElement>('input[name="media_url"]');
                if (input) input.value = REMOVED_PHOTO_URL;
                if (image) image.src = placeholder;
                const status = document.querySelector<HTMLElement>('.edit-form .editor-status');
                if (status) status.textContent = 'Fotoğraf kaldırılacak. Kaydet’e basın.';
            };
        }

        render('profile');

        for (const related of tree.get_relationship_in_dag_all(nodeAll)) related.added_data.is_visible = true;
        tree.draw(true, nodeAll.data);
        tree.ensureNodeVisible(nodeAll.data);
    };
}
