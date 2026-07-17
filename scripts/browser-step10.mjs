import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET'];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
const apiUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const service = createClient(apiUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false } });
const parentId = '20000000-0000-0000-0000-000000000003';
const parentRevisionId = '21000000-0000-0000-0000-000000000003';
const familyId = '10000000-0000-0000-0000-000000000001';
const baseUrl = 'http://127.0.0.1:4173/aile/';

function token(userId, email) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated', role: 'authenticated', sub: userId, email, iat: now, exp: now + 3600,
    app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {},
  })}`;
  return `${unsigned}.${createHmac('sha256', process.env.SUPABASE_JWT_SECRET).update(unsigned).digest('base64url')}`;
}

function check(condition, message) { if (!condition) throw new Error(message); }

async function createGoogleUser(email) {
  const result = await service.auth.admin.createUser({
    email, email_confirm: true, app_metadata: { provider: 'google', providers: ['google'] },
  });
  if (result.error) throw result.error;
  return result.data.user.id;
}

const email = `step10-${randomUUID()}@example.invalid`;
const userId = await createGoogleUser(email);
const grant = await service.rpc('bootstrap_first_google_admin', { p_user_id: userId });
if (grant.error) throw grant.error;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.route('http://127.0.0.1:4173/**', route => {
  const headers = { ...route.request().headers() };
  delete headers['if-modified-since'];
  delete headers['if-none-match'];
  return route.continue({ headers });
});
const errors = [];
const googleRequests = [];
const requestFailures = [];
const non2xxResponses = [];
const pendingApiRequests = new Set();
let apiActivity = 0;
let intentionalRequestFailures = 0;
let intentionalConsoleErrors = 0;
let syntheticLogoutActive = false;
let syntheticLogoutAborts = 0;
page.on('pageerror', error => errors.push(`page: ${error.message}`));
page.on('console', message => {
  if (message.type() !== 'error') return;
  if (message.text().includes('net::ERR_FAILED') && intentionalRequestFailures === 1 && intentionalConsoleErrors === 0) {
    intentionalConsoleErrors++;
  } else errors.push(`console: ${message.text()}`);
});
page.on('request', request => {
  if (/script\.google|docs\.google|sheets\.google|googleusercontent|apps-script/i.test(request.url())) googleRequests.push(request.url());
  if (request.url().startsWith(apiUrl)) {
    pendingApiRequests.add(request);
    apiActivity++;
  }
});
page.on('requestfinished', request => {
  if (pendingApiRequests.delete(request)) apiActivity++;
});
page.on('requestfailed', request => {
  if (pendingApiRequests.delete(request)) apiActivity++;
  if (syntheticLogoutActive && request.url().includes('/auth/v1/logout')) syntheticLogoutAborts++;
  else requestFailures.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText ?? '' });
});
page.on('response', response => {
  if (response.status() < 200 || response.status() >= 300) {
    non2xxResponses.push({ url: response.url(), status: response.status() });
  }
});
page.on('dialog', dialog => dialog.accept());

async function waitForApiIdle() {
  let stableTicks = 0;
  let lastActivity = apiActivity;
  for (let tick = 0; tick < 150; tick++) {
    await page.waitForTimeout(100);
    if (pendingApiRequests.size === 0 && apiActivity === lastActivity) {
      if (++stableTicks === 10) return;
    } else {
      stableTicks = 0;
      lastActivity = apiActivity;
    }
  }
  throw new Error(`Supabase requests did not settle: ${pendingApiRequests.size} pending`);
}

async function openFamily(families, pending = false) {
  const query = families.map(value => `family=${value}`).join('&') + (pending ? '&view=pending' : '') + '&reset=1';
  await page.goto(`${baseUrl}?${query}`);
  await page.locator('svg g.node').first().waitFor();
  await waitForApiIdle();
  await page.waitForTimeout(1100);
}

async function treeText() { return page.locator('#tree-container').innerText(); }

async function setBrowserSession(userId, email) {
  const accessToken = token(userId, email);
  await page.evaluate(({ accessToken, userId, email }) => localStorage.setItem('sb-127-auth-token', JSON.stringify({
    access_token: accessToken, refresh_token: 'step11-local-only', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email,
      app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, created_at: new Date().toISOString() },
  })), { accessToken, userId, email });
}

async function checkLayout() {
  const selectors = ['#search-container', '#tree-toolbar', '#proposal-panel'];
  const visible = [];
  for (const selector of selectors) if (await page.locator(selector).isVisible()) visible.push(selector);
  const boxes = await Promise.all(visible.map(selector => page.locator(selector).boundingBox()));
  check(boxes.every(Boolean), 'Layout controls are missing');
  for (let left = 0; left < boxes.length; left++) for (let right = left + 1; right < boxes.length; right++) {
    const [a, b] = [boxes[left], boxes[right]];
    check(a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x,
      `${visible[left]} overlaps ${visible[right]}`);
  }
  for (const box of boxes) check(box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width, 'Control is outside viewport');

  const controls = page.locator('#search-container input:visible, #tree-toolbar button:visible, #tree-toolbar summary:visible');
  for (let index = 0; index < await controls.count(); index++) {
    const box = await controls.nth(index).boundingBox();
    check(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width
      && box.y + box.height <= page.viewportSize().height, 'Interactive control is outside viewport');
  }
  const nodes = page.locator('g.node:visible');
  check(await nodes.count() > 0, 'No visible tree nodes');
  let nodesInViewport = 0;
  for (let index = 0; index < await nodes.count(); index++) {
    const box = await nodes.nth(index).boundingBox();
    check(box && Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0,
      'Tree node has invalid bounds');
    if (box.x < page.viewportSize().width && box.y < page.viewportSize().height
      && box.x + box.width > 0 && box.y + box.height > 0) nodesInViewport++;
  }
  check(nodesInViewport > 0, 'Tree has no node inside the viewport');
  const personControls = page.locator('g.node-content[role="button"]:visible');
  let peopleInViewport = 0;
  for (let index = 0; index < await personControls.count(); index++) {
    const box = await personControls.nth(index).boundingBox();
    if (box && box.x < page.viewportSize().width && box.y < page.viewportSize().height
      && box.x + box.width > 0 && box.y + box.height > 0) peopleInViewport++;
  }
  check(peopleInViewport > 0, 'Tree has no person control inside the viewport');
}

async function submitEdit(mode, firstName, lastName, retry = false) {
  await openFamily(['demo-alpha']);
  await page.locator(`g.edit-control[data-node-id="person_${parentId}"]`).click();
  if (mode === 'spouse') await page.getByRole('button', { name: '+ Eş / partner' }).click();
  if (mode === 'child') await page.getByRole('button', { name: '+ Çocuk' }).click();
  await page.locator('.edit-form input[name="first_name"]').fill(firstName);
  await page.locator('.edit-form input[name="last_name"]').fill(lastName);
  const submit = page.locator('.edit-form button[type="submit"]');
  if (retry) {
    let aborted = false;
    await page.route('**/rest/v1/rpc/submit_family_edit', route => {
      if (!aborted) { aborted = true; intentionalRequestFailures++; return route.abort('failed'); }
      return route.continue();
    });
    await submit.click();
    await page.locator('.editor-status.error').waitFor();
    await page.unroute('**/rest/v1/rpc/submit_family_edit');
  }
  await submit.click();
  await page.waitForURL(/proposal=/);
  await waitForApiIdle();
  return new URL(page.url()).searchParams.get('proposal');
}

async function submitFamily(name, retry = false) {
  await openFamily(['demo-alpha']);
  await page.locator(`g.edit-control[data-node-id="person_${parentId}"]`).click();
  await page.getByRole('button', { name: 'Aile başlat' }).click();
  check((await page.locator('.family-creation-context').innerText()).includes('Parent Alpha'),
    'Family creation does not identify the selected root');
  await page.locator('input[name="family_name"]').fill(name);
  const slug = page.locator('input[name="family_slug"]');
  const expectedSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  check(await slug.inputValue() === expectedSlug, 'Family slug suggestion is unsafe or unstable');
  const submit = page.locator('.family-creation-form button[type="submit"]');
  if (retry) {
    let aborted = false;
    await page.route('**/rest/v1/rpc/submit_family_creation', route => {
      if (!aborted) { aborted = true; intentionalRequestFailures++; return route.abort('failed'); }
      return route.continue();
    });
    await submit.click();
    await page.locator('.editor-status.error').waitFor();
    await page.unroute('**/rest/v1/rpc/submit_family_creation');
  }
  await submit.click();
  await page.waitForURL(/proposal=/);
  await waitForApiIdle();
  check((await page.locator('#proposal-list').innerText()).includes(name), 'Pending family proposal is not visible');
  return new URL(page.url()).searchParams.get('proposal');
}

try {
  await openFamily(['demo-alpha']);
  check((await treeText()).includes('Parent Alpha'), 'Alpha tree did not render');
  await checkLayout();
  await openFamily(['demo-beta']);
  check((await treeText()).includes('Parent Beta'), 'Beta tree did not render');
  await openFamily(['demo-alpha', 'demo-beta']);
  const personControl = page.locator(`g.node:has(g.edit-control[data-node-id="person_${parentId}"]) > g.node-content`);
  check(await personControl.getAttribute('role') === 'button', 'Person node is not a button');
  check(await personControl.getAttribute('tabindex') === '0', 'Person node is not keyboard focusable');
  check((await personControl.getAttribute('aria-label'))?.includes('Parent Alpha'), 'Person node has no accessible name');
  const unionControl = page.locator('g.node:not(:has(g.edit-control)) > g.node-content').first();
  check(await unionControl.getAttribute('role') === null && await unionControl.getAttribute('tabindex') === null,
    'Structural union is exposed as a button');
  await personControl.focus();
  await personControl.press('Enter');
  check(await personControl.evaluate(element => element === document.activeElement), 'Person keyboard focus was lost');
  await page.locator('#global-search-input').fill('Parent');
  await page.locator('#search-dropdown').waitFor({ state: 'visible' });
  const combinedSearch = await page.locator('#search-dropdown').innerText();
  check(combinedSearch.includes('Parent Alpha') && combinedSearch.includes('Parent Beta'), 'Combined tree lost family overlap semantics');
  await page.locator('#global-search-input').fill('Shared');
  await page.locator('#search-dropdown').waitFor({ state: 'visible' });
  const graphPeople = await page.locator('g.node > g.node-content[role="button"]').evaluateAll(elements => elements.map(element => ({
    id: element.parentElement?.querySelector('g.edit-control')?.getAttribute('data-node-id'),
    name: element.getAttribute('aria-label')?.replace(/^Kişiyi aç: /, ''),
  })));
  const searchRows = await page.locator('#search-dropdown > [role="option"]').evaluateAll(elements => elements.map(element => ({
    id: element.getAttribute('data-node-id'), text: element.textContent, visible: element.checkVisibility(),
  })));
  console.log(`Combined overlap diagnostics: ${JSON.stringify({ graphPeople, searchRows })}`);
  const sharedId = 'person_20000000-0000-0000-0000-000000000005';
  check(graphPeople.filter(person => person.id === sharedId).length === 1,
    'Shared overlap person is duplicated in combined graph');
  check(await page.locator(`#search-dropdown > [role="option"][data-node-id="${sharedId}"]:visible`).count() === 1,
    `Shared overlap semantic search result is not unique: ${JSON.stringify(searchRows)}`);

  const profileId = await submitEdit('profile', 'Browser', 'Alpha', true);
  const spouseId = await submitEdit('spouse', 'Browser Spouse', 'Synthetic');
  const childId = await submitEdit('child', 'Browser Child', 'Synthetic');
  const familyProposalId = await submitFamily('Browser Root Family', true);
  const rejectedFamilyId = await submitFamily('Browser Rejected Family');
  check(profileId && spouseId && childId && familyProposalId && rejectedFamilyId,
    'Browser submissions did not return proposal IDs');

  await openFamily(['demo-alpha'], true);
  check(await page.locator('#proposal-panel').isVisible(), 'Pending proposal panel is hidden');
  await checkLayout();

  const stale = await anon.rpc('submit_family_edit', {
    p_family_id: familyId, p_client_request_id: randomUUID(), p_anonymous_actor_secret: randomUUID(),
    p_bundle: { people: [{ ref: parentId, person_id: parentId, base_revision_id: parentRevisionId,
      given_name: 'Browser Stale', family_name: 'Alpha', display_name: 'Browser Stale Alpha', privacy: 'public' }] },
  });
  if (stale.error) throw stale.error;
  const staleId = stale.data.submission_id;

  const noninvitedEmail = `step11-noninvited-${randomUUID()}@example.invalid`;
  const noninvitedId = await createGoogleUser(noninvitedEmail);
  await setBrowserSession(noninvitedId, noninvitedEmail);
  await page.reload();
  await page.locator('svg g.node').first().waitFor();
  await page.getByRole('button', { name: 'Yönetim' }).click();
  await page.getByText('Bu Google hesabı etkin bir yönetici değil.').waitFor();
  syntheticLogoutActive = true;
  let logoutIntercepted = false;
  await page.route('**/auth/v1/logout**', route => {
    logoutIntercepted = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await page.locator('#admin-dialog').waitFor({ state: 'hidden' });
  check(logoutIntercepted, 'Synthetic logout endpoint was not exercised');
  await page.unroute('**/auth/v1/logout**');

  await setBrowserSession(userId, email);
  await page.reload();
  await page.locator('svg g.node').first().waitFor();
  await page.getByRole('button', { name: 'Yönetim' }).click();
  await page.locator('.admin-queue-item').first().waitFor();

  const invitedEmail = `step11-invited-${randomUUID()}@example.invalid`;
  const revokedEmail = `step11-revoked-${randomUUID()}@example.invalid`;
  await page.getByRole('tab', { name: 'Davetler' }).click();
  await page.locator('#admin-invite-email').fill(invitedEmail);
  await page.getByRole('button', { name: 'Davet et' }).click();
  await page.getByText(invitedEmail, { exact: true }).waitFor();
  await page.locator('#admin-invite-email').fill(revokedEmail);
  await page.getByRole('button', { name: 'Davet et' }).click();
  const revokedRow = page.locator('.admin-invite-item').filter({ hasText: revokedEmail });
  await revokedRow.getByRole('button', { name: /geri çek/i }).click();
  await revokedRow.getByText(/revoked/).waitFor();
  const invitedId = await createGoogleUser(invitedEmail);
  await setBrowserSession(invitedId, invitedEmail);
  await page.reload();
  await page.locator('svg g.node').first().waitFor();
  await page.getByRole('button', { name: 'Yönetim' }).click();
  await page.locator('.admin-queue-item').first().waitFor();

  async function detail(id) {
    await page.locator(`.admin-queue-item[data-submission-id="${id}"]`).click();
    await page.getByRole('button', { name: 'Onayla', exact: true }).waitFor();
  }
  async function approve(id) {
    await detail(id);
    await page.getByRole('button', { name: 'Onayla', exact: true }).click();
    await page.locator(`.admin-queue-item[data-submission-id="${id}"]`).waitFor({ state: 'detached' });
    await waitForApiIdle();
  }
  async function reject(id) {
    await detail(id);
    await page.locator('#admin-reject-reason').fill('Step 10 synthetic rejection');
    await page.getByRole('button', { name: 'Reddet', exact: true }).click();
    await page.locator(`.admin-queue-item[data-submission-id="${id}"]`).waitFor({ state: 'detached' });
    await waitForApiIdle();
  }

  await detail(profileId);
  const headings = await page.locator('.admin-diff-headings').first().locator('strong').allTextContents();
  check(JSON.stringify(headings) === JSON.stringify(['Field', 'Base at submission', 'Current approved', 'Proposed']),
    'Admin comparison headings are incomplete');
  const displayNameValues = await page.locator('.admin-diff-row').filter({ hasText: 'display_name' }).first().locator('span').allTextContents();
  check(displayNameValues[0] === 'Parent Alpha' && displayNameValues[1] === 'Parent Alpha'
    && displayNameValues[2] === 'Browser Alpha', 'Admin base/current/proposed values are incorrect');
  const adminBox = await page.locator('#admin-dialog').boundingBox();
  check(adminBox && adminBox.x >= 0 && adminBox.y >= 0 && adminBox.x + adminBox.width <= page.viewportSize().width
    && adminBox.y + adminBox.height <= page.viewportSize().height, 'Admin dialog is outside desktop viewport');
  await page.getByRole('button', { name: 'Onayla', exact: true }).click();
  await page.locator(`.admin-queue-item[data-submission-id="${profileId}"]`).waitFor({ state: 'detached' });
  await waitForApiIdle();
  await detail(staleId);
  await page.getByRole('button', { name: 'Onayla', exact: true }).click();
  await page.getByText(/çakışma nedeniyle/).waitFor();
  await waitForApiIdle();
  await reject(childId);
  await approve(spouseId);
  await reject(rejectedFamilyId);
  await approve(familyProposalId);
  check(await page.locator('#family-options').getByText('Browser Root Family', { exact: true }).count() === 1,
    'Approved family was not added to discovery controls');
  check(await page.locator('#family-options').getByText('Browser Rejected Family', { exact: true }).count() === 0,
    'Rejected family entered discovery controls');
  await page.locator('#admin-dialog .close-btn').click();
  await openFamily(['browser-root-family']);
  check((await treeText()).includes('Browser Alpha'), 'Approved family cannot be selected or lost its reused root');
  check(await page.locator(`g.edit-control[data-node-id="person_${parentId}"]`).count() === 1,
    'Reused root person is duplicated in the approved family');
  await waitForApiIdle();

  await page.setViewportSize({ width: 390, height: 844 });
  await openFamily(['demo-alpha', 'demo-beta']);
  await checkLayout();
  await page.getByRole('button', { name: 'Yönetim' }).click();
  await page.getByRole('tab', { name: 'Davetler' }).click();
  const inviteForm = await page.locator('.admin-invite-form').boundingBox();
  check(inviteForm && inviteForm.x >= 0 && inviteForm.x + inviteForm.width <= page.viewportSize().width,
    'Invitation form is outside mobile viewport');
  await page.locator('#admin-dialog .close-btn').click();
  await page.locator('#global-search-input').fill('Browser');
  await page.locator('#search-dropdown').waitFor({ state: 'visible' });
  const approvedSearch = await page.locator('#search-dropdown').innerText();
  check(approvedSearch.includes('Browser Alpha'), 'Approved profile is absent');
  check(approvedSearch.includes('Browser Spouse'), 'Approved spouse is absent');
  check(!approvedSearch.includes('Browser Child'), 'Rejected child is public');
  check(googleRequests.length === 0, `Unexpected Google request: ${googleRequests[0]}`);
  check(intentionalRequestFailures === 2, 'Retry paths did not exercise exactly two synthetic network failures');
  check(intentionalConsoleErrors <= 2, 'Unexpected repeated console errors from synthetic retries');
  check(syntheticLogoutAborts <= 1, 'Unexpected repeated synthetic logout abort');
  check(requestFailures.length === 2
    && requestFailures.every(failure => failure.method === 'POST' && failure.error.includes('ERR_FAILED'))
    && requestFailures.some(failure => failure.url === `${apiUrl}/rest/v1/rpc/submit_family_edit`)
    && requestFailures.some(failure => failure.url === `${apiUrl}/rest/v1/rpc/submit_family_creation`),
  `Unexpected failed request: ${JSON.stringify(requestFailures)}`);
  check(non2xxResponses.length === 0, `Unexpected non-2xx response: ${JSON.stringify(non2xxResponses)}`);
  check(errors.length === 0, errors.join('\n'));
  console.log('Browser PASS: Google invite/revoke/autoaccept/noninvited, moderation, Alpha/Beta/both, desktop/mobile');
} finally {
  await browser.close();
}
