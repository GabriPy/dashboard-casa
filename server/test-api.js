import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDays, todayLocal } from './lib/time.js';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PIN = process.env.TEST_ADMIN_PIN || '1234';
const MAMMA_PIN = process.env.TEST_MAMMA_PIN || '1111';
const stamp = Date.now();
let cookie = '';

async function call(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('application/json')) data = await res.json();
  return { res, data, status: res.status, type };
}

async function login(userId, pin) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, pin }),
  });
  assert.equal(res.status, 200, `login ${userId}`);
  const setCookie = res.headers.getSetCookie()[0];
  cookie = setCookie.split(';')[0];
  const data = await res.json();
  return data.user;
}

const results = [];
async function waitForAiJob(jobId, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const state = await call(`/api/ai/recipes/jobs/${jobId}`);
    if (state.status !== 200) throw new Error(`job ${jobId}: HTTP ${state.status}`);
    if (state.data.status === 'done') return state.data.result;
    if (state.data.status === 'error') throw new Error(state.data.error?.message || 'job error');
  }
  throw new Error('job timeout');
}

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

async function main() {
  await step('health', async () => {
    const { status, data } = await call('/api/health');
    assert.equal(status, 200);
    assert.equal(data.database, 'ok');
  });

  await step('profili e login admin', async () => {
    const profiles = await call('/api/auth/profiles');
    assert.ok(profiles.data.profiles.length >= 2);
    const user = await login(1, ADMIN_PIN);
    assert.equal(user.role, 'admin');
  });

  await step('registro attività riservato agli amministratori', async () => {
    await login(1, ADMIN_PIN);
    const firstPage = await call('/api/logs?limit=1');
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.data.logs.length, 1);
    assert.equal(typeof firstPage.data.logs[0].actorName, 'string');
    assert.equal(typeof firstPage.data.logs[0].action, 'string');
    if (firstPage.data.nextCursor) {
      const olderPage = await call(`/api/logs?limit=1&beforeId=${firstPage.data.nextCursor}`);
      assert.equal(olderPage.status, 200);
      assert.ok(olderPage.data.logs[0].id < firstPage.data.logs[0].id);
    }

    await login(2, MAMMA_PIN);
    assert.equal((await call('/api/logs')).status, 403);
    await login(1, ADMIN_PIN);
  });

  await step('stato notifiche push autenticato', async () => {
    const status = await call('/api/push/status');
    assert.equal(status.status, 200);
    assert.equal(typeof status.data.configured, 'boolean');
    assert.equal(typeof status.data.subscriptionCount, 'number');
    assert.equal(status.data.configured ? typeof status.data.publicKey : status.data.publicKey, status.data.configured ? 'string' : null);
    if (!status.data.configured) {
      const disabled = await call('/api/push/subscriptions', { method: 'POST', body: {} });
      assert.equal(disabled.status, 503);
    }
  });

  await step('preferenze push per profilo e categoria', async () => {
    const defaults = { enabled: true, events: true, deadlines: true, plants: true };
    const adminPreferences = { ...defaults, events: false, plants: false };
    const savedAdmin = await call('/api/push/preferences', { method: 'PUT', body: adminPreferences });
    assert.deepEqual(savedAdmin.data.preferences, adminPreferences);
    assert.deepEqual((await call('/api/push/preferences')).data.preferences, adminPreferences);

    await login(2, MAMMA_PIN);
    assert.deepEqual((await call('/api/push/preferences')).data.preferences, defaults);
    const memberPreferences = { ...defaults, enabled: false, deadlines: false };
    const savedMember = await call('/api/push/preferences', { method: 'PUT', body: memberPreferences });
    assert.deepEqual(savedMember.data.preferences, memberPreferences);

    await login(1, ADMIN_PIN);
    assert.deepEqual((await call('/api/push/preferences')).data.preferences, adminPreferences);
    await call('/api/push/preferences', { method: 'PUT', body: defaults });
    await login(2, MAMMA_PIN);
    await call('/api/push/preferences', { method: 'PUT', body: defaults });
    await login(1, ADMIN_PIN);
  });

  await step('Home Assistant non configurato e accesso sicuro', async () => {
    const status = await call('/api/home-assistant/status');
    assert.equal(status.status, 200);
    assert.equal(typeof status.data.configured, 'boolean');
    if (process.env.TEST_HOME_ASSISTANT === 'true') {
      assert.equal(status.data.configured, true);
      const first = await call('/api/home-assistant/devices', {
        method: 'POST',
        body: { name: 'Tavolo destro', entityId: 'light.table_right', room: 'Soggiorno', groupName: 'Tavolo', icon: 'light' },
      });
      assert.equal(first.status, 201);
      assert.equal(first.data.device.groupName, 'Tavolo');
      const second = await call('/api/home-assistant/devices', {
        method: 'POST',
        body: { name: 'Tavolo sinistro', entityId: 'switch.table_left', room: 'Soggiorno', icon: 'plug' },
      });
      assert.equal(second.status, 201);
      const grouped = await call(`/api/home-assistant/devices/${second.data.device.id}`, {
        method: 'PATCH',
        body: { name: 'Tavolo sinistro', room: 'Soggiorno', groupName: 'Tavolo', icon: 'plug' },
      });
      assert.equal(grouped.status, 200);
      assert.equal(grouped.data.device.groupName, 'Tavolo');
      const member = await login(2, MAMMA_PIN);
      assert.equal(member.role, 'member');
      const memberDevices = await call('/api/home-assistant/devices');
      assert.equal(memberDevices.data.devices.filter((device) => device.groupName === 'Tavolo').length, 2);
      const turnedOn = await call('/api/home-assistant/groups/action', {
        method: 'POST',
        body: { room: 'Soggiorno', groupName: 'Tavolo', turnOn: true },
      });
      assert.equal(turnedOn.status, 200);
      assert.equal(turnedOn.data.devices.every((device) => device.on), true);
      const turnedOff = await call('/api/home-assistant/groups/action', {
        method: 'POST',
        body: { room: 'Soggiorno', groupName: 'Tavolo', turnOn: false },
      });
      assert.equal(turnedOff.status, 200);
      assert.equal(turnedOff.data.devices.every((device) => !device.on), true);
      const forbidden = await call(`/api/home-assistant/devices/${first.data.device.id}`, {
        method: 'PATCH',
        body: { name: 'Altro', room: 'Soggiorno', groupName: null, icon: 'light' },
      });
      assert.equal(forbidden.status, 403);
      await login(1, ADMIN_PIN);
      await call(`/api/home-assistant/devices/${first.data.device.id}`, { method: 'DELETE' });
      await call(`/api/home-assistant/devices/${second.data.device.id}`, { method: 'DELETE' });
    } else {
      const devices = await call('/api/home-assistant/devices');
      assert.equal(devices.status, 200);
      assert.equal(devices.data.configured, false);
      const blocked = await call('/api/home-assistant/devices', {
        method: 'POST',
        body: { name: 'Lampada', entityId: 'light.lampada', room: 'Casa', icon: 'light' },
      });
      assert.equal(blocked.status, 503);
      const blockedGroup = await call('/api/home-assistant/groups/action', {
        method: 'POST',
        body: { room: 'Casa', groupName: 'Tavolo', turnOn: false },
      });
      assert.equal(blockedGroup.status, 503);
    }
  });

  await step('dashboard', async () => {
    const { status, data } = await call('/api/dashboard');
    assert.equal(status, 200);
    assert.ok(data.counts.recipes >= 1);
    assert.ok(data.today);
  });

  await step('preferenze dashboard separate per profilo', async () => {
    const defaults = {
      cards: {
        order: ['shopping', 'deadlines', 'plants', 'recipes'],
        visible: ['shopping', 'deadlines', 'plants', 'recipes'],
      },
      sections: {
        order: ['agenda', 'deadlines', 'shopping', 'plants', 'recipe'],
        visible: ['agenda', 'deadlines', 'shopping', 'plants', 'recipe'],
      },
      mobileNav: { order: ['today', 'shopping', 'calendar', 'deadlines', 'domotica', 'recipes', 'plants'] },
    };
    const initial = await call('/api/dashboard/preferences');
    assert.deepEqual(initial.data.preferences, defaults);

    const adminPreferences = {
      cards: { order: ['recipes', 'plants', 'deadlines', 'shopping'], visible: ['recipes', 'plants'] },
      sections: { order: ['recipe', 'plants', 'shopping', 'deadlines', 'agenda'], visible: ['recipe', 'plants', 'agenda'] },
      mobileNav: { order: ['recipes', 'plants', 'deadlines', 'shopping', 'calendar', 'today', 'domotica'] },
    };
    const savedAdmin = await call('/api/dashboard/preferences', { method: 'PUT', body: adminPreferences });
    assert.equal(savedAdmin.status, 200);
    assert.deepEqual(savedAdmin.data.preferences, adminPreferences);
    const invalid = await call('/api/dashboard/preferences', {
      method: 'PUT',
      body: { ...adminPreferences, cards: { ...adminPreferences.cards, order: ['recipes', 'recipes', 'deadlines', 'shopping'] } },
    });
    assert.equal(invalid.status, 400);
    const invalidNavigation = await call('/api/dashboard/preferences', {
      method: 'PUT',
      body: { ...adminPreferences, mobileNav: { order: ['today', 'today', 'calendar', 'deadlines', 'domotica', 'recipes', 'plants'] } },
    });
    assert.equal(invalidNavigation.status, 400);
    const legacySave = await call('/api/dashboard/preferences', {
      method: 'PUT',
      body: { cards: adminPreferences.cards, sections: adminPreferences.sections },
    });
    assert.deepEqual(legacySave.data.preferences.mobileNav, adminPreferences.mobileNav);
    const sixLinkOrder = await call('/api/dashboard/preferences', {
      method: 'PUT',
      body: {
        ...adminPreferences,
        mobileNav: { order: ['plants', 'recipes', 'deadlines', 'calendar', 'shopping', 'today'] },
      },
    });
    assert.deepEqual(sixLinkOrder.data.preferences.mobileNav.order, [
      'plants',
      'recipes',
      'deadlines',
      'calendar',
      'shopping',
      'today',
      'domotica',
    ]);
    await call('/api/dashboard/preferences', { method: 'PUT', body: adminPreferences });

    await login(2, MAMMA_PIN);
    const memberInitial = await call('/api/dashboard/preferences');
    assert.deepEqual(memberInitial.data.preferences, defaults);
    const memberPreferences = {
      cards: { order: ['deadlines', 'shopping', 'plants', 'recipes'], visible: ['deadlines', 'shopping', 'plants', 'recipes'] },
      sections: defaults.sections,
      mobileNav: { order: ['shopping', 'today', 'calendar', 'deadlines', 'plants', 'recipes', 'domotica'] },
    };
    const savedMember = await call('/api/dashboard/preferences', { method: 'PUT', body: memberPreferences });
    assert.deepEqual(savedMember.data.preferences, memberPreferences);

    await login(1, ADMIN_PIN);
    const stillAdmin = await call('/api/dashboard/preferences');
    assert.deepEqual(stillAdmin.data.preferences, adminPreferences);
    await call('/api/dashboard/preferences', { method: 'PUT', body: defaults });
  });

  await step('evento ricorrente e espansione', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await call('/api/events', {
      method: 'POST',
      body: {
        title: `Test ricorrenza ${stamp}`,
        startsAt: `${today}T18:30`,
        endsAt: `${today}T19:30`,
        recurrence: 'weekly',
        category: 'Casa',
      },
    });
    assert.equal(created.status, 201);
    const id = created.data.event.id;
    const rangeEnd = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
    const list = await call(`/api/events?from=${today}&to=${rangeEnd}`);
    const occurrences = list.data.events.filter((e) => e.id === id);
    assert.ok(occurrences.length >= 3, `occorrenze: ${occurrences.length}`);
    const updated = await call(`/api/events/${id}`, { method: 'PATCH', body: { title: `Test ricorrenza mod ${stamp}` } });
    assert.equal(updated.status, 200);
    const removed = await call(`/api/events/${id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
  });

  await step('scadenza ricorrente', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await call('/api/deadlines', {
      method: 'POST',
      body: { title: `Test bolletta ${stamp}`, dueDate: today, category: 'Bollette', recurrence: 'monthly', amount: 12.5 },
    });
    assert.equal(created.status, 201);
    const id = created.data.deadline.id;
    const done = await call(`/api/deadlines/${id}/complete`, { method: 'POST', body: { done: true } });
    assert.equal(done.status, 200);
    assert.equal(done.data.repeated, true);
    assert.notEqual(done.data.deadline.dueDate, today);
    assert.equal(done.data.deadline.status, 'open');
    await call(`/api/deadlines/${id}`, { method: 'DELETE' });
  });

  await step('lista spesa: aggiunta, unione, spunta', async () => {
    const lists = await call('/api/shopping/lists');
    const listId = lists.data.lists[0].id;
    const name = `Test pomodori ${stamp}`;
    const first = await call(`/api/shopping/lists/${listId}/items`, { method: 'POST', body: { name, quantity: '1', unit: 'kg' } });
    assert.equal(first.status, 201);
    assert.equal(first.data.merged, false);
    const second = await call(`/api/shopping/lists/${listId}/items`, { method: 'POST', body: { name, quantity: '2', unit: 'kg' } });
    assert.equal(second.data.merged, true);
    const itemId = first.data.item.id;
    const toggled = await call(`/api/shopping/items/${itemId}`, { method: 'PATCH', body: { done: true } });
    assert.equal(toggled.data.item.done, true);
    await call(`/api/shopping/items/${itemId}`, { method: 'DELETE' });
  });

  await step('ricetta: creazione, ingredienti, spesa', async () => {
    const title = `Test torta ${stamp}`;
    const created = await call('/api/recipes', {
      method: 'POST',
      body: {
        title,
        category: 'Dolci',
        servings: 4,
        prepMinutes: 30,
        ingredients: [
          { name: `Farina test ${stamp}`, quantity: '200', unit: 'g' },
          { name: `Mele test ${stamp}`, quantity: '2', unit: 'pz' },
        ],
      },
    });
    assert.equal(created.status, 201);
    const id = created.data.recipe.id;
    const detail = await call(`/api/recipes/${id}`);
    assert.equal(detail.data.recipe.ingredients.length, 2);
    const shop = await call(`/api/recipes/${id}/to-shopping`, { method: 'POST', body: {} });
    assert.equal(shop.status, 200);
    assert.equal(shop.data.added.length, 2);
    const fav = await call(`/api/recipes/${id}/favorite`, { method: 'POST' });
    assert.equal(fav.data.favorite, true);

    const lists = await call('/api/shopping/lists');
    const items = await call(`/api/shopping/lists/${lists.data.lists[0].id}/items`);
    for (const item of items.data.items.filter((i) => i.name.includes(`test ${stamp}`))) {
      await call(`/api/shopping/items/${item.id}`, { method: 'DELETE' });
    }
    await call(`/api/recipes/${id}`, { method: 'DELETE' });
  });

  await step('ricetta generata con AI (se configurata)', async () => {
    const status = await call('/api/ai/status');
    if (!status.data?.ai?.configured) {
      console.log('  (AI non configurata: salto la generazione)');
      return;
    }
    const generated = await call('/api/ai/recipes/generate', {
      method: 'POST',
      body: { prompt: 'Ho zucchine e pasta, qualcosa di veloce', servings: 2, maxMinutes: 30 },
    });
    assert.equal(generated.status, 202, JSON.stringify(generated.data));
    assert.ok(generated.data.jobId);
    const generatedResult = await waitForAiJob(generated.data.jobId);
    assert.ok(generatedResult.recipe.title);
    assert.ok(generatedResult.recipe.ingredients.length >= 3);
    assert.ok(generatedResult.recipe.steps.length >= 2);

    const saved = await call('/api/recipes', {
      method: 'POST',
      body: {
        title: generatedResult.recipe.title,
        description: generatedResult.recipe.description,
        category: generatedResult.recipe.category,
        servings: generatedResult.recipe.servings,
        prepMinutes: generatedResult.recipe.prepMinutes,
        notes: generatedResult.recipe.steps.map((stepText, index) => `${index + 1}. ${stepText}`).join('\n'),
        ingredients: generatedResult.recipe.ingredients,
        source: 'ai',
        sourcePrompt: 'test automatico',
      },
    });
    assert.equal(saved.status, 201);
    assert.equal(saved.data.recipe.source, 'ai');

    await new Promise((resolve) => setTimeout(resolve, 2600));
    const similar = await call('/api/ai/recipes/generate', {
      method: 'POST',
      body: { mode: 'similar', seed: generatedResult.recipe, servings: 2 },
    });
    assert.equal(similar.status, 202, JSON.stringify(similar.data));
    const similarResult = await waitForAiJob(similar.data.jobId);
    assert.ok(similarResult.recipe.title);

    await call(`/api/recipes/${saved.data.recipe.id}`, { method: 'DELETE' });
  });

  await step('pianta: creazione, cura, diario', async () => {
    const created = await call('/api/plants', {
      method: 'POST',
      body: {
        name: `Test felce ${stamp}`,
        species: 'Nephrolepis',
        location: 'Interno',
        tasks: [{ type: 'acqua', intervalDays: 3 }],
      },
    });
    assert.equal(created.status, 201);
    const plant = created.data.plant;
    assert.equal(plant.tasks.length, 1);
    const task = plant.tasks[0];
    const done = await call(`/api/plants/${plant.id}/tasks/${task.id}/done`, {
      method: 'POST',
      body: { note: 'Terreno asciutto' },
    });
    assert.equal(done.status, 200);
    assert.notEqual(done.data.task.nextDueDate, task.nextDueDate);
    const detail = await call(`/api/plants/${plant.id}`);
    assert.ok(detail.data.logs.length >= 1);

    const balconyCreated = await call('/api/plants', {
      method: 'POST',
      body: {
        name: `Test esterno dovuta ${stamp}`,
        location: 'Esterno',
        tasks: [
          { type: 'acqua', intervalDays: 5, nextDueDate: '2000-01-01' },
          { type: 'concime', intervalDays: 30 },
        ],
      },
    });
    assert.equal(balconyCreated.status, 201);
    const outdoorNotDue = await call('/api/plants', {
      method: 'POST',
      body: {
        name: `Test esterno non dovuta ${stamp}`,
        location: 'Esterno',
        tasks: [{ type: 'acqua', intervalDays: 5, nextDueDate: '2099-12-31' }],
      },
    });
    assert.equal(outdoorNotDue.status, 201);
    const outdoorNoTask = await call('/api/plants', {
      method: 'POST',
      body: { name: `Test esterno senza attività ${stamp}`, location: 'Esterno' },
    });
    assert.equal(outdoorNoTask.status, 201);
    const plantsBeforeRain = await call('/api/plants');
    const outdoorPlants = plantsBeforeRain.data.plants.filter((item) => item.location === 'Esterno');
    const expectedRainCount = outdoorPlants.length;
    const expectedRescheduledCount = outdoorPlants.filter((item) =>
      item.tasks.some((itemTask) => itemTask.type === 'acqua'),
    ).length;
    const rain = await call('/api/plants/rain', { method: 'POST', body: {} });
    assert.equal(rain.status, 200);
    assert.ok(expectedRainCount > 0);
    assert.equal(rain.data.updatedCount, expectedRainCount);
    assert.equal(rain.data.updatedPlantCount, expectedRainCount);
    assert.equal(rain.data.rescheduledPlantCount, expectedRescheduledCount);
    assert.equal(rain.data.logOnlyPlantCount, expectedRainCount - expectedRescheduledCount);
    const balconyDetail = await call(`/api/plants/${balconyCreated.data.plant.id}`);
    assert.equal(balconyDetail.data.logs.length, 1);
    assert.equal(balconyDetail.data.logs[0].type, 'acqua');
    assert.equal(balconyDetail.data.logs[0].note, 'Pioggia');
    assert.notEqual(balconyDetail.data.plant.tasks.find((t) => t.type === 'acqua').nextDueDate, '2000-01-01');
    const notDueDetail = await call(`/api/plants/${outdoorNotDue.data.plant.id}`);
    assert.equal(notDueDetail.data.logs.length, 1);
    assert.equal(notDueDetail.data.logs[0].note, 'Pioggia');
    assert.notEqual(notDueDetail.data.plant.tasks.find((t) => t.type === 'acqua').nextDueDate, '2099-12-31');
    assert.equal(
      notDueDetail.data.plant.tasks.find((t) => t.type === 'acqua').nextDueDate,
      addDays(todayLocal(), 5),
    );
    const noTaskDetail = await call(`/api/plants/${outdoorNoTask.data.plant.id}`);
    assert.equal(noTaskDetail.data.logs.length, 1);
    assert.equal(noTaskDetail.data.logs[0].type, 'acqua');
    assert.equal(noTaskDetail.data.logs[0].taskId, null);
    const indoorDetail = await call(`/api/plants/${plant.id}`);
    assert.equal(indoorDetail.data.logs.length, 1);
    const invalidLocation = await call('/api/plants', {
      method: 'POST',
      body: { name: `Test posizione invalida ${stamp}`, location: 'Balcone' },
    });
    assert.equal(invalidLocation.status, 400);
    await call(`/api/plants/${balconyCreated.data.plant.id}`, { method: 'DELETE' });
    await call(`/api/plants/${outdoorNotDue.data.plant.id}`, { method: 'DELETE' });
    await call(`/api/plants/${outdoorNoTask.data.plant.id}`, { method: 'DELETE' });
    await call(`/api/plants/${plant.id}`, { method: 'DELETE' });
  });

  await step('allegati: upload, lettura, eliminazione', async () => {
    const created = await call('/api/events', {
      method: 'POST',
      body: { title: `Test allegato ${stamp}`, startsAt: `${new Date().toISOString().slice(0, 10)}T12:00` },
    });
    const eventId = created.data.event.id;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l2y9WQAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
    form.append('entityType', 'event');
    form.append('entityId', String(eventId));
    const uploaded = await call('/api/attachments', { method: 'POST', form });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    const attachment = uploaded.data.attachment;
    const file = await fetch(`${BASE}${attachment.url}`, { headers: { Cookie: cookie } });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    const removed = await call(`/api/attachments/${attachment.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    await call(`/api/events/${eventId}`, { method: 'DELETE' });
  });

  await step('privacy: dati privati invisibili all’altro profilo', async () => {
    await login(2, MAMMA_PIN);
    const created = await call('/api/deadlines', {
      method: 'POST',
      body: { title: `Test privata ${stamp}`, dueDate: new Date().toISOString().slice(0, 10), visibility: 'private' },
    });
    assert.equal(created.status, 201);
    const privateId = created.data.deadline.id;

    await login(1, ADMIN_PIN);
    const adminList = await call('/api/deadlines?filter=all');
    assert.ok(!adminList.data.deadlines.some((d) => d.id === privateId), 'l’admin non deve vedere la scadenza privata');
    const forbidden = await call(`/api/deadlines/${privateId}`, { method: 'PATCH', body: { title: 'hack' } });
    assert.equal(forbidden.status, 403);

    await login(2, MAMMA_PIN);
    const own = await call('/api/deadlines?filter=all');
    assert.ok(own.data.deadlines.some((d) => d.id === privateId));
    await call(`/api/deadlines/${privateId}`, { method: 'DELETE' });
  });

  await step('ricerca globale', async () => {
    await login(1, ADMIN_PIN);
    const { data } = await call('/api/search?q=pasta');
    assert.ok(data.results.some((r) => r.type === 'recipe'));
  });

  await step('impostazioni e coda promemoria', async () => {
    const before = await call('/api/settings');
    assert.equal(before.status, 200);
    assert.equal('mail' in before.data, false);
    const patched = await call('/api/settings', { method: 'PATCH', body: { household_name: 'Casa Ghibiri' } });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.settings.household_name, 'Casa Ghibiri');
    const emailRoute = await call('/api/settings/test-email', { method: 'POST', body: {} });
    assert.equal(emailRoute.status, 404);
    const run = await call('/api/settings/run-reminders', { method: 'POST', body: {} });
    assert.equal(run.status, 200);
    assert.equal(typeof run.data.stats.pushSent, 'number');
    assert.equal(typeof run.data.stats.pushFailed, 'number');
    const reminders = await call('/api/settings');
    assert.ok(reminders.data.reminders.length >= 1, 'la coda promemoria deve avere elementi');
  });

  await step('utenti: creazione, modifica, eliminazione', async () => {
    const created = await call('/api/users', {
      method: 'POST',
      body: { name: `Test utente ${stamp}`, pin: '4682', role: 'member', email: 'test@example.com' },
    });
    assert.equal(created.status, 201);
    const id = created.data.user.id;
    const patched = await call(`/api/users/${id}`, { method: 'PATCH', body: { role: 'admin', pin: '1357' } });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.user.role, 'admin');
    const removed = await call(`/api/users/${id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
  });

  await step('backup zip', async () => {
    const res = await fetch(`${BASE}/api/backup/export`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /zip/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    assert.ok(buffer.length > 2000, `dimensione ${buffer.length}`);
    fs.writeFileSync('.test-backup.zip', buffer);
    const json = await call('/api/backup/export/json');
    assert.equal(json.status, 200);
    assert.ok(json.data.tables.users.length >= 2);
  });

  await step('logout', async () => {
    const out = await call('/api/auth/logout', { method: 'POST' });
    assert.equal(out.status, 200);
    const me = await call('/api/auth/me');
    assert.equal(me.status, 401);
    const pushStatus = await call('/api/push/status');
    assert.equal(pushStatus.status, 401);
    const pushPreferences = await call('/api/push/preferences');
    assert.equal(pushPreferences.status, 401);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} test superati`);
  if (failed.length) {
    console.log(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
