import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/services/supabase/client';
import {
    googleRedirectTo, initAdminReview, renderAdminDetail, signInWithGoogle,
} from '../src/ui/admin';

vi.mock('../src/services/supabase/client', () => ({ getSupabaseClient: vi.fn() }));

const rpc = vi.fn();
const auth = {
    signInWithOAuth: vi.fn(), signOut: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(),
};

function shell() {
    document.body.innerHTML = `
        <button id="admin-btn">Yönetim</button>
        <dialog id="admin-dialog"><button class="close-btn">Kapat</button><h2 id="admin-title"></h2>
        <div id="admin-status"></div><div id="admin-content"></div><div id="admin-actions"></div></dialog>`;
    const dialog = document.getElementById('admin-dialog') as HTMLDialogElement;
    dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
    dialog.close = vi.fn(() => dialog.removeAttribute('open'));
}

const detail = {
    submission: { id: 'submission-1', created_at: '2026-07-17T12:00:00Z', submitter_name: '<img onerror=alert(1)>', submitter_contact: null, message: 'Review' },
    family: { name: 'Example' },
    family_creation: {
        id: 'creation-1', slug: 'safe-family', name: '<img onerror=alert(1)>',
        source_family: { id: 'family-1', name: 'Example' },
        root_person: { id: 'person-1', display_name: '<script>alert(2)</script>' },
    },
    people: [{
        base: { id: 'base-1', display_name: 'Base' },
        current: { id: 'current-1', display_name: 'Current' },
        proposed: { id: 'person-1', display_name: '<script>alert(1)</script>' },
    }],
    events: [], partnerships: [], parent_links: [], memberships: [], media: [],
    sources: [
        { base: null, current: null, proposed: { title: '<b>Source</b>', url: 'https://example.invalid/source', citation: 'Citation' } },
        { base: null, current: null, proposed: { title: 'Unsafe', url: 'javascript:alert(1)', citation: null } },
    ],
};

describe('Google admin auth and review UI', () => {
    beforeEach(() => {
        shell();
        history.replaceState(null, '', '/');
        vi.clearAllMocks();
        vi.mocked(getSupabaseClient).mockReturnValue({ auth, rpc } as never);
        auth.signInWithOAuth.mockResolvedValue({ error: null });
        auth.signOut.mockResolvedValue({ error: null });
        auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
        auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    });

    afterEach(() => vi.restoreAllMocks());

    it('starts only Google OAuth with the current origin and path', async () => {
        expect(googleRedirectTo({
            origin: 'https://example.test', pathname: '/nested/aile/',
            search: '?family=alpha&family=beta&mode=proposal', hash: '#person',
        } as Location)).toBe('https://example.test/nested/aile/?family=alpha&family=beta&mode=proposal');
        await signInWithGoogle();
        expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'http://localhost:3000/' } });
    });

    it('shows OAuth and session errors without logging errors or callback tokens', async () => {
        const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
        history.replaceState(null, '', '/?error_description=OAuth%20denied&access_token=secret-token');
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.getElementById('admin-status')?.textContent).toContain('OAuth denied'));
        expect(document.body.textContent).not.toContain('secret-token');
        expect(logs.every(log => log.mock.calls.length === 0)).toBe(true);

        shell();
        auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Session unavailable' } });
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.getElementById('admin-status')?.textContent).toContain('Session unavailable'));
        expect(logs.every(log => log.mock.calls.length === 0)).toBe(true);
    });

    it('restores an admin session, loads queue/detail, dedupes approval, and refreshes public data', async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } });
        rpc.mockImplementation((name: string) => {
            if (name === 'get_admin_profile') return Promise.resolve({ data: { is_admin: true }, error: null });
            if (name === 'list_pending_admin_submissions') return Promise.resolve({ data: { items: [{ id: 'submission-1', created_at: '2026-07-17T12:00:00Z', family_name: 'Example', family_slug: 'example', proposed_family_name: '<New Family>', status: 'pending', message: null, submitter_name: null, entity_count: 1 }], next_cursor: null }, error: null });
            if (name === 'get_admin_submission') return Promise.resolve({ data: detail, error: null });
            return Promise.resolve({ data: { status: 'approved' }, error: null });
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        initAdminReview(refresh);
        await vi.waitFor(() => expect(document.querySelector('.admin-queue-item')).not.toBeNull());
        expect(document.querySelector('.admin-queue-item')?.textContent).toContain('<New Family> · Example');
        expect(rpc.mock.calls.slice(0, 2).map(([name]) => name)).toEqual(['accept_admin_invitation', 'get_admin_profile']);
        (document.querySelector('.admin-queue-item') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.querySelector('.btn-success')).not.toBeNull());
        expect(document.querySelector('#admin-content img,#admin-content script')).toBeNull();
        expect(document.getElementById('admin-content')?.textContent).toContain('<img onerror=alert(1)>');
        expect(document.getElementById('admin-content')?.textContent).toContain('<script>alert(2)</script>');
        const reason = document.getElementById('admin-reject-reason') as HTMLTextAreaElement;
        const reasonLabel = document.querySelector('.admin-reject-label') as HTMLLabelElement;
        expect(reasonLabel.textContent).toBe('Red nedeni');
        expect(reasonLabel.htmlFor).toBe(reason.id);
        (document.querySelector('.btn-danger') as HTMLButtonElement).click();
        expect(document.activeElement).toBe(reason);
        const approve = document.querySelector('.btn-success') as HTMLButtonElement;
        approve.click(); approve.click();
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        expect(rpc.mock.calls.filter(([name]) => name === 'approve_family_submission')).toHaveLength(1);
    });

    it('appends cursor pages without relying on a global queue count', async () => {
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } });
        rpc.mockImplementation((name: string, args?: Record<string, string>) => {
            if (name === 'get_admin_profile') return Promise.resolve({ data: { is_admin: true }, error: null });
            if (name === 'list_pending_admin_submissions') return Promise.resolve({
                data: args?.p_after_id
                    ? { items: [{ id: 'owned-2', created_at: '2026-07-17T12:01:00Z', family_name: 'Second', family_slug: 'second', status: 'pending', message: null, submitter_name: null, entity_count: 1 }], next_cursor: null }
                    : { items: [{ id: 'owned-1', created_at: '2026-07-17T12:00:00Z', family_name: 'First', family_slug: 'first', status: 'pending', message: null, submitter_name: null, entity_count: 1 }], next_cursor: { created_at: '2026-07-17T12:00:00Z', id: 'owned-1' } },
                error: null,
            });
        });
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.querySelector('.admin-load-more')).not.toBeNull());
        (document.querySelector('.admin-load-more') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.querySelectorAll('.admin-queue-item')).toHaveLength(2));
        expect(document.querySelector('.admin-queue-item')?.textContent).toContain('1 değişiklik');
        expect([...document.querySelectorAll<HTMLElement>('.admin-queue-item')].map(item => item.dataset.submissionId)).toEqual(['owned-1', 'owned-2']);
        expect(rpc).toHaveBeenCalledWith('list_pending_admin_submissions', {
            p_after_created_at: '2026-07-17T12:00:00Z', p_after_id: 'owned-1',
        });
    });

    it('finalizes conflicts, refreshes queue and graph, and removes moderation controls', async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } });
        let queueLoads = 0;
        rpc.mockImplementation((name: string) => {
            if (name === 'get_admin_profile') return Promise.resolve({ data: { is_admin: true }, error: null });
            if (name === 'list_pending_admin_submissions') {
                queueLoads++;
                return Promise.resolve({ data: { items: queueLoads === 1 ? [{ id: 'stale-1', created_at: '2026-07-17T12:00:00Z', family_name: 'Example', family_slug: 'example', status: 'pending', message: null, submitter_name: null, entity_count: 1 }] : [], next_cursor: null }, error: null });
            }
            if (name === 'get_admin_submission') return Promise.resolve({ data: detail, error: null });
            return Promise.resolve({ data: { status: 'conflict' }, error: null });
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        initAdminReview(refresh);
        await vi.waitFor(() => expect(document.querySelector('.admin-queue-item')).not.toBeNull());
        (document.querySelector('.admin-queue-item') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.querySelector('.btn-success')).not.toBeNull());
        (document.querySelector('.btn-success') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.getElementById('admin-status')?.textContent).toContain('çakışma nedeniyle sonlandırıldı'));
        expect(refresh).toHaveBeenCalledOnce();
        expect(queueLoads).toBe(2);
        expect(document.querySelector('.btn-success,.btn-danger')).toBeNull();
    });

    it.each(['approved', 'rejected', 'conflict'])('refreshes and closes stale detail when the submission is already %s', async state => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } });
        let queueLoads = 0;
        rpc.mockImplementation((name: string) => {
            if (name === 'get_admin_profile') return Promise.resolve({ data: { is_admin: true }, error: null });
            if (name === 'list_pending_admin_submissions') {
                queueLoads++;
                return Promise.resolve({ data: { items: queueLoads === 1 ? [{ id: 'stale-1', created_at: '2026-07-17T12:00:00Z', family_name: 'Example', family_slug: 'example', status: 'pending', message: null, submitter_name: null, entity_count: 1 }] : [], next_cursor: null }, error: null });
            }
            if (name === 'get_admin_submission') return Promise.resolve({ data: detail, error: null });
            return Promise.resolve({ data: null, error: { message: `submission is already ${state}` } });
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        initAdminReview(refresh);
        await vi.waitFor(() => expect(document.querySelector('.admin-queue-item')).not.toBeNull());
        (document.querySelector('.admin-queue-item') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.querySelector('.btn-success')).not.toBeNull());
        (document.querySelector('.btn-success') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.getElementById('admin-status')?.textContent).toContain(`daha önce ${state}`));
        expect(refresh).toHaveBeenCalledOnce();
        expect(queueLoads).toBe(2);
        expect(document.querySelector('.btn-success,.btn-danger')).toBeNull();
    });

    it('keeps moderation controls retryable after a transient RPC failure', async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } });
        let queueLoads = 0;
        rpc.mockImplementation((name: string) => {
            if (name === 'get_admin_profile') return Promise.resolve({ data: { is_admin: true }, error: null });
            if (name === 'list_pending_admin_submissions') {
                queueLoads++;
                return Promise.resolve({ data: { items: [{ id: 'retry-1', created_at: '2026-07-17T12:00:00Z', family_name: 'Example', family_slug: 'example', status: 'pending', message: null, submitter_name: null, entity_count: 1 }], next_cursor: null }, error: null });
            }
            if (name === 'get_admin_submission') return Promise.resolve({ data: detail, error: null });
            return Promise.resolve({ data: null, error: { message: 'Network unavailable' } });
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        initAdminReview(refresh);
        await vi.waitFor(() => expect(document.querySelector('.admin-queue-item')).not.toBeNull());
        (document.querySelector('.admin-queue-item') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.querySelector('.btn-success')).not.toBeNull());
        (document.querySelector('.btn-success') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(document.getElementById('admin-status')?.textContent).toContain('Network unavailable'));
        expect(refresh).not.toHaveBeenCalled();
        expect(queueLoads).toBe(1);
        expect((document.querySelector('.btn-success') as HTMLButtonElement).disabled).toBe(false);
        expect((document.querySelector('.btn-danger') as HTMLButtonElement).disabled).toBe(false);
    });

    it('requires a reject reason and gives a non-admin no review details', async () => {
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } } });
        rpc.mockImplementation((name: string) => name === 'get_admin_profile'
            ? Promise.resolve({ data: { is_admin: false }, error: null })
            : Promise.resolve({ data: null, error: new Error('should not load') }));
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.getElementById('admin-content')?.textContent).toContain('etkin bir yönetici değil'));
        expect(rpc.mock.calls.map(([name]) => name)).toEqual(['accept_admin_invitation', 'get_admin_profile']);
        expect(document.getElementById('admin-actions')?.textContent).toContain('Çıkış yap');
    });

    it('auto-accepts an invited Google session before loading the admin profile', async () => {
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'invited' } } }, error: null });
        let accepted = false;
        rpc.mockImplementation((name: string) => {
            if (name === 'accept_admin_invitation') { accepted = true; return Promise.resolve({ data: { is_admin: true }, error: null }); }
            if (name === 'get_admin_profile') return Promise.resolve({ data: { is_admin: accepted }, error: null });
            return Promise.resolve({ data: { items: [], next_cursor: null }, error: null });
        });
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.querySelector('[role="tab"]')?.textContent).toBe('Gönderimler'));
        expect(rpc.mock.calls.map(([name]) => name)).toEqual([
            'accept_admin_invitation', 'get_admin_profile', 'list_pending_admin_submissions',
        ]);
        expect(document.getElementById('admin-content')?.textContent).not.toContain('etkin bir yönetici değil');
    });

    it('creates, safely lists, and dedupes revocation of admin invitations', async () => {
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } }, error: null });
        const invitation = {
            id: 'invite-1', email: '<script>@example.invalid', status: 'pending',
            created_at: '2026-07-17T12:00:00Z', expires_at: '2026-07-24T12:00:00Z',
            accepted_at: null, revoked_at: null, expired_at: null,
        };
        rpc.mockImplementation((name: string) => {
            if (name === 'get_admin_profile' || name === 'accept_admin_invitation') return Promise.resolve({ data: { is_admin: true }, error: null });
            if (name === 'list_pending_admin_submissions') return Promise.resolve({ data: { items: [], next_cursor: null }, error: null });
            if (name === 'list_admin_invitations') return Promise.resolve({ data: [invitation], error: null });
            return Promise.resolve({ data: invitation, error: null });
        });
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2));
        ([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Davetler')!).click();
        await vi.waitFor(() => expect(document.querySelector('.admin-invite-item')).not.toBeNull());
        expect(document.querySelector('.admin-invite-item script')).toBeNull();
        expect(document.querySelector('.admin-invite-item')?.textContent).toContain('<script>@example.invalid');
        const email = document.getElementById('admin-invite-email') as HTMLInputElement;
        const form = email.form!;
        email.value = 'new-admin@example.invalid';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('create_admin_invitation', { p_email: 'new-admin@example.invalid' }));
        const revoke = document.querySelector('.admin-invite-item .btn-danger') as HTMLButtonElement;
        revoke.click(); revoke.click();
        await vi.waitFor(() => expect(rpc.mock.calls.filter(([name]) => name === 'revoke_admin_invitation')).toHaveLength(1));
        await vi.waitFor(() => expect(document.querySelector('label[for="admin-invite-email"]')?.textContent).toBe('E-posta'));
    });

    it('focuses invalid invitation input and keeps creation retryable after an RPC error', async () => {
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'admin' } } }, error: null });
        rpc.mockImplementation((name: string) => {
            if (name === 'get_admin_profile' || name === 'accept_admin_invitation') return Promise.resolve({ data: { is_admin: true }, error: null });
            if (name === 'list_pending_admin_submissions') return Promise.resolve({ data: { items: [], next_cursor: null }, error: null });
            if (name === 'list_admin_invitations') return Promise.resolve({ data: [], error: null });
            return Promise.resolve({ data: null, error: { message: 'Network unavailable' } });
        });
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2));
        ([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Davetler')!).click();
        await vi.waitFor(() => expect(document.getElementById('admin-invite-email')).not.toBeNull());
        const email = document.getElementById('admin-invite-email') as HTMLInputElement;
        email.value = 'invalid';
        email.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(email);
        email.value = 'retry@example.invalid';
        email.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(document.getElementById('admin-status')?.textContent).toContain('Network unavailable'));
        expect((email.form!.querySelector('[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    });

    it('lets a non-admin log out and keeps failed logout retryable', async () => {
        auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'nonadmin' } } }, error: null });
        rpc.mockResolvedValue({ data: { is_admin: false }, error: null });
        const dialog = document.getElementById('admin-dialog') as HTMLDialogElement;
        const close = vi.mocked(dialog.close);
        initAdminReview(vi.fn());
        await vi.waitFor(() => expect(document.getElementById('admin-actions')?.textContent).toContain('Çıkış yap'));
        const logout = document.querySelector('#admin-actions button') as HTMLButtonElement;
        auth.signOut.mockResolvedValueOnce({ error: { message: 'Temporary sign-out failure' } });
        logout.click();
        await vi.waitFor(() => expect(document.getElementById('admin-status')?.textContent).toContain('Temporary sign-out failure'));
        expect(logout.disabled).toBe(false);
        expect(close).not.toHaveBeenCalled();
        logout.click();
        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(auth.signOut).toHaveBeenCalledTimes(2);
    });

    it('renders user data as text and permits only safe source links', () => {
        const container = document.getElementById('admin-content')!;
        renderAdminDetail(container, detail);
        expect(container.querySelector('script,img,b')).toBeNull();
        expect(container.textContent).toContain('<script>alert(1)</script>');
        expect(container.querySelectorAll('a')).toHaveLength(1);
        expect(container.querySelector('a')?.rel).toBe('noopener noreferrer');
        expect(container.querySelector('a')?.protocol).toBe('https:');
        const headings = [...container.querySelectorAll('[role="columnheader"]')].map(node => node.textContent);
        expect(headings).toEqual(expect.arrayContaining(['Base at submission', 'Current approved', 'Proposed']));
        expect(container.textContent).toContain('Unavailable');
        expect(container.textContent).toContain('Base');
        expect(container.textContent).toContain('Current');
    });
});
