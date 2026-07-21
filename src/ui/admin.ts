import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '../services/supabase/client';
import { store } from '../services/state/store';
import { localSupabaseUrl } from '../services/supabase/localUrl';
import { REMOVED_PHOTO_URL } from '../constants/media';

type JsonObject = Record<string, unknown>;
type RevisionEntry = { base: JsonObject | null; current: JsonObject | null; proposed: JsonObject };
type AdminProfile = { is_admin: boolean };
type AdminDetail = {
    submission: JsonObject; family: JsonObject;
    family_creation?: { id: string; slug: string; name: string; source_family: JsonObject; root_person: JsonObject } | null;
    person_merge?: {
        id: string; fields: JsonObject; source_fields: JsonObject; target_fields: JsonObject;
        source_person: { id: string; revision: JsonObject };
        target_person: { id: string; revision: JsonObject };
    } | null;
    people: RevisionEntry[]; events: RevisionEntry[]; partnerships: RevisionEntry[];
    parent_links: RevisionEntry[]; memberships: RevisionEntry[]; media: RevisionEntry[];
    sources: RevisionEntry[];
};
type QueueItem = {
    id: string; created_at: string; family_name: string; family_slug: string;
    status: string; message: string | null; submitter_name: string | null; entity_count: number;
    proposed_family_name?: string | null;
};
type QueuePage = { items: QueueItem[]; next_cursor: { created_at: string; id: string } | null };
type AdminInvitation = {
    id: string; email: string; status: 'pending' | 'accepted' | 'revoked' | 'expired';
    created_at: string; expires_at: string; accepted_at: string | null;
    revoked_at: string | null; expired_at: string | null;
};

const text = (value: unknown) => value == null || value === '' ? '—'
    : typeof value === 'boolean' ? value ? 'Evet' : 'Hayır'
        : typeof value === 'object' ? JSON.stringify(value) : String(value);

function rpcError(prefix: string, error: { message: string } | null) {
    if (!error) return;
    throw new Error(`${prefix}: ${error.message}`);
}

function finalizedStatus(error: unknown) {
    if (!(error instanceof Error)) return null;
    return error.message.match(/submission is already (approved|rejected|conflict)/i)?.[1].toLowerCase() ?? null;
}

export function moderationConflictMessage(reason: unknown) {
    if (reason === 'already_merged') return 'Bu kişiler daha önce birleştirilmiş. İkinci birleştirme isteği artık geçerli değil.';
    if (reason === 'people_changed') return 'Kişi kayıtları bu istekten sonra değişmiş. Güncel kayıtlarla yeni birleştirme isteği oluşturun.';
    return 'Gönderim çakışma nedeniyle sonlandırıldı. Güncel ağacı inceleyip yeni bir öneri isteyin.';
}

export function googleRedirectTo(location: Pick<Location, 'origin' | 'pathname' | 'search'>) {
    return `${location.origin}${location.pathname}${location.search}`;
}

export async function signInWithGoogle() {
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: googleRedirectTo(window.location) },
    });
    rpcError('Google ile giriş başlatılamadı', error);
}

export async function loadAdminProfile() {
    const { data, error } = await getSupabaseClient().rpc('get_admin_profile');
    rpcError('Yönetici yetkisi kontrol edilemedi', error);
    return data as unknown as AdminProfile;
}

export async function acceptAdminInvitation() {
    const { data, error } = await getSupabaseClient().rpc('accept_admin_invitation');
    rpcError('Yönetici daveti kontrol edilemedi', error);
    return data as unknown as { is_admin: boolean };
}

export async function loadAdminInvitations() {
    const { data, error } = await getSupabaseClient().rpc('list_admin_invitations');
    rpcError('Yönetici davetleri yüklenemedi', error);
    return data as unknown as AdminInvitation[];
}

export async function createAdminInvitation(email: string, expiresAt?: string) {
    const { data, error } = await getSupabaseClient().rpc('create_admin_invitation', {
        p_email: email, ...(expiresAt ? { p_expires_at: expiresAt } : {}),
    });
    rpcError('Yönetici daveti oluşturulamadı', error);
    return data as unknown as AdminInvitation;
}

export async function revokeAdminInvitation(id: string) {
    const { data, error } = await getSupabaseClient().rpc('revoke_admin_invitation', { p_invitation_id: id });
    rpcError('Yönetici daveti geri çekilemedi', error);
    return data as JsonObject;
}

export async function loadReviewQueue(cursor?: { created_at: string; id: string }) {
    const { data, error } = await getSupabaseClient().rpc('list_pending_admin_submissions', cursor ? {
        p_after_created_at: cursor.created_at, p_after_id: cursor.id,
    } : {});
    rpcError('İnceleme listesi yüklenemedi', error);
    return data as unknown as QueuePage;
}

export async function loadReviewDetail(id: string) {
    const { data, error } = await getSupabaseClient().rpc('get_admin_submission', { p_submission_id: id });
    rpcError('Gönderim yüklenemedi', error);
    return data as unknown as AdminDetail;
}

export async function moderateSubmission(id: string, decision: 'approve' | 'reject', note?: string) {
    const { data, error } = await getSupabaseClient().rpc(`${decision}_family_submission`, {
        p_submission_id: id, ...(note ? { p_review_note: note } : {}),
    });
    rpcError('Gönderim güncel değil veya incelenemedi', error);
    return data as JsonObject;
}

function safeLink(url: unknown) {
    if (typeof url !== 'string') return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return null;
        const link = document.createElement('a');
        link.href = parsed.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = parsed.href;
        return link;
    } catch { return null; }
}

function valueCell(value: unknown, available = true, link = false) {
    const cell = document.createElement('span');
    cell.setAttribute('role', 'cell');
    if (!available) cell.textContent = 'Yok';
    else if (link) {
        const safe = safeLink(value);
        if (safe) cell.append(safe); else cell.textContent = text(value);
    } else cell.textContent = text(value);
    return cell;
}

const labels: Record<string, string> = {
    display_name: 'Ad soyad', given_name: 'Ad', middle_names: 'İkinci ad', family_name: 'Soyad',
    aliases: 'Diğer adlar', gender: 'Cinsiyet', is_living: 'Yaşıyor',
    birth_date: 'Doğum tarihi', birthplace: 'Doğum yeri', death_date: 'Ölüm tarihi', death_place: 'Ölüm yeri',
    occupation: 'Meslek', summary: 'Not', certainty: 'Kesinlik',
    date_text: 'Tarih', place_text: 'Yer', details: 'Açıklama', relationship_type: 'İlişki',
    partnership_type: 'İlişki türü', status_text: 'Durum', url: 'Bağlantı', caption: 'Açıklama',
};

function row(label: string, base: JsonObject | null, current: JsonObject | null, proposed: JsonObject) {
    const item = document.createElement('div');
    item.className = 'admin-diff-row';
    item.setAttribute('role', 'row');
    const name = document.createElement('strong');
        name.textContent = labels[label] ?? label;
    name.setAttribute('role', 'rowheader');
    item.append(
        name,
        valueCell(base?.[label], base !== null, label === 'url'),
        valueCell(current?.[label], current !== null, label === 'url'),
        valueCell(proposed[label], true, label === 'url'),
    );
    return item;
}

function renderRevision(group: string, entry: RevisionEntry): HTMLElement | null {
    const { base, current, proposed } = entry;
    const section = document.createElement('section');
    section.className = 'admin-revision';
    const heading = document.createElement('h3');
    heading.textContent = ({ events: 'Olaylar', partnerships: 'Eşleşmeler', parent_links: 'Ebeveyn bağları', memberships: 'Aile üyelikleri' } as Record<string, string>)[group] ?? group;
    const table = document.createElement('div');
    table.className = 'admin-diff';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Değişiklik karşılaştırması');
    const columns = document.createElement('div');
    columns.className = 'admin-diff-headings';
    columns.setAttribute('role', 'row');
    for (const label of ['Alan', 'Eski', 'Mevcut', 'Yeni']) {
        const column = document.createElement('strong');
        column.setAttribute('role', 'columnheader');
        column.textContent = label;
        columns.append(column);
    }
    table.append(columns);
    const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(current ?? {}), ...Object.keys(proposed)]);
    let rowCount = 0;
    for (const key of keys) {
        if ([
            'id', 'status', 'created_at', 'base_revision_id',
            'reviewed_at', 'reviewed_by', 'submission_id',
            'person_id', 'partner_id', 'family_id', 'parent_id',
            'revoked_at', 'revoked_by', 'creator_id'
        ].includes(key)) continue;
        if (JSON.stringify(base?.[key]) !== JSON.stringify(proposed[key])
            || JSON.stringify(current?.[key]) !== JSON.stringify(proposed[key])) {
            table.append(row(key, base, current, proposed));
            rowCount++;
        }
    }
    if (rowCount === 0) return null;
    section.append(heading, table);
    return section;
}

function personName(value: JsonObject | null) {
    if (!value) return '—';
    return text(value.display_name ?? [value.given_name, value.family_name].filter(Boolean).join(' '));
}

function mediaUrl(value: JsonObject | null) {
    if (!value) return null;
    let url = value.url ?? value.legacy_uri ?? value.storage_path;
    if (typeof url === 'string') {
        url = localSupabaseUrl(url, 'http:');
    }
    return url;
}

function photo(value: JsonObject | null, old: boolean) {
    const wrap = document.createElement('div');
    wrap.className = `admin-photo ${old ? 'admin-photo-old' : 'admin-photo-new'}`;
    const url = mediaUrl(value);
    if (!old && url === REMOVED_PHOTO_URL) {
        wrap.textContent = 'Fotoğraf kaldırılacak';
    } else if (typeof url === 'string' && url.trim() !== '') {
        const image = document.createElement('img'); image.src = url; image.alt = old ? 'Eski fotoğraf' : 'Yeni fotoğraf'; wrap.append(image);
    } else wrap.textContent = 'Fotoğraf yok';
    if (old && value) { const mark = document.createElement('span'); mark.className = 'admin-photo-delete'; mark.textContent = '×'; mark.setAttribute('aria-label', 'Silinecek'); wrap.append(mark); }
    return wrap;
}

function renderPerson(entry: RevisionEntry) {
    const section = document.createElement('section'); section.className = 'admin-person-change';
    const old = entry.current ?? entry.base;
    const title = document.createElement('h3'); title.textContent = 'Kişi değişikliği'; section.append(title);
    const names = document.createElement('div'); names.className = 'admin-name-change';
    const oldNameStr = personName(old);
    const newNameStr = personName(entry.proposed);
    if (oldNameStr === newNameStr) {
        const nameNode = document.createElement('span');
        nameNode.style.fontWeight = '700';
        nameNode.textContent = oldNameStr;
        names.append(nameNode);
    } else {
        const oldName = document.createElement('del'); oldName.textContent = oldNameStr;
        const newName = document.createElement('strong'); newName.textContent = newNameStr;
        names.append(oldName, newName);
    }
    section.append(names);
    const fields = document.createElement('div'); fields.className = 'admin-person-fields';
    for (const key of ['gender', 'birth_date', 'birthplace', 'death_date', 'death_place', 'occupation', 'summary']) {
        if (JSON.stringify(old?.[key]) === JSON.stringify(entry.proposed[key])) continue;
        const line = document.createElement('div'); line.append(document.createElement('span'));
        line.firstChild!.textContent = labels[key] ?? key;
        line.append(valueCell(old?.[key], old !== null), valueCell(entry.proposed[key])); fields.append(line);
    }
    if (fields.childElementCount) section.append(fields);
    return section;
}

function renderMedia(entry: RevisionEntry) {
    const section = document.createElement('section'); section.className = 'admin-media-change';
    const title = document.createElement('h3'); title.textContent = 'Fotoğraf değişikliği'; section.append(title);
    const comparison = document.createElement('div'); comparison.className = 'admin-photo-comparison';
    comparison.append(photo(entry.current ?? entry.base, true), document.createTextNode('→'), photo(entry.proposed, false));
    section.append(comparison); return section;
}

function renderPersonMerge(merge: NonNullable<AdminDetail['person_merge']>) {
    const section = document.createElement('section'); section.className = 'admin-revision';
    const title = document.createElement('h3'); title.textContent = 'Kişi birleştirme';
    const names = document.createElement('p');
    names.textContent = `${text(merge.source_person.revision.display_name)} → ${text(merge.target_person.revision.display_name)}`;
    const table = document.createElement('div'); table.className = 'admin-diff'; table.setAttribute('role', 'table');
    const headings = document.createElement('div'); headings.className = 'admin-diff-headings'; headings.setAttribute('role', 'row');
    for (const label of ['Alan', 'Kaynak kayıt', 'Korunacak kayıt', 'Birleşmiş değer']) {
        const heading = document.createElement('strong'); heading.setAttribute('role', 'columnheader'); heading.textContent = label; headings.append(heading);
    }
    table.append(headings);
    for (const key of Object.keys(merge.fields)) {
        const item = document.createElement('div'); item.className = 'admin-diff-row'; item.setAttribute('role', 'row');
        const name = document.createElement('strong'); name.setAttribute('role', 'rowheader'); name.textContent = labels[key] ?? key;
        item.append(name, valueCell(merge.source_fields[key]), valueCell(merge.target_fields[key]), valueCell(merge.fields[key]));
        table.append(item);
    }
    section.append(title, names, table);
    return section;
}

export function renderAdminDetail(container: HTMLElement, detail: AdminDetail) {
    container.replaceChildren();
    const { submission, family } = detail;
    const metadata = (label: string, value: unknown) => {
        const item = document.createElement('p');
        const name = document.createElement('strong');
        name.textContent = `${label}: `;
        item.append(name, document.createTextNode(text(value)));
        return item;
    };
    container.append(metadata('Aile', family.name));
    if (submission.submitter_name || submission.message) container.append(metadata('Gönderen', submission.submitter_name ?? submission.message));
    if (detail.family_creation) {
        container.append(
            metadata('Önerilen aile', detail.family_creation.name),
            metadata('Kısa ad', detail.family_creation.slug),
            metadata('Kaynak aile', detail.family_creation.source_family.name),
            metadata('Aileye eklenecek kişi', detail.family_creation.root_person.display_name),
            metadata('Değişiklik', 'Yeni aile ve onaylı kök üyeliği'),
        );
    }
    if (detail.person_merge) container.append(renderPersonMerge(detail.person_merge));
    for (const entry of detail.people) container.append(renderPerson(entry));
    for (const entry of detail.media) container.append(renderMedia(entry));
    for (const [group, value] of Object.entries(detail)) {
        if (!Array.isArray(value)) continue;
        if (group === 'people' || group === 'media' || group === 'sources') continue;
        for (const entry of value) {
            const section = renderRevision(group, entry as RevisionEntry);
            if (section) container.append(section);
        }
    }
}

export function initAdminReview(onPublicRefresh: () => Promise<void>) {
    const button = document.getElementById('admin-btn') as HTMLButtonElement | null;
    const dialog = document.getElementById('admin-dialog') as HTMLDialogElement | null;
    const title = document.getElementById('admin-title');
    const status = document.getElementById('admin-status');
    const content = document.getElementById('admin-content');
    const actions = document.getElementById('admin-actions');
    if (!button || !dialog || !title || !status || !content || !actions) return;
    let session: Session | null = null;
    let isAdmin = false;
    let selectedId: string | null = null;
    let busy = false;
    let acceptanceUserId: string | null = null;
    const setAdminButton = () => {
        document.body.classList.toggle('is-admin', isAdmin);
        button.textContent = '⚙️';
        button.title = isAdmin ? 'Yönetim' : 'Yönetici girişi';
        button.setAttribute('aria-label', button.title);
    };

    const setStatus = (message: string, error = false) => {
        status.textContent = message;
        status.classList.toggle('error', error);
    };
    const renderSignedOut = () => {
        isAdmin = false;
        acceptanceUserId = null;
        setAdminButton();
        title.textContent = 'Yönetici girişi';
        content.replaceChildren();
        actions.replaceChildren();
        const signIn = document.createElement('button');
        signIn.type = 'button';
        signIn.className = 'action-btn btn-primary';
        signIn.textContent = 'Google ile giriş yap';
        signIn.onclick = async () => {
            signIn.disabled = true;
            try { await signInWithGoogle(); } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Google ile giriş yapılamadı.', true);
                signIn.disabled = false;
            }
        };
        content.append(signIn);
        setStatus('');
    };
    const logoutButton = () => {
        const logout = document.createElement('button');
        logout.type = 'button';
        logout.className = 'action-btn btn-secondary';
        logout.textContent = 'Çıkış yap';
        logout.onclick = async () => {
            logout.disabled = true;
            try {
                const { error } = await getSupabaseClient().auth.signOut();
                rpcError('Çıkış yapılamadı', error);
                dialog.close();
            } catch (error) {
                logout.disabled = false;
                setStatus(error instanceof Error ? error.message : 'Çıkış yapılamadı.', true);
            }
        };
        return logout;
    };
    const viewTabs = (active: 'reviews' | 'invitations') => {
        const tabs = document.createElement('div');
        tabs.className = 'admin-tabs';
        tabs.setAttribute('role', 'tablist');
        for (const [view, label] of [['reviews', 'Gönderimler'], ['invitations', 'Davetler']] as const) {
            const tab = document.createElement('button');
            tab.type = 'button'; tab.className = 'action-btn btn-secondary'; tab.textContent = label;
            tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(view === active));
            tab.onclick = () => void (view === 'reviews' ? loadQueue() : showInvitations());
            tabs.append(tab);
        }
        return tabs;
    };
    const showInvitations = async () => {
        selectedId = null;
        actions.replaceChildren(logoutButton());
        content.replaceChildren(viewTabs('invitations'));
        setStatus('Yönetici davetleri yükleniyor…');
        try {
            const invitations = await loadAdminInvitations();
            const form = document.createElement('form');
            form.className = 'admin-invite-form';
            const emailLabel = document.createElement('label');
            emailLabel.htmlFor = 'admin-invite-email'; emailLabel.textContent = 'E-posta';
            const email = document.createElement('input');
            email.id = 'admin-invite-email'; email.className = 'sidebar-input'; email.type = 'email';
            email.required = true; email.maxLength = 254; email.autocomplete = 'off';
            const expiryLabel = document.createElement('label');
            expiryLabel.htmlFor = 'admin-invite-expiry'; expiryLabel.textContent = 'Son kullanma (isteğe bağlı)';
            const expiry = document.createElement('input');
            expiry.id = 'admin-invite-expiry'; expiry.className = 'sidebar-input'; expiry.type = 'datetime-local';
            const submit = document.createElement('button');
            submit.type = 'submit'; submit.className = 'action-btn btn-primary'; submit.textContent = 'Davet et';
            form.append(emailLabel, email, expiryLabel, expiry, submit);
            form.onsubmit = async event => {
                event.preventDefault();
                if (!email.validity.valid) { email.focus(); setStatus('Geçerli bir e-posta girin.', true); return; }
                if (expiry.value && !expiry.validity.valid) { expiry.focus(); setStatus('Geçerli bir son kullanma tarihi girin.', true); return; }
                submit.disabled = true;
                try {
                    await createAdminInvitation(email.value, expiry.value ? new Date(expiry.value).toISOString() : undefined);
                    await showInvitations();
                    setStatus('Yönetici daveti hazır.');
                } catch (error) {
                    submit.disabled = false;
                    setStatus(error instanceof Error ? error.message : 'Davet oluşturulamadı.', true);
                }
            };
            content.append(form);
            const list = document.createElement('div');
            list.className = 'admin-invite-list';
            for (const invitation of invitations) {
                const row = document.createElement('div');
                row.className = 'admin-invite-item';
                const details = document.createElement('div');
                const address = document.createElement('strong'); address.textContent = invitation.email;
                const meta = document.createElement('span');
                meta.textContent = ({ pending: 'Bekliyor', accepted: 'Kabul edildi', revoked: 'Geri çekildi', expired: 'Süresi doldu' } as Record<string, string>)[invitation.status];
                details.append(address, meta); row.append(details);
                if (invitation.status === 'pending') {
                    const revoke = document.createElement('button');
                    revoke.type = 'button'; revoke.className = 'action-btn btn-danger'; revoke.textContent = 'Geri çek';
                    revoke.setAttribute('aria-label', `${invitation.email} davetini geri çek`);
                    revoke.onclick = async () => {
                        if (busy) return;
                        busy = true; revoke.disabled = true;
                        try { await revokeAdminInvitation(invitation.id); await showInvitations(); setStatus('Davet geri çekildi.'); }
                        catch (error) { revoke.disabled = false; setStatus(error instanceof Error ? error.message : 'Davet geri çekilemedi.', true); }
                        finally { busy = false; }
                    };
                    row.append(revoke);
                }
                list.append(row);
            }
            content.append(list);
            setStatus(invitations.length ? `${invitations.length} yönetici daveti` : 'Henüz yönetici daveti yok.');
        } catch (error) { setStatus(error instanceof Error ? error.message : 'Davetler yüklenemedi.', true); }
    };
    const loadQueue = async (cursor?: { created_at: string; id: string }) => {
        selectedId = null;
        if (!cursor) {
            actions.replaceChildren(logoutButton());
            content.replaceChildren();
            content.append(viewTabs('reviews'));
        }
        setStatus('Bekleyen gönderimler yükleniyor…');
        const page = await loadReviewQueue(cursor);
        const detailsMap = new Map<string, AdminDetail>();
        await Promise.all(page.items.map(async (item) => {
            try {
                const detail = await loadReviewDetail(item.id);
                detailsMap.set(item.id, detail);
            } catch (error) {
                console.error(`Failed to load details for submission ${item.id}`, error);
            }
        }));

        for (const item of page.items) {
            const detail = detailsMap.get(item.id);
            const entry = document.createElement('button');
            entry.type = 'button';
            entry.className = 'admin-queue-item';
            entry.dataset.submissionId = item.id;

            const textWrap = document.createElement('div');
            textWrap.className = 'admin-queue-item-text';

            const name = document.createElement('strong');
            name.className = 'admin-queue-item-title';

            let titleText = '';
            let subtitleText = '';

            if (item.proposed_family_name) {
                titleText = `${item.proposed_family_name} · ${item.family_name}`;
            } else {
                const primaryPerson = detail?.people?.[0]?.proposed ?? detail?.family_creation?.root_person;
                if (primaryPerson) {
                    const pName = personName(primaryPerson);
                    const birthDate = typeof primaryPerson.birth_date === 'string' ? primaryPerson.birth_date.trim() : '';
                    const birthSuffix = birthDate ? ` (d. ${birthDate})` : '';
                    titleText = `${pName}${birthSuffix}`;

                    // Try to find the father's name
                    const personId = primaryPerson.person_id ?? primaryPerson.id;
                    const parentIds = new Set<string>();

                    if (detail?.parent_links) {
                        for (const link of detail.parent_links) {
                            if (link.proposed.child_id === personId && link.proposed.parent_id) {
                                parentIds.add(link.proposed.parent_id as string);
                            }
                        }
                    }

                    const fullData = store.getState().fullFamilyData;
                    if (fullData?.links) {
                        for (const [source, target] of fullData.links) {
                            if (target === personId) {
                                parentIds.add(source);
                            }
                        }
                    }

                    let fatherName = '';
                    for (const parentId of parentIds) {
                        const parentInSubmission = detail?.people?.find(p => (p.proposed.person_id ?? p.proposed.id) === parentId);
                        if (parentInSubmission && parentInSubmission.proposed.gender === 'E') {
                            fatherName = personName(parentInSubmission.proposed);
                            break;
                        }
                        const parentInStore = fullData?.members[parentId];
                        if (parentInStore && parentInStore.gender === 'E') {
                            fatherName = parentInStore.display_name ?? [parentInStore.first_name, parentInStore.last_name].filter(Boolean).join(' ');
                            break;
                        }
                    }

                    if (fatherName) {
                        subtitleText = `Baba adı: ${fatherName}`;
                    }
                } else {
                    titleText = item.family_name;
                }
            }

            name.textContent = titleText;
            textWrap.append(name);

            if (subtitleText) {
                const subtitle = document.createElement('span');
                subtitle.className = 'admin-queue-item-subtitle';
                subtitle.textContent = subtitleText;
                textWrap.append(subtitle);
            }

            const meta = document.createElement('span');
            meta.className = 'admin-queue-item-badge';
            meta.textContent = `${item.entity_count} değişiklik`;

            entry.append(textWrap, meta);
            entry.onclick = () => void showDetail(item.id);
            content.append(entry);
        }
        if (page.next_cursor) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'action-btn btn-secondary admin-load-more';
            more.textContent = 'Daha fazla yükle';
            more.onclick = async () => {
                more.disabled = true;
                try { more.remove(); await loadQueue(page.next_cursor!); }
                catch (error) {
                    more.disabled = false;
                    content.append(more);
                    setStatus(error instanceof Error ? error.message : 'Gönderimler yüklenemedi.', true);
                }
            };
            content.append(more);
        }
        const count = content.querySelectorAll('.admin-queue-item').length;
        setStatus(count ? `${count} bekleyen gönderim` : 'Bekleyen gönderim yok.');
    };
    const runAction = async (decision: 'approve' | 'reject', note?: string) => {
        if (!selectedId || busy) return;
        busy = true;
        let retryable = false;
        for (const control of actions.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea')) control.disabled = true;
        setStatus(decision === 'approve' ? 'Onaylanıyor…' : 'Reddediliyor…');
        try {
            const result = await moderateSubmission(selectedId, decision, note);
            await Promise.all([loadQueue(), onPublicRefresh()]);
            if (result.status === 'conflict') {
                setStatus(moderationConflictMessage(result.conflict_reason), true);
            }
        } catch (error) {
            const finalized = finalizedStatus(error);
            if (finalized) {
                let refreshed = true;
                try { await Promise.all([loadQueue(), onPublicRefresh()]); }
                catch { refreshed = false; }
                setStatus(
                    `Gönderim daha önce ${finalized} olarak sonlandırılmış. ${refreshed ? 'Liste ve ağaç yenilendi.' : 'Sayfayı yenileyerek güncel durumu kontrol edin.'}`,
                    true,
                );
            } else {
                retryable = true;
                setStatus(error instanceof Error ? error.message : 'İnceleme tamamlanamadı.', true);
            }
        } finally {
            busy = false;
            if (retryable) {
                for (const control of actions.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea')) control.disabled = false;
            }
        }
    };
    const showDetail = async (id: string) => {
        selectedId = id;
        setStatus('Gönderim yükleniyor…');
        try {
            const detail = await loadReviewDetail(id);
            renderAdminDetail(content, detail);
            actions.replaceChildren();
            const approve = document.createElement('button');
            approve.type = 'button'; approve.className = 'action-btn btn-success'; approve.textContent = 'Onayla';
            approve.onclick = () => { if (window.confirm('Bu gönderimin tamamını onaylıyor musunuz?')) void runAction('approve'); };
            const reasonLabel = document.createElement('label');
            reasonLabel.className = 'admin-reject-label';
            reasonLabel.htmlFor = 'admin-reject-reason';
            reasonLabel.textContent = 'Red nedeni';
            const reason = document.createElement('textarea');
            reason.id = 'admin-reject-reason'; reason.className = 'sidebar-input'; reason.placeholder = 'Red nedeni (isteğe bağlı)'; reason.maxLength = 2000;
            const reject = document.createElement('button');
            reject.type = 'button'; reject.className = 'action-btn btn-danger'; reject.textContent = 'Reddet';
            reject.onclick = () => {
                const note = reason.value.trim();
                void runAction('reject', note);
            };
            const back = document.createElement('button');
            back.type = 'button'; back.className = 'action-btn btn-secondary'; back.textContent = 'Listeye dön'; back.onclick = () => void loadQueue();
            actions.append(reasonLabel, reason, approve, reject, back, logoutButton());
            setStatus('Önerilen ve onaylı değerleri karşılaştırın.');
        } catch (error) { setStatus(error instanceof Error ? error.message : 'Gönderim yüklenemedi.', true); }
    };
    const applySession = async (next: Session | null) => {
        session = next;
        if (!session) { renderSignedOut(); return; }
        setAdminButton();
        try {
            let acceptanceError: unknown = null;
            if (acceptanceUserId !== session.user.id) {
                acceptanceUserId = session.user.id;
                try { await acceptAdminInvitation(); } catch (error) { acceptanceError = error; }
            }
            const profile = await loadAdminProfile();
            isAdmin = profile.is_admin === true;
            setAdminButton();
            if (!isAdmin) {
                title.textContent = 'Yetki yok';
                content.textContent = 'Bu Google hesabı etkin bir yönetici değil.';
                actions.replaceChildren(logoutButton());
                setStatus(acceptanceError instanceof Error ? acceptanceError.message : '', Boolean(acceptanceError));
                return;
            }
            title.textContent = 'Gönderim inceleme';
            await loadQueue();
        } catch (error) {
            isAdmin = false;
            content.replaceChildren();
            actions.replaceChildren(logoutButton());
            setStatus(error instanceof Error ? error.message : 'Yönetici oturumu doğrulanamadı.', true);
        }
    };
    button.onclick = () => {
        if (!dialog.open) dialog.showModal();
        if (session && isAdmin && !selectedId) void loadQueue();
    };
    dialog.querySelector<HTMLButtonElement>('.close-btn')!.onclick = () => dialog.close();
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    const oauthError = new URLSearchParams(window.location.search).get('error_description');
    getSupabaseClient().auth.getSession().then(async ({ data, error }) => {
            rpcError('Oturum geri yüklenemedi', error);
        await applySession(data.session);
        if (oauthError) {
            dialog.showModal();
            setStatus(`Google ile giriş yapılamadı: ${oauthError}`, true);
        }
    }).catch(error => {
        renderSignedOut();
        dialog.showModal();
        setStatus(error instanceof Error ? error.message : 'Oturum geri yüklenemedi.', true);
    });
    getSupabaseClient().auth.onAuthStateChange((_event: AuthChangeEvent, next) => { void applySession(next); });
}
