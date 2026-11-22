<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api.js';
import { useUiStore } from '@/stores/ui.js';
import { diffDays, dueLabel, formatDate, todayString } from '@/utils/format.js';
import PageHeader from '@/components/PageHeader.vue';
import BaseModal from '@/components/BaseModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';

const route = useRoute();
const ui = useUiStore();
const vehicles = ref([]);
const users = ref([]);
const records = ref([]);
const selectedVehicleId = ref(null);
const loading = ref(true);
const detailsLoading = ref(false);
const vehicleModalOpen = ref(false);
const recordModalOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const editingVehicle = ref(null);
const editingRecord = ref(null);
const busyRecord = ref(null);

const recordTypes = [
  { id: 'fuel', label: 'Rifornimento', icon: 'fuel' },
  { id: 'service', label: 'Tagliando', icon: 'wrench' },
  { id: 'inspection', label: 'Revisione', icon: 'shield' },
  { id: 'insurance', label: 'Assicurazione', icon: 'file' },
  { id: 'tax', label: 'Bollo', icon: 'receipt' },
  { id: 'tires', label: 'Pneumatici', icon: 'wheel' },
  { id: 'other', label: 'Altro', icon: 'list' },
];

const vehicleForm = reactive({
  name: '',
  type: 'car',
  plate: '',
  mainUserId: '',
  notes: '',
});

const recordForm = reactive({
  type: 'fuel',
  occurredOn: todayString(),
  odometer: '',
  amount: '',
  liters: '',
  description: '',
  nextDueDate: '',
  nextDueOdometer: '',
});

const selectedVehicle = computed(() => vehicles.value.find((vehicle) => vehicle.id === selectedVehicleId.value) || null);
const fuelCount = computed(() => records.value.filter((record) => record.type === 'fuel').length);
const totalSpent = computed(() =>
  records.value.reduce((sum, record) => sum + (Number(record.amount) || 0), 0),
);
const upcomingRecords = computed(() =>
  records.value
    .filter((record) => record.nextDueDate || record.nextDueOdometer !== null)
    .sort((a, b) => (a.nextDueDate || '9999-12-31').localeCompare(b.nextDueDate || '9999-12-31'))
    .slice(0, 3),
);

function vehicleTypeLabel(type) {
  return type === 'scooter' ? 'Scooter' : 'Auto';
}

function recordType(type) {
  return recordTypes.find((item) => item.id === type) || recordTypes.at(-1);
}

function recordAmount(record) {
  if (record.amount === null || record.amount === undefined) return '';
  return Number(record.amount).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function recordMeta(record) {
  const parts = [];
  if (record.odometer !== null) parts.push(`${Number(record.odometer).toLocaleString('it-IT')} km`);
  if (record.liters !== null) parts.push(`${Number(record.liters).toLocaleString('it-IT')} L`);
  if (record.amount !== null) parts.push(recordAmount(record));
  return parts.join(' · ');
}

function loadVehicleDetails(id) {
  if (!id) {
    records.value = [];
    return Promise.resolve();
  }
  detailsLoading.value = true;
  return api(`/api/vehicles/${id}`)
    .then((data) => {
      records.value = data.records;
      vehicles.value = vehicles.value.map((vehicle) => vehicle.id === id ? data.vehicle : vehicle);
    })
    .catch((err) => ui.error(err.message))
    .finally(() => {
      detailsLoading.value = false;
    });
}

async function load() {
  loading.value = true;
  try {
    const data = await api('/api/vehicles');
    vehicles.value = data.vehicles;
    users.value = data.users;
    if (!vehicles.value.some((vehicle) => vehicle.id === selectedVehicleId.value)) {
      selectedVehicleId.value = vehicles.value[0]?.id || null;
    }
    await loadVehicleDetails(selectedVehicleId.value);
  } catch (err) {
    ui.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function selectVehicle(vehicle) {
  if (selectedVehicleId.value === vehicle.id) return;
  selectedVehicleId.value = vehicle.id;
  await loadVehicleDetails(vehicle.id);
}

function resetVehicleForm() {
  editingVehicle.value = null;
  Object.assign(vehicleForm, { name: '', type: 'car', plate: '', mainUserId: '', notes: '' });
  formError.value = '';
}

function openNewVehicle() {
  resetVehicleForm();
  vehicleModalOpen.value = true;
}

function openEditVehicle() {
  if (!selectedVehicle.value) return;
  editingVehicle.value = selectedVehicle.value;
  Object.assign(vehicleForm, {
    name: selectedVehicle.value.name,
    type: selectedVehicle.value.type,
    plate: selectedVehicle.value.plate,
    mainUserId: selectedVehicle.value.mainUser?.id ? String(selectedVehicle.value.mainUser.id) : '',
    notes: selectedVehicle.value.notes,
  });
  formError.value = '';
  vehicleModalOpen.value = true;
}

async function saveVehicle() {
  if (!vehicleForm.name.trim()) {
    formError.value = 'Inserisci il nome o modello del veicolo.';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const body = {
      name: vehicleForm.name.trim(),
      type: vehicleForm.type,
      plate: vehicleForm.plate.trim() || null,
      mainUserId: vehicleForm.mainUserId ? Number(vehicleForm.mainUserId) : null,
      notes: vehicleForm.notes.trim() || null,
    };
    if (editingVehicle.value) {
      const data = await api(`/api/vehicles/${editingVehicle.value.id}`, { method: 'PATCH', body });
      selectedVehicleId.value = data.vehicle.id;
      ui.success('Veicolo aggiornato.');
    } else {
      const data = await api('/api/vehicles', { method: 'POST', body });
      selectedVehicleId.value = data.vehicle.id;
      ui.success('Veicolo aggiunto.');
    }
    vehicleModalOpen.value = false;
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

function resetRecordForm() {
  editingRecord.value = null;
  Object.assign(recordForm, {
    type: 'fuel',
    occurredOn: todayString(),
    odometer: selectedVehicle.value?.lastOdometer ?? '',
    amount: '',
    liters: '',
    description: '',
    nextDueDate: '',
    nextDueOdometer: '',
  });
  formError.value = '';
}

function openNewRecord() {
  resetRecordForm();
  recordModalOpen.value = true;
}

function openEditRecord(record) {
  editingRecord.value = record;
  Object.assign(recordForm, {
    type: record.type,
    occurredOn: record.occurredOn,
    odometer: record.odometer ?? '',
    amount: record.amount ?? '',
    liters: record.liters ?? '',
    description: record.description,
    nextDueDate: record.nextDueDate || '',
    nextDueOdometer: record.nextDueOdometer ?? '',
  });
  formError.value = '';
  recordModalOpen.value = true;
}

async function saveRecord() {
  if (!selectedVehicle.value) return;
  if (!recordForm.occurredOn) {
    formError.value = 'Scegli la data dell’attività.';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const body = {
      type: recordForm.type,
      occurredOn: recordForm.occurredOn,
      odometer: recordForm.odometer === '' ? null : Number(recordForm.odometer),
      amount: recordForm.amount === '' ? null : Number(recordForm.amount),
      liters: recordForm.type === 'fuel' && recordForm.liters !== '' ? Number(recordForm.liters) : null,
      description: recordForm.description.trim() || null,
      nextDueDate: recordForm.type !== 'fuel' ? recordForm.nextDueDate || null : null,
      nextDueOdometer: recordForm.type !== 'fuel' && recordForm.nextDueOdometer !== '' ? Number(recordForm.nextDueOdometer) : null,
    };
    if (editingRecord.value) {
      await api(`/api/vehicles/${selectedVehicle.value.id}/records/${editingRecord.value.id}`, { method: 'PATCH', body });
      ui.success('Attività aggiornata.');
    } else {
      await api(`/api/vehicles/${selectedVehicle.value.id}/records`, { method: 'POST', body });
      ui.success('Attività registrata.');
    }
    recordModalOpen.value = false;
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeVehicle() {
  if (!selectedVehicle.value) return;
  const vehicle = selectedVehicle.value;
  const confirmed = await ui.confirm({
    title: `Rimuovere ${vehicle.name}?`,
    message: 'Il veicolo e tutto il suo storico verranno eliminati.',
    confirmLabel: 'Rimuovi',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/vehicles/${vehicle.id}`, { method: 'DELETE' });
    vehicles.value = vehicles.value.filter((item) => item.id !== vehicle.id);
    selectedVehicleId.value = vehicles.value[0]?.id || null;
    await load();
    ui.success('Veicolo rimosso.');
  } catch (err) {
    ui.error(err.message);
  }
}

async function removeRecord(record) {
  const confirmed = await ui.confirm({
    title: 'Eliminare questa attività?',
    message: 'La registrazione verrà rimossa dallo storico del veicolo.',
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!confirmed) return;
  busyRecord.value = record.id;
  try {
    await api(`/api/vehicles/${selectedVehicle.value.id}/records/${record.id}`, { method: 'DELETE' });
    await load();
    ui.success('Attività eliminata.');
  } catch (err) {
    ui.error(err.message);
  } finally {
    busyRecord.value = null;
  }
}

function dueText(record) {
  const parts = [];
  if (record.nextDueDate) {
    const days = diffDays(todayString(), record.nextDueDate);
    parts.push(days < 0 ? `Scaduta · ${dueLabel(days)}` : days === 0 ? 'Scade oggi' : `Entro ${formatDate(record.nextDueDate)}`);
  }
  if (record.nextDueOdometer !== null) {
    const dueAt = Number(record.nextDueOdometer).toLocaleString('it-IT');
    const current = selectedVehicle.value?.lastOdometer;
    const remaining = current === null ? null : Number(record.nextDueOdometer) - Number(current);
    parts.push(remaining === null ? `Entro ${dueAt} km` : remaining <= 0 ? `Controllo a ${dueAt} km da fare` : `${remaining.toLocaleString('it-IT')} km al controllo`);
  }
  return parts.join(' · ');
}

onMounted(async () => {
  await load();
  if (route.query.nuovo === '1') openNewVehicle();
});
</script>

<template>
  <div class="page-stack vehicles-page">
    <PageHeader
      eyebrow="In viaggio"
      title="Veicoli"
      :subtitle="vehicles.length ? `${vehicles.length} ${vehicles.length === 1 ? 'veicolo' : 'veicoli'} in famiglia` : 'Documenti, spese e manutenzioni, tutti a portata di mano.'"
    >
      <template #actions>
        <button type="button" class="btn btn-primary" @click="openNewVehicle">
          <Icon name="plus" :size="17" /> Aggiungi veicolo
        </button>
      </template>
    </PageHeader>

    <div v-if="loading" class="vehicle-grid" aria-label="Caricamento veicoli">
      <div v-for="i in 2" :key="i" class="vehicle-card vehicle-skeleton">
        <span class="shimmer" />
        <span class="shimmer" />
        <span class="shimmer" />
      </div>
    </div>

    <EmptyState
      v-else-if="!vehicles.length"
      icon="car"
      title="Nessun veicolo registrato"
      text="Aggiungi l’auto o lo scooter di famiglia per tenere insieme rifornimenti, tagliandi e scadenze."
      tone="gold"
    >
      <button type="button" class="btn btn-primary" @click="openNewVehicle">
        <Icon name="plus" :size="16" /> Aggiungi il primo veicolo
      </button>
    </EmptyState>

    <template v-else>
      <div class="vehicle-grid" aria-label="Veicoli della famiglia">
        <button
          v-for="vehicle in vehicles"
          :key="vehicle.id"
          type="button"
          class="vehicle-card"
          :class="{ active: selectedVehicleId === vehicle.id }"
          :aria-pressed="selectedVehicleId === vehicle.id"
          @click="selectVehicle(vehicle)"
        >
          <span class="vehicle-card-top">
            <span class="vehicle-icon" :class="vehicle.type">
              <Icon :name="vehicle.type === 'scooter' ? 'scooter' : 'car'" :size="23" />
            </span>
            <span v-if="vehicle.plate" class="vehicle-plate">{{ vehicle.plate }}</span>
          </span>
          <span class="vehicle-card-name">{{ vehicle.name }}</span>
          <span class="vehicle-card-meta">
            <span>{{ vehicleTypeLabel(vehicle.type) }}</span>
            <span v-if="vehicle.mainUser"><span class="vehicle-user-emoji">{{ vehicle.mainUser.emoji }}</span> {{ vehicle.mainUser.name }}</span>
          </span>
          <span class="vehicle-card-foot">
            <span v-if="vehicle.lastOdometer !== null">{{ Number(vehicle.lastOdometer).toLocaleString('it-IT') }} km</span>
            <span v-else>{{ vehicle.recordCount }} attività</span>
            <Icon name="chevron-right" :size="16" />
          </span>
        </button>
      </div>

      <section v-if="selectedVehicle" class="vehicle-detail">
        <header class="vehicle-detail-head">
          <div class="vehicle-detail-title">
            <span class="vehicle-icon large" :class="selectedVehicle.type">
              <Icon :name="selectedVehicle.type === 'scooter' ? 'scooter' : 'car'" :size="25" />
            </span>
            <div>
              <p class="eyebrow">{{ vehicleTypeLabel(selectedVehicle.type) }}{{ selectedVehicle.plate ? ` · ${selectedVehicle.plate}` : '' }}</p>
              <h2>{{ selectedVehicle.name }}</h2>
              <p v-if="selectedVehicle.mainUser" class="vehicle-primary-user">
                {{ selectedVehicle.mainUser.emoji }} Utilizzato principalmente da {{ selectedVehicle.mainUser.name }}
              </p>
            </div>
          </div>
          <div class="vehicle-detail-actions">
            <button type="button" class="btn btn-ghost btn-sm" @click="openEditVehicle">
              <Icon name="edit" :size="15" /> Modifica
            </button>
            <button type="button" class="icon-btn vehicle-remove" :aria-label="`Rimuovi ${selectedVehicle.name}`" title="Rimuovi veicolo" @click="removeVehicle">
              <Icon name="trash" :size="16" />
            </button>
          </div>
        </header>

        <p v-if="selectedVehicle.notes" class="vehicle-notes">{{ selectedVehicle.notes }}</p>

        <div class="vehicle-stats">
          <div class="vehicle-stat">
            <span class="vehicle-stat-icon fuel"><Icon name="fuel" :size="17" /></span>
            <span><small>Rifornimenti</small><strong>{{ fuelCount }}</strong></span>
          </div>
          <div class="vehicle-stat">
            <span class="vehicle-stat-icon spent"><Icon name="basket" :size="17" /></span>
            <span><small>Spese registrate</small><strong>{{ totalSpent.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) }}</strong></span>
          </div>
          <div class="vehicle-stat">
            <span class="vehicle-stat-icon odometer"><Icon name="refresh" :size="17" /></span>
            <span><small>Ultimo chilometraggio</small><strong>{{ selectedVehicle.lastOdometer !== null ? `${Number(selectedVehicle.lastOdometer).toLocaleString('it-IT')} km` : '—' }}</strong></span>
          </div>
        </div>

        <section v-if="upcomingRecords.length" class="vehicle-reminders">
          <div class="vehicle-section-title">
            <div><p class="eyebrow">Da tenere d’occhio</p><h3>Prossime scadenze</h3></div>
          </div>
          <div class="reminder-grid">
            <div v-for="record in upcomingRecords" :key="record.id" class="vehicle-reminder">
              <span class="vehicle-reminder-icon"><Icon :name="recordType(record.type).icon" :size="17" /></span>
              <span><strong>{{ record.description || recordType(record.type).label }}</strong><small>{{ dueText(record) }}</small></span>
            </div>
          </div>
        </section>

        <section class="vehicle-history">
          <header class="vehicle-section-title">
            <div><p class="eyebrow">Il diario del veicolo</p><h3>Attività e spese</h3></div>
            <button type="button" class="btn btn-primary btn-sm" @click="openNewRecord">
              <Icon name="plus" :size="15" /> Registra attività
            </button>
          </header>

          <div v-if="detailsLoading" class="vehicle-history-loading"><span class="spinner" /> Carico lo storico…</div>
          <EmptyState
            v-else-if="!records.length"
            icon="list"
            title="Storico ancora vuoto"
            text="Registra il primo rifornimento, tagliando o documento."
            tone="sage"
          >
            <button type="button" class="btn btn-soft" @click="openNewRecord">
              <Icon name="plus" :size="16" /> Registra attività
            </button>
          </EmptyState>

          <div v-else class="vehicle-record-list">
            <article v-for="record in records" :key="record.id" class="vehicle-record">
              <span class="record-icon" :class="record.type">
                <Icon :name="recordType(record.type).icon" :size="18" />
              </span>
              <div class="record-copy">
                <strong>{{ record.description || recordType(record.type).label }}</strong>
                <span class="record-sub">
                  {{ recordType(record.type).label }} · {{ formatDate(record.occurredOn, { year: true }) }}
                  <template v-if="recordMeta(record)"> · {{ recordMeta(record) }}</template>
                </span>
                <span v-if="record.nextDueDate || record.nextDueOdometer" class="record-next">
                  Prossimo controllo:
                  <template v-if="record.nextDueDate">{{ formatDate(record.nextDueDate, { year: true }) }}</template>
                  <template v-if="record.nextDueDate && record.nextDueOdometer"> · </template>
                  <template v-if="record.nextDueOdometer">{{ Number(record.nextDueOdometer).toLocaleString('it-IT') }} km</template>
                </span>
              </div>
              <div class="record-actions">
                <strong v-if="record.amount !== null" class="record-amount">{{ recordAmount(record) }}</strong>
                <button type="button" class="icon-btn" :aria-label="`Modifica ${record.description || recordType(record.type).label}`" @click="openEditRecord(record)">
                  <Icon name="edit" :size="15" />
                </button>
                <button type="button" class="icon-btn" :disabled="busyRecord === record.id" :aria-label="`Elimina ${record.description || recordType(record.type).label}`" @click="removeRecord(record)">
                  <Icon name="trash" :size="15" />
                </button>
              </div>
            </article>
          </div>
        </section>
      </section>
    </template>

    <BaseModal
      v-model="vehicleModalOpen"
      :title="editingVehicle ? 'Modifica veicolo' : 'Aggiungi un veicolo'"
      :subtitle="editingVehicle ? 'Aggiorna i dati del veicolo.' : 'Auto e scooter di famiglia, con il loro storico.'"
    >
      <div class="stack">
        <div class="field">
          <label>Tipo di veicolo</label>
          <div class="vehicle-type-options">
            <button type="button" class="vehicle-type-option" :class="{ active: vehicleForm.type === 'car' }" @click="vehicleForm.type = 'car'">
              <Icon name="car" :size="20" /><span>Auto</span>
            </button>
            <button type="button" class="vehicle-type-option" :class="{ active: vehicleForm.type === 'scooter' }" @click="vehicleForm.type = 'scooter'">
              <Icon name="scooter" :size="20" /><span>Scooter</span>
            </button>
          </div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="vehicle-name">Nome o modello</label>
            <input id="vehicle-name" v-model="vehicleForm.name" class="input" maxlength="100" placeholder="es. Fiat Panda" />
          </div>
          <div class="field">
            <label for="vehicle-plate">Targa <span class="optional">(facoltativa)</span></label>
            <input id="vehicle-plate" v-model="vehicleForm.plate" class="input" maxlength="20" placeholder="es. AB123CD" />
          </div>
        </div>
        <div class="field">
          <label for="vehicle-user">Utilizzato principalmente da</label>
          <select id="vehicle-user" v-model="vehicleForm.mainUserId" class="select">
            <option value="">Nessuno in particolare</option>
            <option v-for="user in users" :key="user.id" :value="String(user.id)">{{ user.emoji }} {{ user.name }}</option>
          </select>
        </div>
        <div class="field">
          <label for="vehicle-notes">Note <span class="optional">(facoltative)</span></label>
          <textarea id="vehicle-notes" v-model="vehicleForm.notes" class="textarea" rows="3" maxlength="2000" placeholder="es. seconda chiave nel cassetto…" />
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
      </div>
      <template #footer>
        <button type="button" class="btn btn-ghost" @click="vehicleModalOpen = false">Annulla</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="saveVehicle">
          <span v-if="saving" class="spinner" /> {{ editingVehicle ? 'Salva modifiche' : 'Aggiungi veicolo' }}
        </button>
      </template>
    </BaseModal>

    <BaseModal
      v-model="recordModalOpen"
      :title="editingRecord ? 'Modifica attività' : 'Registra un’attività'"
      :subtitle="selectedVehicle?.name || ''"
      size="lg"
    >
      <div class="stack">
        <div class="field">
          <label>Tipo di attività</label>
          <div class="record-type-options">
            <button
              v-for="type in recordTypes"
              :key="type.id"
              type="button"
              class="record-type-option"
              :class="{ active: recordForm.type === type.id }"
              @click="recordForm.type = type.id"
            >
              <Icon :name="type.icon" :size="16" /><span>{{ type.label }}</span>
            </button>
          </div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="record-date">Data</label>
            <input id="record-date" v-model="recordForm.occurredOn" class="input" type="date" />
          </div>
          <div class="field">
            <label for="record-odometer">Chilometraggio <span class="optional">(km)</span></label>
            <input id="record-odometer" v-model="recordForm.odometer" class="input" type="number" min="0" step="1" placeholder="es. 42500" />
          </div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="record-amount">Importo <span class="optional">(€)</span></label>
            <input id="record-amount" v-model="recordForm.amount" class="input" type="number" min="0" step="0.01" placeholder="es. 65,00" />
          </div>
          <div v-if="recordForm.type === 'fuel'" class="field">
            <label for="record-liters">Litri <span class="optional">(facoltativi)</span></label>
            <input id="record-liters" v-model="recordForm.liters" class="input" type="number" min="0" step="0.01" placeholder="es. 38,5" />
          </div>
        </div>
        <div class="field">
          <label for="record-description">{{ recordForm.type === 'fuel' ? 'Nota' : 'Descrizione' }} <span class="optional">(facoltativa)</span></label>
          <input id="record-description" v-model="recordForm.description" class="input" maxlength="500" :placeholder="recordForm.type === 'fuel' ? 'es. Benzina, distributore…' : 'es. Officina, compagnia, dettagli…'" />
        </div>
        <div v-if="recordForm.type !== 'fuel'" class="form-grid">
          <div class="field">
            <label for="record-next-date">Prossima scadenza <span class="optional">(facoltativa)</span></label>
            <input id="record-next-date" v-model="recordForm.nextDueDate" class="input" type="date" />
          </div>
          <div class="field">
            <label for="record-next-odometer">Prossimo controllo <span class="optional">(km)</span></label>
            <input id="record-next-odometer" v-model="recordForm.nextDueOdometer" class="input" type="number" min="0" step="1" placeholder="es. 50000" />
          </div>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
      </div>
      <template #footer>
        <button type="button" class="btn btn-ghost" @click="recordModalOpen = false">Annulla</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="saveRecord">
          <span v-if="saving" class="spinner" /> {{ editingRecord ? 'Salva modifiche' : 'Registra attività' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.vehicles-page {
  max-width: 1080px;
}
.vehicle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}
.vehicle-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}
button.vehicle-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}
.vehicle-card.active {
  border-color: rgba(192, 85, 58, 0.42);
  background: linear-gradient(145deg, var(--surface), var(--primary-soft));
}
.vehicle-card:focus-visible,
.vehicle-type-option:focus-visible,
.record-type-option:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
.vehicle-card-top {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.vehicle-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 14px;
  background: var(--blue-soft);
  color: var(--blue);
}
.vehicle-icon.scooter {
  background: var(--gold-soft);
  color: var(--gold);
}
.vehicle-icon.large {
  width: 50px;
  height: 50px;
  border-radius: 16px;
}
.vehicle-plate {
  padding: 4px 7px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink-soft);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
}
.vehicle-card-name {
  width: 100%;
  margin-top: 5px;
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vehicle-card-meta,
.vehicle-card-foot {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}
.vehicle-user-emoji {
  margin-left: 4px;
}
.vehicle-card-foot {
  justify-content: space-between;
  margin-top: 5px;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}
.vehicle-skeleton {
  min-height: 155px;
  cursor: default;
}
.vehicle-skeleton .shimmer {
  height: 13px;
}
.vehicle-skeleton .shimmer:first-child {
  width: 44px;
  height: 44px;
  border-radius: 14px;
}
.vehicle-skeleton .shimmer:nth-child(2) {
  width: 65%;
}
.vehicle-skeleton .shimmer:nth-child(3) {
  width: 42%;
}
.vehicle-detail {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.vehicle-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px;
  border-bottom: 1px solid var(--line);
}
.vehicle-detail-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
}
.vehicle-detail-title h2 {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-serif);
  font-size: 25px;
}
.vehicle-detail-title .eyebrow {
  margin-bottom: 4px;
}
.vehicle-primary-user {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.vehicle-detail-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.vehicle-remove {
  color: var(--muted);
}
.vehicle-notes {
  margin: 0;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--muted);
  font-size: 13px;
}
.vehicle-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 16px 24px;
  border-bottom: 1px solid var(--line);
}
.vehicle-stat {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 4px 14px;
  border-right: 1px solid var(--line);
}
.vehicle-stat:first-child {
  padding-left: 0;
}
.vehicle-stat:last-child {
  border-right: 0;
  padding-right: 0;
}
.vehicle-stat-icon,
.vehicle-reminder-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 11px;
  background: var(--gold-soft);
  color: var(--gold);
}
.vehicle-stat-icon.fuel {
  background: var(--sage-soft);
  color: var(--sage);
}
.vehicle-stat-icon.spent {
  background: var(--rose-soft);
  color: var(--rose);
}
.vehicle-stat-icon.odometer {
  background: var(--blue-soft);
  color: var(--blue);
}
.vehicle-stat > span:last-child {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vehicle-stat small {
  color: var(--muted);
  font-size: 11px;
}
.vehicle-stat strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vehicle-reminders,
.vehicle-history {
  padding: 20px 24px;
}
.vehicle-reminders {
  border-bottom: 1px solid var(--line);
  background: linear-gradient(120deg, var(--surface), var(--gold-soft));
}
.vehicle-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 13px;
}
.vehicle-section-title .eyebrow {
  margin: 0 0 3px;
}
.vehicle-section-title h3 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 19px;
}
.reminder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 9px;
}
.vehicle-reminder {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(184, 131, 58, 0.17);
  border-radius: 12px;
  background: var(--surface);
}
.vehicle-reminder > span:last-child {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vehicle-reminder strong {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vehicle-reminder small {
  color: var(--muted);
  font-size: 11px;
}
.vehicle-history-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 25px;
  color: var(--muted);
  font-size: 13px;
}
.vehicle-record-list {
  border-top: 1px solid var(--line);
}
.vehicle-record {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}
.vehicle-record:last-child {
  border-bottom: 0;
}
.record-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 13px;
  background: var(--blue-soft);
  color: var(--blue);
}
.record-icon.fuel {
  background: var(--sage-soft);
  color: var(--sage);
}
.record-icon.service,
.record-icon.tires {
  background: var(--gold-soft);
  color: var(--gold);
}
.record-icon.insurance,
.record-icon.inspection {
  background: var(--rose-soft);
  color: var(--rose);
}
.record-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.record-copy > strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-sub,
.record-next {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.4;
}
.record-next {
  color: var(--sage-dark);
}
.record-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: none;
}
.record-amount {
  margin-right: 7px;
  font-size: 13px;
  white-space: nowrap;
}
.vehicle-type-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.vehicle-type-option {
  min-height: 66px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--surface);
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.vehicle-type-option.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 700;
}
.record-type-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}
.record-type-option {
  min-height: 55px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface);
  color: var(--muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.record-type-option.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 700;
}
@media (max-width: 700px) {
  .vehicle-detail-head {
    align-items: flex-start;
    padding: 17px;
  }
  .vehicle-detail-title {
    align-items: flex-start;
    gap: 10px;
  }
  .vehicle-detail-title h2 {
    font-size: 21px;
  }
  .vehicle-detail-actions {
    gap: 3px;
  }
  .vehicle-detail-actions .btn {
    width: 38px;
    min-width: 38px;
    justify-content: center;
    padding: 0;
    font-size: 0;
  }
  .vehicle-stats {
    padding: 13px 17px;
  }
  .vehicle-stat {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
    padding: 4px 10px;
  }
  .vehicle-stat:first-child {
    padding-left: 0;
  }
  .vehicle-stat small {
    min-height: 28px;
  }
  .vehicle-reminders,
  .vehicle-history {
    padding: 17px;
  }
}
@media (max-width: 460px) {
  .vehicle-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .vehicle-card {
    padding: 12px;
  }
  .vehicle-card-meta {
    flex-wrap: wrap;
    gap: 3px 7px;
  }
  .vehicle-stat-icon {
    width: 30px;
    height: 30px;
  }
  .vehicle-stat strong {
    font-size: 12px;
  }
  .vehicle-stat small {
    font-size: 10px;
  }
  .vehicle-record {
    align-items: flex-start;
    gap: 8px;
  }
  .record-icon {
    width: 32px;
    height: 32px;
    border-radius: 11px;
  }
  .record-actions {
    gap: 0;
  }
  .record-actions .icon-btn {
    width: 30px;
    height: 30px;
  }
  .record-amount {
    display: none;
  }
  .record-type-options {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
