import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '../services/supabase/client';

type JsonObject = Record<string, unknown>;
type RevisionEntry = { base: JsonObject | null; current: JsonObject | null; proposed: JsonObject };
type AdminProfile = { is_admin: boolean };
type AdminDetail = {
    submission: JsonObject; family: JsonObject;
    family_creation?: { id: string; slug: string; name: string; source_family: JsonObject; root_person: JsonObject } | null;
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
    : typeof value === 'object' ? JSON.stringify(value) : String(value);

function rpcError(prefix: string, error: { message: string } | null) {
    if (!error) return;
    throw new Error(`${prefix}: ${error.message}`);
}

function finalizedStatus(error: unknown) {
    if (!(error instanceof Error)) return null;
    return error.message.match(/submission is already (approved|rejected|conflict)/i)?.[1].toLowerCase() ?? null;
}

export function googleRedirectTo(location: Pick<Location, 'origin' | 'pathname' | 'search'>) {
    return `${location.origin}${location.pathname}${location.search}`;
}

export async function signInWithGoogle() {
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: googleRedirectTo(window.location) },
    });
    rpcError('Google sign-in could not start', error);
}

export async function loadAdminProfile() {
    const { data, error } = await getSupabaseClient().rpc('get_admin_profile');
    rpcError('Admin access check failed', error);
    return data as unknown as AdminProfile;
}

export async function acceptAdminInvitation() {
    const { data, error } = await getSupabaseClient().rpc('accept_admin_invitation');
    rpcError('Admin invitation check failed', error);
    return data as unknown as { is_admin: boolean };
}

export async function loadAdminInvitations() {
    const { data, error } = await getSupabaseClient().rpc('list_admin_invitations');
    rpcError('Admin invitations could not be loaded', error);
    return data as unknown as AdminInvitation[];
}

export async function createAdminInvitation(email: string, expiresAt?: string) {
    const { data, error } = await getSupabaseClient().rpc('create_admin_invitation', {
        p_email: email, ...(expiresAt ? { p_expires_at: expiresAt } : {}),
    });
    rpcError('Admin invitation could not be created', error);
    return data as unknown as AdminInvitation;
}

export async function revokeAdminInvitation(id: string) {
    const { data, error } = await getSupabaseClient().rpc('revoke_admin_invitation', { p_invitation_id: id });
    rpcError('Admin invitation could not be revoked', error);
    return data as JsonObject;
}

export async function loadReviewQueue(cursor?: { created_at: string; id: string }) {
    const { data, error } = await getSupabaseClient().rpc('list_pending_admin_submissions', cursor ? {
        p_after_created_at: cursor.created_at, p_after_id: cursor.id,
    } : {});
    rpcError('Review queue could not be loaded', error);
    return data as unknown as QueuePage;
}

export async function loadReviewDetail(id: string) {
    const { data, error } = await getSupabaseClient().rpc('get_admin_submission', { p_submission_id: id });
    rpcError('Submission could not be loaded', error);
    return data as unknown as AdminDetail;
}

export async function moderateSubmission(id: string, decision: 'approve' | 'reject', note?: string) {
    const { data, error } = await getSupabaseClient().rpc(`${decision}_family_submission`, {
        p_submission_id: id, ...(note ? { p_review_note: note } : {}),
    });
    rpcError('Submission is stale or could not be reviewed', error);
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
    if (!available) cell.textContent = 'Unavailable';
    else if (link) {
        const safe = safeLink(value);
        if (safe) cell.append(safe); else cell.textContent = text(value);
    } else cell.textContent = text(value);
    return cell;
}

function row(label: string, base: JsonObject | null, current: JsonObject | null, proposed: JsonObject) {
    const item = document.createElement('div');
    item.className = 'admin-diff-row';
    item.setAttribute('role', 'row');
    const name = document.createElement('strong');
    name.textContent = label;
    name.setAttribute('role', 'rowheader');
    item.append(
        name,
        valueCell(base?.[label], base !== null, label === 'url'),
        valueCell(current?.[label], current !== null, label === 'url'),
        valueCell(proposed[label], true, label === 'url'),
    );
    return item;
}

function renderRevision(group: string, entry: RevisionEntry) {
    const { base, current, proposed } = entry;
    const section = document.createElement('section');
    section.className = 'admin-revision';
    const heading = document.createElement('h3');
    heading.textContent = group;
    const table = document.createElement('div');
    table.className = 'admin-diff';
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', `${group} revision comparison`);
    const columns = document.createElement('div');
    columns.className = 'admin-diff-headings';
    columns.setAttribute('role', 'row');
    for (const label of ['Field', 'Base at submission', 'Current approved', 'Proposed']) {
        const column = document.createElement('strong');
        column.setAttribute('role', 'columnheader');
        column.textContent = label;
        columns.append(column);
    }
    table.append(columns);
    const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(current ?? {}), ...Object.keys(proposed)]);
    for (const key of keys) {
        if (['reviewed_at', 'reviewed_by', 'submission_id'].includes(key)) continue;
        if (JSON.stringify(base?.[key]) !== JSON.stringify(proposed[key])
            || JSON.stringify(current?.[key]) !== JSON.stringify(proposed[key])) {
            table.append(row(key, base, current, proposed));
        }
    }
    section.append(heading, table);
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
    container.append(
        metadata('Aile', family.name),
        metadata('Gönderim', new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(submission.created_at)))),
        metadata('Gönderen', submission.submitter_name),
        metadata('İletişim', submission.submitter_contact),
        metadata('Not', submission.message),
    );
    if (detail.family_creation) {
        container.append(
            metadata('Önerilen aile', detail.family_creation.name),
            metadata('Kısa ad', detail.family_creation.slug),
            metadata('Kaynak aile', detail.family_creation.source_family.name),
            metadata('Kök kişi', detail.family_creation.root_person.display_name),
            metadata('Değişiklik', 'Yeni aile ve onaylı kök üyeliği'),
        );
    }
    for (const [group, value] of Object.entries(detail)) {
        if (!Array.isArray(value)) continue;
        for (const entry of value) container.append(renderRevision(group, entry as RevisionEntry));
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
                setStatus(error instanceof Error ? error.message : 'Google sign-in failed.', true);
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
                rpcError('Sign-out failed', error);
                dialog.close();
            } catch (error) {
                logout.disabled = false;
                setStatus(error instanceof Error ? error.message : 'Sign-out failed.', true);
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
                meta.textContent = `${invitation.status} · ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(invitation.expires_at))}`;
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
        for (const item of page.items) {
            const entry = document.createElement('button');
            entry.type = 'button';
            entry.className = 'admin-queue-item';
            entry.dataset.submissionId = item.id;
            const name = document.createElement('strong');
            name.textContent = item.proposed_family_name
                ? `${item.proposed_family_name} · ${item.family_name}`
                : item.family_name;
            const meta = document.createElement('span');
            meta.textContent = `${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))} · ${item.entity_count} değişiklik`;
            entry.append(name, meta);
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
                setStatus('Gönderim çakışma nedeniyle sonlandırıldı. Güncel ağacı inceleyip yeni bir öneri isteyin.', true);
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
            reason.id = 'admin-reject-reason'; reason.className = 'sidebar-input'; reason.placeholder = 'Red nedeni'; reason.required = true; reason.maxLength = 2000;
            const reject = document.createElement('button');
            reject.type = 'button'; reject.className = 'action-btn btn-danger'; reject.textContent = 'Reddet';
            reject.onclick = () => {
                const note = reason.value.trim();
                if (!note) { reason.focus(); setStatus('Red nedeni gereklidir.', true); return; }
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
        rpcError('Session restore failed', error);
        await applySession(data.session);
        if (oauthError) {
            dialog.showModal();
            setStatus(`Google sign-in failed: ${oauthError}`, true);
        }
    }).catch(error => {
        renderSignedOut();
        dialog.showModal();
        setStatus(error instanceof Error ? error.message : 'Session restore failed.', true);
    });
    getSupabaseClient().auth.onAuthStateChange((_event: AuthChangeEvent, next) => { void applySession(next); });
}
