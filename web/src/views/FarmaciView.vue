<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api.js';
import { useAuthStore } from '@/stores/auth.js';
import { useUiStore } from '@/stores/ui.js';
import { formatDateTime as formatLocalDateTime, todayString } from '@/utils/format.js';
import PageHeader from '@/components/PageHeader.vue';
import BaseModal from '@/components/BaseModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();
const medications = ref([]);
const users = ref([]);
const homeToday = ref(todayString());
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const modalOpen = ref(false);
const historyOpen = ref(false);
const historyMedication = ref(null);
const historyDoses = ref([]);
const busyDose = ref('');
const editing = ref(null);
const form = reactive({
  name: '',
  dosage: '',
  instructions: '',
  startDate: todayString(),
  endDate: '',
  frequency: 'daily',
  intervalDays: 3,
  visibility: 'private',
  ownerUserId: '',
});
const times = ref(['09:00']);
const frequencies = [
  { value: 'daily', label: 'Ogni giorno' },
  { value: 'every_two_days', label: 'Ogni 2 giorni' },
  { value: 'weekly', label: 'Ogni settimana' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'custom', label: 'Personalizzato' },
];

const activeMedications = computed(() => medications.value.filter((item) => item.isActive));
const pausedMedications = computed(() => medications.value.filter((item) => !item.isActive));

function frequencyLabel(medication) {
  if (medication.frequency === 'custom') return `Ogni ${medication.intervalDays} giorni`;
  return frequencies.find((item) => item.value === medication.frequency)?.label || '';
}

function isOwner(medication) {
  return medication.owner.id === auth.user?.id;
}

async function load() {
  loading.value = true;
  try {
    const data = await api('/api/medications');
    medications.value = data.medications;
    users.value = data.users;
    homeToday.value = data.today;
  } catch (err) {
    ui.error(err.message);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  editing.value = null;
  Object.assign(form, {
    name: '',
    dosage: '',
    instructions: '',
    startDate: homeToday.value,
    endDate: '',
    frequency: 'daily',
    intervalDays: 3,
    visibility: 'private',
    ownerUserId: String(auth.user?.id || ''),
  });
  times.value = ['09:00'];
  error.value = '';
}

function openNew() {
  resetForm();
  modalOpen.value = true;
}

function openFromQuickAdd() {
  if (route.query.nuovo !== '1') return;
  openNew();
  const query = { ...route.query };
  delete query.nuovo;
  router.replace({ query });
}

function openEdit(medication) {
  editing.value = medication;
  Object.assign(form, {
    name: medication.name,
    dosage: medication.dosage,
    instructions: medication.instructions,
    startDate: medication.startDate,
    endDate: medication.endDate || '',
    frequency: medication.frequency,
    intervalDays: medication.intervalDays,
    visibility: medication.visibility,
    ownerUserId: String(medication.owner.id),
  });
  times.value = [...medication.times];
  error.value = '';
  modalOpen.value = true;
}

async function save() {
  if (!form.name.trim()) {
    error.value = 'Inserisci il nome del farmaco.';
    return;
  }
  if (!form.startDate || !times.value.length || times.value.some((time) => !time)) {
    error.value = 'Inserisci la data di inizio e almeno un orario valido.';
    return;
  }
  if (new Set(times.value).size !== times.value.length) {
    error.value = 'Rimuovi gli orari duplicati.';
    return;
  }
  if (form.frequency === 'custom' && (!Number.isInteger(Number(form.intervalDays)) || Number(form.intervalDays) < 1)) {
    error.value = 'Indica un intervallo personalizzato valido.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const body = {
      name: form.name.trim(),
      dosage: form.dosage.trim(),
      instructions: form.instructions.trim() || null,
      startDate: form.startDate,
      endDate: form.endDate || null,
      frequency: form.frequency,
      intervalDays: form.frequency === 'custom' ? Number(form.intervalDays) : 1,
      times: [...times.value].sort(),
      visibility: form.visibility,
      ownerUserId: form.visibility === 'shared' ? Number(form.ownerUserId || auth.user.id) : auth.user.id,
    };
    if (editing.value) {
      await api(`/api/medications/${editing.value.id}`, { method: 'PATCH', body });
      ui.success('Farmaco aggiornato.');
    } else {
      await api('/api/medications', { method: 'POST', body });
      ui.success('Farmaco aggiunto.');
    }
    modalOpen.value = false;
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function recordDose(medication, dose, status) {
  const key = `${medication.id}:${dose.scheduledAt}`;
  if (busyDose.value) return;
  busyDose.value = key;
  try {
    await api(`/api/medications/${medication.id}/doses`, {
      method: 'POST',
      body: { scheduledAt: dose.scheduledAt, status },
    });
    ui.success(status === 'taken' ? 'Assunzione registrata.' : 'Dose saltata registrata.');
    await load();
  } catch (err) {
    ui.error(err.message);
  } finally {
    busyDose.value = '';
  }
}

async function toggleActive(medication) {
  try {
    await api(`/api/medications/${medication.id}`, { method: 'PATCH', body: { isActive: !medication.isActive } });
    ui.success(medication.isActive ? 'Promemoria sospesi.' : 'Promemoria riattivati.');
    await load();
  } catch (err) {
    ui.error(err.message);
  }
}

async function remove(medication) {
  const confirmed = await ui.confirm({
    title: 'Eliminare il farmaco?',
    message: 'Verranno eliminati anche lo storico delle assunzioni e i promemoria.',
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/medications/${medication.id}`, { method: 'DELETE' });
    ui.success('Farmaco eliminato.');
    await load();
  } catch (err) {
    ui.error(err.message);
  }
}

async function openHistory(medication) {
  try {
    const data = await api(`/api/medications/${medication.id}`);
    historyMedication.value = data.medication;
    historyDoses.value = data.doses;
    historyOpen.value = true;
  } catch (err) {
    ui.error(err.message);
  }
}

onMounted(async () => {
  await load();
  openFromQuickAdd();
});

watch(() => route.query.nuovo, (value) => {
  if (value === '1') openFromQuickAdd();
});
</script>

<template>
  <div class="page-stack medication-page">
    <PageHeader
      eyebrow="Benessere"
      title="Farmaci"
      :subtitle="activeMedications.length ? `${activeMedications.length} ${activeMedications.length === 1 ? 'terapia attiva' : 'terapie attive'} e promemoria personali.` : 'Terapie, assunzioni e promemoria in un unico posto.'"
    >
      <template #actions>
        <button type="button" class="btn btn-primary" @click="openNew">
          <Icon name="plus" :size="17" /> Aggiungi farmaco
        </button>
      </template>
    </PageHeader>

    <section v-if="!loading && !medications.length" class="card">
      <EmptyState
        icon="pill"
        tone="rose"
        title="Nessuna terapia registrata"
        text="Aggiungi un farmaco per impostare la frequenza e ricevere promemoria push."
      >
        <button type="button" class="btn btn-primary" @click="openNew">Aggiungi il primo farmaco</button>
      </EmptyState>
    </section>

    <div v-else-if="loading" class="card loading-card"><span class="spinner" /> Caricamento terapie…</div>

    <section v-else class="medication-list" aria-label="Farmaci attivi">
      <article v-for="medication in activeMedications" :key="medication.id" class="card medication-card">
        <header class="medication-head">
          <span class="medication-icon"><Icon name="pill" :size="21" /></span>
          <div class="medication-title">
            <h2>{{ medication.name }}</h2>
            <p v-if="medication.dosage">{{ medication.dosage }}</p>
          </div>
          <span class="badge" :class="medication.visibility === 'shared' ? 'badge-blue' : 'badge-rose'">
            {{ medication.visibility === 'shared' ? 'Condiviso' : 'Privato' }}
          </span>
          <button type="button" class="btn-icon" :aria-label="`Modifica ${medication.name}`" @click="openEdit(medication)">
            <Icon name="edit" :size="17" />
          </button>
        </header>

        <div class="medication-meta">
          <span><Icon name="calendar" :size="14" /> {{ frequencyLabel(medication) }}</span>
          <span><Icon name="clock" :size="14" /> {{ medication.times.join(' · ') }}</span>
          <span v-if="medication.visibility === 'shared'"><Icon name="user" :size="14" /> Per {{ medication.owner.name }}</span>
        </div>
        <p v-if="medication.instructions" class="medication-instructions">{{ medication.instructions }}</p>

        <div v-if="medication.todayDoses.length" class="dose-list">
          <div v-for="dose in medication.todayDoses" :key="dose.scheduledAt" class="dose-row">
            <div class="dose-time">
              <strong>{{ dose.time }}</strong>
              <span v-if="dose.status === 'taken'" class="badge badge-sage">Assunta</span>
              <span v-else-if="dose.status === 'skipped'" class="badge badge-gold">Saltata</span>
              <span v-else-if="dose.status === 'upcoming'" class="badge badge-blue">In programma</span>
              <span v-else class="badge badge-rose">Da assumere</span>
            </div>
            <span v-if="dose.dose" class="dose-note">
              {{ dose.status === 'taken' ? `Registrata alle ${dose.dose.takenAtLocal.slice(11, 16)}` : `Segnata da ${dose.dose.takenBy?.name || 'un profilo'}` }}
            </span>
            <span v-else-if="dose.status === 'upcoming'" class="dose-note">Promemoria alle {{ dose.time }}</span>
            <div v-else class="dose-actions">
              <button
                type="button"
                class="btn btn-soft btn-sm"
                :disabled="busyDose !== ''"
                @click="recordDose(medication, dose, 'taken')"
              >
                <Icon name="check" :size="14" /> Assunta
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="busyDose !== ''"
                @click="recordDose(medication, dose, 'skipped')"
              >
                Saltata
              </button>
            </div>
          </div>
        </div>
        <p v-else class="hint no-dose-today">Nessuna assunzione programmata per oggi.</p>

        <footer class="medication-actions">
          <button type="button" class="btn btn-ghost btn-sm" @click="openHistory(medication)">Storico assunzioni</button>
          <span class="action-spacer" />
          <button type="button" class="btn btn-ghost btn-sm" @click="toggleActive(medication)">Sospendi promemoria</button>
          <button v-if="isOwner(medication)" type="button" class="btn btn-ghost btn-sm" @click="remove(medication)">Elimina</button>
        </footer>
      </article>
    </section>

    <section v-if="pausedMedications.length" class="paused-section">
      <h2 class="section-title">Terapie sospese</h2>
      <article v-for="medication in pausedMedications" :key="medication.id" class="card paused-medication">
        <div>
          <strong>{{ medication.name }}</strong>
          <p class="hint">{{ frequencyLabel(medication) }} · promemoria sospesi</p>
        </div>
        <div class="paused-actions">
          <button type="button" class="btn btn-soft btn-sm" @click="toggleActive(medication)">Riattiva</button>
          <button v-if="isOwner(medication)" type="button" class="btn btn-ghost btn-sm" @click="openEdit(medication)">Modifica</button>
        </div>
      </article>
    </section>

    <p class="medication-disclaimer">
      Promemoria organizzativi: non sostituiscono le indicazioni del medico o del farmacista. Le notifiche push dei farmaci sono inviate solo ai dispositivi del profilo assegnato.
    </p>

    <BaseModal
      v-model="modalOpen"
      :title="editing ? 'Modifica farmaco' : 'Nuovo farmaco'"
      subtitle="Imposta il piano indicato dal tuo medico o farmacista."
      size="lg"
    >
      <div class="form-grid medication-form">
        <div class="field full">
          <label for="med-name">Nome del farmaco</label>
          <input id="med-name" v-model="form.name" class="input" maxlength="100" placeholder="Nome" />
        </div>
        <div class="field">
          <label for="med-dosage">Dose o quantità</label>
          <input id="med-dosage" v-model="form.dosage" class="input" maxlength="100" placeholder="Es. 1 compressa" />
        </div>
        <div class="field">
          <label for="med-frequency">Frequenza</label>
          <select id="med-frequency" v-model="form.frequency" class="input">
            <option v-for="item in frequencies" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
        <div v-if="form.frequency === 'custom'" class="field">
          <label for="med-interval">Intervallo in giorni</label>
          <input id="med-interval" v-model.number="form.intervalDays" class="input" type="number" min="1" max="365" />
        </div>
        <div class="field">
          <label for="med-start">Inizio terapia</label>
          <input id="med-start" v-model="form.startDate" class="input" type="date" />
        </div>
        <div class="field">
          <label for="med-end">Fine terapia (facoltativa)</label>
          <input id="med-end" v-model="form.endDate" class="input" type="date" />
        </div>
        <div class="field full">
          <label>Orari di assunzione</label>
          <div v-for="(time, index) in times" :key="index" class="time-input-row">
            <input v-model="times[index]" class="input" type="time" :aria-label="`Orario di assunzione ${index + 1}`" />
            <button
              v-if="times.length > 1"
              type="button"
              class="btn-icon"
              :aria-label="`Rimuovi orario ${index + 1}`"
              @click="times.splice(index, 1)"
            >
              <Icon name="trash" :size="16" />
            </button>
          </div>
          <button v-if="times.length < 8" type="button" class="btn btn-ghost btn-sm add-time" @click="times.push('12:00')">
            <Icon name="plus" :size="14" /> Aggiungi un orario
          </button>
        </div>
        <div class="field full">
          <label for="med-instructions">Note (facoltative)</label>
          <textarea id="med-instructions" v-model="form.instructions" class="input" rows="3" maxlength="2000" placeholder="Indicazioni personali da ricordare" />
        </div>
        <div class="field">
          <label for="med-visibility">Visibilità</label>
          <select id="med-visibility" v-model="form.visibility" class="input">
            <option value="private">Privato: solo il profilo assegnato</option>
            <option value="shared" :disabled="editing && editing.visibility === 'shared' && !isOwner(editing)">Condiviso con la casa</option>
          </select>
        </div>
        <div v-if="form.visibility === 'shared'" class="field">
          <label for="med-owner">Profilo assegnato</label>
          <select id="med-owner" v-model="form.ownerUserId" class="input">
            <option v-for="user in users" :key="user.id" :value="String(user.id)">{{ user.emoji }} {{ user.name }}</option>
          </select>
        </div>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <template #footer>
        <button type="button" class="btn btn-ghost" :disabled="saving" @click="modalOpen = false">Annulla</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
          <span v-if="saving" class="spinner" /> {{ editing ? 'Salva modifiche' : 'Aggiungi farmaco' }}
        </button>
      </template>
    </BaseModal>

    <BaseModal
      v-model="historyOpen"
      :title="`Storico · ${historyMedication?.name || 'Farmaco'}`"
      subtitle="Le assunzioni registrate per questa terapia."
      size="md"
    >
      <div v-if="historyDoses.length" class="history-list">
        <div v-for="dose in historyDoses" :key="dose.id" class="history-row">
          <span class="history-icon" :class="dose.status"><Icon :name="dose.status === 'taken' ? 'check' : 'x'" :size="15" /></span>
          <span>
            <strong>{{ dose.status === 'taken' ? 'Assunta' : 'Saltata' }} · {{ formatLocalDateTime(dose.scheduledAtLocal) }}</strong>
            <small>{{ dose.status === 'taken' ? `Registrata da ${dose.takenBy?.name || 'profilo non disponibile'}` : `Segnata da ${dose.takenBy?.name || 'profilo non disponibile'}` }}</small>
            <small v-if="dose.note">{{ dose.note }}</small>
          </span>
        </div>
      </div>
      <EmptyState v-else icon="clock" title="Nessuna assunzione registrata" text="Lo storico si aggiorna quando segni una dose come assunta o saltata." />
      <template #footer>
        <button type="button" class="btn btn-primary" @click="historyOpen = false">Chiudi</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.medication-page {
  max-width: 920px;
}
.medication-list {
  display: grid;
  gap: 14px;
}
.medication-card {
  padding: 20px;
}
.medication-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.medication-icon {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  height: 44px;
  border-radius: 15px;
  background: var(--rose-soft);
  color: var(--rose);
}
.medication-title {
  flex: 1;
  min-width: 0;
}
.medication-title h2 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 21px;
}
.medication-title p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.medication-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 15px 0;
  color: var(--muted);
  font-size: 12.5px;
}
.medication-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.medication-instructions {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 13px;
  white-space: pre-line;
}
.dose-list {
  display: grid;
  gap: 8px;
}
.dose-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 10px;
  border-radius: 13px;
  background: var(--surface-2);
}
.dose-time {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 142px;
}
.dose-time strong {
  font-variant-numeric: tabular-nums;
}
.dose-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.dose-note {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
.no-dose-today {
  margin: 8px 0 0;
}
.medication-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.action-spacer {
  flex: 1;
}
.paused-section {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}
.section-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 21px;
}
.paused-medication {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  opacity: 0.78;
}
.paused-medication p {
  margin: 4px 0 0;
}
.paused-actions {
  display: flex;
  gap: 4px;
}
.medication-disclaimer {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.medication-form {
  row-gap: 16px;
}
.time-input-row {
  display: flex;
  gap: 8px;
  margin-top: 7px;
}
.time-input-row .input {
  max-width: 180px;
}
.add-time {
  margin-top: 8px;
}
.history-list {
  display: grid;
  gap: 14px;
}
.history-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}
.history-row > span:last-child {
  display: grid;
  gap: 3px;
}
.history-row strong {
  font-size: 13px;
}
.history-row small {
  color: var(--muted);
  font-size: 12px;
}
.history-icon {
  display: grid;
  place-items: center;
  flex: 0 0 30px;
  height: 30px;
  border-radius: 50%;
}
.history-icon.taken {
  background: var(--sage-soft);
  color: var(--sage);
}
.history-icon.skipped {
  background: var(--gold-soft);
  color: var(--gold);
}
@media (max-width: 600px) {
  .medication-card {
    padding: 15px;
  }
  .medication-head {
    gap: 8px;
  }
  .medication-head .badge {
    display: none;
  }
  .dose-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .dose-actions,
  .dose-note {
    width: 100%;
    margin-left: 0;
  }
  .medication-actions {
    flex-wrap: wrap;
  }
  .medication-actions .action-spacer {
    display: none;
  }
  .paused-medication {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
