import type { Familienbaum } from '../../components/Tree/Familienbaum';
import type { D3Node } from '../../types/types';
import type { FamilyGraph, PublicFamily, SubmissionResult } from '../../services/data/familyRepository';
import { get_name, is_member } from '../../components/Tree/dagWithFamilyData';
import { initImageCropper, uploadPhotoAndGetUrl } from './image';
import {
    displayDate,
    FamilyCreationSubmitter,
    FamilyEditAttempt,
    FamilyEditSubmitter,
    mapChildEdit,
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
    return {
        first_name: person.given_name ?? '',
        last_name: person.family_name ?? '',
        gender: person.gender ?? '',
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

function addInput(container: HTMLElement, key: keyof PersonFields, label: string, type: 'text' | 'select', value = '') {
    const wrapper = document.createElement('label');
    wrapper.className = 'editor-field';
    wrapper.textContent = label;
    let input: HTMLInputElement | HTMLSelectElement;
    if (type === 'select') {
        input = document.createElement('select');
        for (const [optionValue, optionLabel] of [['', 'Belirsiz'], ['E', 'Erkek'], ['K', 'Kadın'], ['U', 'Belirsiz']]) {
            input.add(new Option(optionLabel, optionValue));
        }
    } else {
        input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
    }
    input.className = 'sidebar-input';
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

function editableFamilies(graph: FamilyGraph, id: string, families: PublicFamily[]): PublicFamily[] {
    const familyIds = new Set(graph.memberships.filter(membership => membership.person_id === id
        && membership.current_revision).map(membership => membership.family_id));
    return families.filter(family => familyIds.has(family.id));
}

function addFamilySelect(form: HTMLFormElement, families: PublicFamily[], title = 'Hedef aile') {
    const label = document.createElement('label');
    label.className = 'editor-field';
    label.textContent = title;
    const select = document.createElement('select');
    select.name = 'family_id';
    select.className = 'sidebar-input';
    select.required = true;
    for (const family of families) select.add(new Option(family.name, family.id));
    label.append(select);
    form.prepend(label);
}

function statusElement(form: HTMLFormElement) {
    const status = document.createElement('div');
    status.className = 'editor-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.append(status);
    return status;
}

export function initEditor(tree: Familienbaum, context: EditorContext) {
    const submitter = new FamilyEditSubmitter();
    const familyCreationSubmitter = new FamilyCreationSubmitter();
    initImageCropper(file => {
        const input = document.querySelector('input[name="media_url"]') as HTMLInputElement | null;
        if (!input) return;
        void uploadPhotoAndGetUrl(file).then(url => { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); });
    });

    tree.create_editing_form = (node: D3Node, nodeAll: D3Node) => {
        const sidebar = document.getElementById('family-sidebar');
        const title = document.getElementById('sidebar-title');
        const details = document.getElementById('sidebar-details');
        const image = document.getElementById('sidebar-image') as HTMLImageElement | null;
        if (!sidebar || !title || !details) return;

        let selectedId: string;
        try { selectedId = personId(node); } catch (error) {
            details.textContent = error instanceof Error ? error.message : 'Kişi açılamadı.';
            return;
        }
        const graph = context.getGraph();
        const values = graphFields(graph, selectedId);
        const families = editableFamilies(graph, selectedId, context.getFamilies());
        title.textContent = `${values.first_name} ${values.last_name}`.trim() || 'İsimsiz';
        if (image) {
            image.src = (node.added_data.input as { image_path?: string } | undefined)?.image_path ?? '';
            image.style.display = image.src ? 'block' : 'none';
            image.onclick = null;
        }
        openEditorSidebar(sidebar);

        const render = (mode: 'profile' | 'spouse' | 'child' | 'family' | 'photo') => {
            const attempt = new FamilyEditAttempt(submitter);
            details.replaceChildren();
            if (image) image.onclick = mode === 'profile' || mode === 'photo' ? () => { render('photo'); (document.getElementById('image-upload-input') as HTMLInputElement | null)?.click(); } : null;
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
                const family = document.createElement('button');
                family.type = 'button';
                family.className = 'action-btn btn-secondary';
                family.textContent = 'Aile başlat';
                family.onclick = () => render('family');
                modeActions.append(spouse, child, family);
                details.append(modeActions);
                const path = document.createElement('section');
                const target = document.createElement('select'); target.className = 'sidebar-input'; target.add(new Option('Hedef kişi seçin', ''));
                for (const n of tree.dag_all.nodes().filter(n => is_member(n))) target.add(new Option(get_name(n), n.data));
                const find = document.createElement('button'); find.type = 'button'; find.className = 'action-btn btn-primary'; find.textContent = 'En Kısa Yol Bul';
                find.onclick = () => target.value && tree.findPath(nodeAll.data, target.value); path.append(target, find); details.append(path);
            }
            if (mode === 'family') {
                const form = document.createElement('form');
                form.className = 'edit-form family-creation-form';
                form.noValidate = true;
                addFamilySelect(form, families, 'Kaynak aile');
                const root = document.createElement('p');
                root.className = 'family-creation-context';
                root.textContent = `Kök kişi: ${values.first_name} ${values.last_name}`.trim();
                const name = addInput(form, 'family_name' as keyof PersonFields, 'Yeni aile adı', 'text') as HTMLInputElement;
                name.required = true; name.maxLength = 200;
                const slug = addInput(form, 'family_slug' as keyof PersonFields, 'Adres kısa adı', 'text') as HTMLInputElement;
                slug.required = true; slug.maxLength = 100; slug.pattern = '[a-z0-9]+(?:-[a-z0-9]+)*';
                let slugEdited = false;
                name.addEventListener('input', () => { if (!slugEdited) slug.value = suggestFamilySlug(name.value); });
                slug.addEventListener('input', () => { slugEdited = true; familyCreationSubmitter.invalidate(); });
                form.addEventListener('input', () => familyCreationSubmitter.invalidate());
                const actions = document.createElement('div');
                actions.className = 'editor-actions';
                const cancel = document.createElement('button');
                cancel.type = 'button'; cancel.className = 'action-btn btn-secondary'; cancel.textContent = 'İptal';
                cancel.onclick = () => render('profile');
                const submit = document.createElement('button');
                submit.type = 'submit'; submit.className = 'action-btn btn-success'; submit.textContent = 'Öner';
                actions.append(cancel, submit);
                form.append(root, actions);
                const status = statusElement(form);
                let sending = false;
                form.onsubmit = async event => {
                    event.preventDefault();
                    if (sending) return;
                    const sourceFamilyId = (form.elements.namedItem('family_id') as HTMLSelectElement).value;
                    if (!form.checkValidity() || !sourceFamilyId) {
                        (form.querySelector(':invalid') as HTMLElement | null)?.focus();
                        status.textContent = sourceFamilyId ? 'Geçerli bir aile adı ve kısa ad girin.' : 'Görünür kaynak aile gereklidir.';
                        status.className = 'editor-status error';
                        return;
                    }
                    try {
                        sending = true; submit.disabled = true; status.className = 'editor-status'; status.textContent = 'Gönderiliyor…';
                        const result = await familyCreationSubmitter.send({
                            sourceFamilyId, rootPersonId: selectedId, name: name.value, slug: slug.value,
                        });
                        status.textContent = 'Aile önerisi gönderildi · Beklemede'; status.classList.add('success');
                        await context.onSubmitted(result);
                    } catch (error) {
                        status.textContent = error instanceof Error ? error.message : 'Gönderilemedi. Tekrar deneyin.';
                        status.className = 'editor-status error';
                    } finally { sending = false; submit.disabled = false; }
                };
                details.append(form);
                name.focus();
                return;
            }
            const form = document.createElement('form');
            form.className = 'edit-form';
            form.noValidate = true;
            addFamilySelect(form, families);
            if (mode === 'photo') addPhotoInput(form); else addPersonFields(form, mode === 'profile' ? values : { ...blankPerson(), last_name: values.last_name });
            if (mode === 'profile') {
                const partnership = graph.partnerships.filter(candidate => candidate.current_revision
                    && [candidate.person1_id, candidate.person2_id].includes(selectedId));
                const marriage = form.elements.namedItem('marriage') as HTMLInputElement;
                const family = form.elements.namedItem('family_id') as HTMLSelectElement;
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
            submit.textContent = mode === 'profile' ? 'Kaydet' : mode === 'spouse' ? 'Eş / partner ekle' : 'Çocuk ekle';
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
                const fields = readPerson(form);
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
                        if (mode === 'profile') return mapProfileEdit(graph, selectedId, currentFields, familyId);
                        if (mode === 'spouse') return mapSpouseEdit(graph, selectedId, currentFields, currentFields.marriage);
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
                    status.textContent = 'Değişiklik gönderildi · Beklemede';
                    status.classList.add('success');
                    await context.onSubmitted(result);
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

        render('profile');

        for (const related of tree.get_relationship_in_dag_all(nodeAll)) related.added_data.is_visible = true;
        tree.draw(true, nodeAll.data);
    };
}
