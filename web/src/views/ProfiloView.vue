<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api.js';
import { useAuthStore } from '@/stores/auth.js';
import { useMetaStore } from '@/stores/meta.js';
import { useUiStore } from '@/stores/ui.js';
import BaseModal from '@/components/BaseModal.vue';
import { USER_COLORS, USER_EMOJIS } from '@/utils/constants.js';
import PageHeader from '@/components/PageHeader.vue';
import Avatar from '@/components/Avatar.vue';
import Icon from '@/components/Icon.vue';

const auth = useAuthStore();
const meta = useMetaStore();
const ui = useUiStore();
const router = useRouter();

const saving = ref(false);
const savingPin = ref(false);
const pinError = ref('');
const profileError = ref('');
const pushStatus = ref({ configured: false, publicKey: null, subscriptionCount: 0 });
const pushSupported = ref(false);
const pushPermission = ref('unsupported');
const pushEnabledHere = ref(false);
const pushBusy = ref(false);
const pushTutorialOpen = ref(false);
const pushPreferences = ref({ enabled: true, events: true, deadlines: true, plants: true, vehicles: true, medications: true });
const pushPreferencesLoading = ref(true);
const pushPreferencesSaving = ref(false);
const secureContext = typeof window !== 'undefined' && window.isSecureContext;
const isIosDevice =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const pushReady = computed(() => pushSupported.value && secureContext && pushStatus.value.configured);

const form = reactive({
  name: '',
  email: '',
  color: '#C0553A',
  emoji: '🙂',
});

const pinForm = reactive({ currentPin: '', newPin: '', confirmPin: '' });

function fill() {
  Object.assign(form, {
    name: auth.user?.name || '',
    email: auth.user?.email || '',
    color: auth.user?.color || '#C0553A',
    emoji: auth.user?.emoji || '🙂',
  });
}

async function saveProfile() {
  if (!form.name.trim()) {
    profileError.value = 'Il nome non può essere vuoto.';
    return;
  }
  saving.value = true;
  profileError.value = '';
  try {
    await auth.updateProfile({
      name: form.name.trim(),
      email: form.email.trim(),
      color: form.color,
      emoji: form.emoji,
    });
    ui.success('Profilo aggiornato.');
  } catch (err) {
    profileError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function changePin() {
  pinError.value = '';
  if (!/^\d{4}$/.test(pinForm.currentPin)) {
    pinError.value = 'Inserisci il PIN attuale di 4 cifre.';
    return;
  }
  if (!/^\d{4}$/.test(pinForm.newPin)) {
    pinError.value = 'Il nuovo PIN deve avere 4 cifre.';
    return;
  }
  if (pinForm.newPin !== pinForm.confirmPin) {
    pinError.value = 'I due PIN nuovi non coincidono.';
    return;
  }
  if (pinForm.newPin === pinForm.currentPin) {
    pinError.value = 'Scegli un PIN diverso da quello attuale.';
    return;
  }
  savingPin.value = true;
  try {
    await api('/api/auth/me/pin', {
      method: 'POST',
      body: { currentPin: pinForm.currentPin, newPin: pinForm.newPin },
    });
    pinForm.currentPin = '';
    pinForm.newPin = '';
    pinForm.confirmPin = '';
    ui.success('PIN aggiornato. Le altre sessioni sono state chiuse.');
  } catch (err) {
    pinError.value = err.message;
  } finally {
    savingPin.value = false;
  }
}

async function logout() {
  const ok = await ui.confirm({
    title: 'Uscire dalla casa?',
    message: 'Dovrai reinserire il PIN per rientrare.',
    confirmLabel: 'Esci',
  });
  if (!ok) return;
  await auth.logout();
  router.push({ name: 'login' });
}

function base64UrlToBytes(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (char) => char.charCodeAt(0));
}

async function loadPushStatus() {
  pushSupported.value = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  pushPermission.value = pushSupported.value ? Notification.permission : 'unsupported';
  try {
    let subscription = null;
    if (pushSupported.value) {
      const registration = await navigator.serviceWorker.getRegistration();
      subscription = await registration?.pushManager.getSubscription();
    }
    const endpoint = subscription?.endpoint;
    pushStatus.value = await api(endpoint ? `/api/push/status?endpoint=${encodeURIComponent(endpoint)}` : '/api/push/status');
    pushEnabledHere.value = Boolean(endpoint && pushStatus.value.currentDevice);
  } catch (err) {
    ui.error(err.message);
  }
}

async function loadPushPreferences() {
  try {
    const result = await api('/api/push/preferences');
    pushPreferences.value = result.preferences;
  } catch (err) {
    ui.error(err.message);
  } finally {
    pushPreferencesLoading.value = false;
  }
}

async function togglePushPreference(key) {
  if (pushPreferencesLoading.value || pushPreferencesSaving.value) return;
  pushPreferencesSaving.value = true;
  const updated = { ...pushPreferences.value, [key]: !pushPreferences.value[key] };
  try {
    const result = await api('/api/push/preferences', { method: 'PUT', body: updated });
    pushPreferences.value = result.preferences;
    ui.success('Preferenze notifiche aggiornate.');
  } catch (err) {
    ui.error(err.message);
  } finally {
    pushPreferencesSaving.value = false;
  }
}

async function enablePush() {
  if (!pushReady.value || pushBusy.value) return;
  pushBusy.value = true;
  try {
    const permission = pushPermission.value === 'granted' ? 'granted' : await Notification.requestPermission();
    pushPermission.value = permission;
    if (permission !== 'granted') {
      ui.info('Consenti le notifiche nel browser per attivarle.');
      return;
    }
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) registration = await navigator.serviceWorker.register('/sw.js');
    let subscription = await registration.pushManager.getSubscription();
    const createdHere = !subscription;
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(pushStatus.value.publicKey),
      });
    }
    try {
      const saved = await api('/api/push/subscriptions', { method: 'POST', body: subscription.toJSON() });
      pushStatus.value.subscriptionCount = saved.subscriptionCount;
    } catch (err) {
      if (createdHere) await subscription.unsubscribe();
      throw err;
    }
    pushEnabledHere.value = true;
    ui.success('Notifiche push attivate su questo dispositivo.');
  } catch (err) {
    ui.error(err.message || 'Attivazione delle notifiche non riuscita.');
  } finally {
    pushBusy.value = false;
  }
}

async function disablePush() {
  if (pushBusy.value) return;
  pushBusy.value = true;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await api('/api/push/subscriptions', { method: 'DELETE', body: { endpoint: subscription.endpoint } });
      await subscription.unsubscribe();
      pushEnabledHere.value = false;
      pushStatus.value.subscriptionCount = Math.max(0, pushStatus.value.subscriptionCount - 1);
    }
    ui.success('Notifiche push disattivate su questo dispositivo.');
  } catch (err) {
    ui.error(err.message);
  } finally {
    pushBusy.value = false;
  }
}

async function testPush() {
  if (pushBusy.value || !pushPreferences.value.enabled) return;
  pushBusy.value = true;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) throw new Error('Non trovo una sottoscrizione attiva su questo dispositivo.');
    await api('/api/push/test', { method: 'POST', body: { endpoint: subscription.endpoint } });
    ui.success('Notifica di prova inviata.');
  } catch (err) {
    ui.error(err.message);
  } finally {
    pushBusy.value = false;
  }
}

onMounted(async () => {
  if (!auth.user) await auth.refresh();
  fill();
  await Promise.all([meta.load(), loadPushStatus(), loadPushPreferences()]);
});
</script>

<template>
  <div class="page-stack profile-page">
    <PageHeader eyebrow="Il tuo spazio" title="Profilo" subtitle="Come ti vedono gli altri e come entri in casa." />

    <section class="card profile-hero">
      <Avatar :name="form.name" :emoji="form.emoji" :color="form.color" :size="76" :ring="true" />
      <div class="profile-id">
        <h2>{{ form.name || auth.user?.name }}</h2>
        <p class="muted small">
          {{ auth.isAdmin ? 'Amministratore della casa' : 'Membro della famiglia' }}
          <template v-if="auth.user?.email"> · {{ auth.user.email }}</template>
        </p>
        <p class="tiny muted">{{ meta.householdName }}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" @click="logout">
        <Icon name="logout" :size="15" /> Esci
      </button>
    </section>

    <section class="card">
      <header class="card-head">
        <div>
          <p class="eyebrow">Promemoria personali</p>
          <h2>Notifiche push</h2>
          <p class="card-note">Ricevi avvisi su questo dispositivo anche quando Ghibiri Home non è aperta.</p>
        </div>
        <span class="pin-lock"><Icon name="bell" :size="18" /></span>
      </header>
      <div class="push-status">
        <span v-if="pushEnabledHere" class="badge badge-sage"><Icon name="check" :size="11" /> Attive su questo dispositivo</span>
        <span v-else-if="pushStatus.subscriptionCount" class="badge badge-blue">{{ pushStatus.subscriptionCount }} dispositivi attivi</span>
        <span v-else class="badge badge-gold">Non attive</span>
        <span v-if="pushPermission === 'denied'" class="hint">Il browser le ha bloccate: consenti le notifiche dalle impostazioni del sito.</span>
        <span v-else-if="!pushSupported" class="hint">Questo browser non supporta le notifiche push web.</span>
        <span v-else-if="!secureContext" class="hint">Le notifiche push richiedono una connessione HTTPS.</span>
        <span v-else-if="!pushStatus.configured" class="hint">Il server deve essere configurato con le chiavi VAPID prima di poterle attivare.</span>
      </div>
      <div class="push-preferences">
        <div class="switch-row push-preference-row">
          <div class="push-preference-copy">
            <strong>Notifiche push generali</strong>
            <p class="hint">Sospendi o riattiva tutti i promemoria push del tuo profilo, su ogni dispositivo.</p>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ on: pushPreferences.enabled }"
            role="switch"
            aria-label="Notifiche push generali"
            :aria-checked="pushPreferences.enabled"
            :disabled="pushPreferencesLoading || pushPreferencesSaving"
            @click="togglePushPreference('enabled')"
          />
        </div>
        <p v-if="!pushPreferences.enabled" class="hint push-paused">Le push sono sospese. Le preferenze per categoria restano salvate.</p>
        <div class="push-category-list">
          <div class="switch-row push-preference-row">
            <div class="push-preference-copy">
              <strong>Eventi</strong>
              <p class="hint">Promemoria del calendario.</p>
            </div>
            <button
              type="button"
              class="switch"
              :class="{ on: pushPreferences.events }"
              role="switch"
              aria-label="Notifiche per gli eventi"
              :aria-checked="pushPreferences.events"
              :disabled="pushPreferencesLoading || pushPreferencesSaving"
              @click="togglePushPreference('events')"
            />
          </div>
          <div class="switch-row push-preference-row">
            <div class="push-preference-copy">
              <strong>Scadenze</strong>
              <p class="hint">Promemoria di bollette e altre scadenze.</p>
            </div>
            <button
              type="button"
              class="switch"
              :class="{ on: pushPreferences.deadlines }"
              role="switch"
              aria-label="Notifiche per le scadenze"
              :aria-checked="pushPreferences.deadlines"
              :disabled="pushPreferencesLoading || pushPreferencesSaving"
              @click="togglePushPreference('deadlines')"
            />
          </div>
          <div class="switch-row push-preference-row">
            <div class="push-preference-copy">
              <strong>Piante</strong>
              <p class="hint">Promemoria per annaffiature e altre cure.</p>
            </div>
            <button
              type="button"
              class="switch"
              :class="{ on: pushPreferences.plants }"
              role="switch"
              aria-label="Notifiche per le piante"
              :aria-checked="pushPreferences.plants"
              :disabled="pushPreferencesLoading || pushPreferencesSaving"
              @click="togglePushPreference('plants')"
            />
          </div>
          <div class="switch-row push-preference-row">
            <div class="push-preference-copy">
              <strong>Veicoli</strong>
              <p class="hint">Promemoria per revisioni, assicurazioni e manutenzioni.</p>
            </div>
            <button
              type="button"
              class="switch"
              :class="{ on: pushPreferences.vehicles }"
              role="switch"
              aria-label="Notifiche per i veicoli"
              :aria-checked="pushPreferences.vehicles"
              :disabled="pushPreferencesLoading || pushPreferencesSaving"
              @click="togglePushPreference('vehicles')"
            />
          </div>
          <div class="switch-row push-preference-row">
            <div class="push-preference-copy">
              <strong>Farmaci</strong>
              <p class="hint">Promemoria personali per le assunzioni programmate.</p>
            </div>
            <button
              type="button"
              class="switch"
              :class="{ on: pushPreferences.medications }"
              role="switch"
              aria-label="Notifiche per i farmaci"
              :aria-checked="pushPreferences.medications"
              :disabled="pushPreferencesLoading || pushPreferencesSaving"
              @click="togglePushPreference('medications')"
            />
          </div>
        </div>
      </div>
      <div class="push-actions">
        <button v-if="!pushEnabledHere" type="button" class="btn btn-primary" :disabled="!pushReady || pushBusy || pushPermission === 'denied'" @click="enablePush">
          <span v-if="pushBusy" class="spinner" /> Attiva su questo dispositivo
        </button>
        <template v-else>
          <button type="button" class="btn btn-soft" :disabled="pushBusy || !pushPreferences.enabled" @click="testPush">Invia una prova</button>
          <button type="button" class="btn btn-ghost" :disabled="pushBusy" @click="disablePush">Disattiva</button>
        </template>
        <button type="button" class="btn btn-ghost" @click="pushTutorialOpen = true">Come attivare le notifiche push</button>
      </div>
    </section>

    <section class="card">
      <header class="card-head">
        <div>
          <p class="eyebrow">Dati personali</p>
          <h2>Come ti chiami</h2>
        </div>
      </header>
      <div class="stack">
        <div class="form-grid">
          <div class="field">
            <label for="p-name">Nome</label>
            <input id="p-name" v-model="form.name" class="input" maxlength="40" />
          </div>
          <div class="field">
            <label for="p-email">Email</label>
            <input id="p-email" v-model="form.email" class="input" type="email" placeholder="nome@email.it" />
            <span class="hint">Email di contatto facoltativa.</span>
          </div>
        </div>

        <div class="field">
          <label>Colore</label>
          <div class="color-row">
            <button v-for="color in USER_COLORS" :key="color" type="button" class="color-dot" :class="{ active: form.color === color }" :style="{ background: color }" :aria-label="`Colore ${color}`" @click="form.color = color" />
          </div>
        </div>

        <div class="field">
          <label>Icona</label>
          <div class="emoji-row">
            <button v-for="emoji in USER_EMOJIS" :key="emoji" type="button" class="emoji-btn" :class="{ active: form.emoji === emoji }" @click="form.emoji = emoji">{{ emoji }}</button>
          </div>
        </div>

        <p v-if="profileError" class="error-text">{{ profileError }}</p>

        <div class="form-foot">
          <button type="button" class="btn btn-primary" :disabled="saving" @click="saveProfile">
            <span v-if="saving" class="spinner" /> Salva profilo
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <header class="card-head">
        <div>
          <p class="eyebrow">Sicurezza</p>
          <h2>Cambia il PIN</h2>
          <p class="card-note">4 cifre, facili da ricordare ma solo tue.</p>
        </div>
        <span class="pin-lock"><Icon name="lock" :size="18" /></span>
      </header>

      <div class="form-grid">
        <div class="field">
          <label for="pin-current">PIN attuale</label>
          <input id="pin-current" v-model="pinForm.currentPin" class="input pin-input" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" placeholder="••••" />
        </div>
        <div class="field">
          <label for="pin-new">Nuovo PIN</label>
          <input id="pin-new" v-model="pinForm.newPin" class="input pin-input" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••" />
        </div>
        <div class="field">
          <label for="pin-confirm">Ripeti il nuovo PIN</label>
          <input id="pin-confirm" v-model="pinForm.confirmPin" class="input pin-input" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••" />
        </div>
      </div>

      <p v-if="pinError" class="error-text" style="margin-top: 10px">{{ pinError }}</p>

      <div class="form-foot">
        <span class="hint">Dopo il cambio, gli altri dispositivi dovranno rientrare.</span>
        <button type="button" class="btn btn-primary" :disabled="savingPin" @click="changePin">
          <span v-if="savingPin" class="spinner" /> Aggiorna PIN
        </button>
      </div>
    </section>

    <BaseModal
      v-model="pushTutorialOpen"
      title="Come attivare le notifiche push"
      subtitle="Le notifiche sono personali e vanno abilitate su ogni dispositivo."
      size="md"
    >
      <ol class="push-tutorial">
        <li><strong>Apri Ghibiri Home con una connessione sicura.</strong> Le push richiedono HTTPS (oppure localhost per prove locali).</li>
        <li><strong>Premi “Attiva su questo dispositivo”</strong> e scegli “Consenti” nella richiesta del browser.</li>
        <li v-if="isIosDevice">
          <strong>Su iPhone o iPad:</strong> apri il sito in Safari, usa Condividi → Aggiungi alla schermata Home, avvia l’app dalla nuova icona e poi attiva le notifiche. Richiede iOS/iPadOS 16.4 o successivo.
        </li>
        <li v-else>
          <strong>Se non compare la richiesta:</strong> controlla nelle impostazioni del browser che le notifiche per questo sito siano consentite.
        </li>
        <li>Puoi inviare una notifica di prova o disattivare questo dispositivo da questa scheda. Gli altri dispositivi restano indipendenti.</li>
      </ol>
      <p class="hint">Il server deve avere le chiavi VAPID configurate; se mancano, chiedi all’amministratore di completare la configurazione.</p>
      <template #footer>
        <button type="button" class="btn btn-primary" @click="pushTutorialOpen = false">Ho capito</button>
      </template>
    </BaseModal>

    <section class="card card-soft">
      <div class="app-info">
        <div>
          <p class="eyebrow">Ghibiri Home</p>
          <p class="small muted">La casa di famiglia, organizzata. Dati privati, sul tuo server.</p>
        </div>
        <span class="badge badge-sage"><Icon name="shield" :size="11" /> solo famiglia</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 780px;
}
.profile-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.profile-id {
  flex: 1;
  min-width: 0;
}
.profile-id h2 {
  font-size: 28px;
  line-height: 1.1;
}
.profile-id p {
  margin-top: 4px;
}
.color-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.color-dot {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  box-shadow: inset 0 0 0 2px var(--surface);
}
.color-dot.active {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
.emoji-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.emoji-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 19px;
  cursor: pointer;
}
.emoji-btn.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.form-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
.pin-lock {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--muted);
  display: grid;
  place-items: center;
}
.pin-input {
  letter-spacing: 0.4em;
  font-size: 18px;
  text-align: center;
}
.app-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.push-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.push-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.push-preferences {
  margin-top: 18px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
.push-preference-row {
  border-bottom: 1px solid var(--line);
}
.push-preference-copy {
  min-width: 0;
}
.push-preference-copy strong {
  display: block;
  font-size: 13.5px;
}
.push-preference-copy .hint {
  display: block;
  margin-top: 3px;
}
.push-paused {
  margin: 10px 0;
}
.push-category-list {
  padding-left: 14px;
}
.push-tutorial {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-left: 22px;
  color: var(--ink-soft);
  font-size: 13.5px;
  line-height: 1.55;
}
.push-tutorial strong {
  color: var(--ink);
}
.push-tutorial + .hint {
  display: block;
  margin-top: 16px;
}
@media (max-width: 640px) {
  .form-foot .btn {
    width: 100%;
  }
  .profile-hero {
    gap: 14px;
  }
}
</style>
