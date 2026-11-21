<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api.js';
import { useAuthStore } from '@/stores/auth.js';
import { useUiStore } from '@/stores/ui.js';
import PageHeader from '@/components/PageHeader.vue';
import BaseModal from '@/components/BaseModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';

const auth = useAuthStore();
const ui = useUiStore();
const devices = ref([]);
const availableEntities = ref([]);
const configured = ref(false);
const loading = ref(true);
const busyId = ref(null);
const modalOpen = ref(false);
const saving = ref(false);
const formError = ref('');

const iconOptions = [
  { id: 'power', label: 'Generico', icon: 'power' },
  { id: 'light', label: 'Lampada', icon: 'bulb' },
  { id: 'plug', label: 'Presa', icon: 'plug' },
  { id: 'fan', label: 'Ventilatore', icon: 'fan' },
  { id: 'thermostat', label: 'Termostato', icon: 'thermostat' },
  { id: 'lock', label: 'Serratura', icon: 'lock' },
  { id: 'tv', label: 'Media', icon: 'tv' },
];

const form = reactive({
  name: '',
  entityId: '',
  room: '',
  icon: 'power',
});

const groupedDevices = computed(() => {
  const groups = new Map();
  for (const device of devices.value) {
    const room = device.room || 'Casa';
    if (!groups.has(room)) groups.set(room, []);
    groups.get(room).push(device);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
});

const onCount = computed(() => devices.value.filter((device) => device.on).length);

function resetForm() {
  Object.assign(form, { name: '', entityId: '', room: '', icon: 'power' });
  formError.value = '';
}

function openNew() {
  resetForm();
  modalOpen.value = true;
}

function selectEntity(entity) {
  form.entityId = entity.entityId;
  if (!form.name.trim()) form.name = entity.name;
  const existingIcon = form.entityId.startsWith('light.') ? 'light'
    : form.entityId.startsWith('fan.') ? 'fan'
      : form.entityId.startsWith('media_player.') ? 'tv'
        : 'power';
  form.icon = existingIcon;
}

async function load() {
  loading.value = true;
  try {
    const data = await api('/api/home-assistant/devices');
    configured.value = data.configured;
    devices.value = data.devices || [];
    availableEntities.value = data.availableEntities || [];
  } catch (err) {
    ui.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function toggleDevice(device) {
  busyId.value = device.id;
  try {
    const data = await api(`/api/home-assistant/devices/${device.id}/action`, {
      method: 'POST',
      body: { turnOn: !device.on },
    });
    const index = devices.value.findIndex((item) => item.id === device.id);
    if (index >= 0) devices.value[index] = data.device;
  } catch (err) {
    ui.error(err.message);
  } finally {
    busyId.value = null;
  }
}

async function saveDevice() {
  if (!form.name.trim() || !form.entityId.trim()) {
    formError.value = 'Nome ed entity ID sono obbligatori.';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    await api('/api/home-assistant/devices', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        entityId: form.entityId.trim(),
        room: form.room.trim() || null,
        icon: form.icon,
      },
    });
    modalOpen.value = false;
    ui.success('Dispositivo aggiunto.');
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeDevice(device) {
  const confirmed = await ui.confirm({
    title: `Rimuovere ${device.name}?`,
    message: 'Il dispositivo verrà tolto da Ghibiri Home, senza modificarlo in Home Assistant.',
    confirmLabel: 'Rimuovi',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/home-assistant/devices/${device.id}`, { method: 'DELETE' });
    devices.value = devices.value.filter((item) => item.id !== device.id);
    ui.success('Dispositivo rimosso.');
  } catch (err) {
    ui.error(err.message);
  }
}

function iconFor(device) {
  return iconOptions.find((item) => item.id === device.icon)?.icon || 'power';
}

onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="Casa connessa"
      title="Domotica"
      :subtitle="devices.length ? `${devices.length} dispositivi · ${onCount} accesi` : 'Controlla luci e dispositivi collegati.'"
    >
      <template #actions>
        <button v-if="auth.isAdmin" type="button" class="btn btn-primary" @click="openNew">
          <Icon name="plus" :size="17" /> Aggiungi dispositivo
        </button>
      </template>
    </PageHeader>

    <div v-if="loading" class="domotica-grid">
      <div v-for="i in 6" :key="i" class="device-card skeleton">
        <div class="shimmer" style="width: 46px; height: 46px; border-radius: 14px" />
        <div class="shimmer" style="width: 55%; height: 16px" />
        <div class="shimmer" style="width: 30%; height: 12px" />
      </div>
    </div>

    <EmptyState
      v-else-if="!configured"
      icon="home-automation"
      title="Home Assistant non configurato"
      text="Aggiungi HOME_ASSISTANT_URL e HOME_ASSISTANT_TOKEN alle variabili del server, poi riavvia Ghibiri Home."
    >
      <RouterLink v-if="auth.isAdmin" to="/impostazioni" class="btn btn-primary">Vai alle Impostazioni</RouterLink>
    </EmptyState>

    <EmptyState
      v-else-if="!devices.length"
      icon="home-automation"
      title="Nessun dispositivo"
      :text="auth.isAdmin ? 'Aggiungi una luce, una presa o un altro dispositivo collegato a Home Assistant.' : 'L’amministratore può aggiungere i dispositivi dalla sezione Domotica.'"
    >
      <button v-if="auth.isAdmin" type="button" class="btn btn-primary" @click="openNew">Aggiungi dispositivo</button>
    </EmptyState>

    <div v-else class="domotica-groups">
      <section v-for="group in groupedDevices" :key="group.name" class="domotica-group">
        <header class="domotica-group-head">
          <p class="eyebrow">Stanza</p>
          <h2>{{ group.name }}</h2>
        </header>
        <div class="domotica-grid">
          <article
            v-for="device in group.items"
            :key="device.id"
            class="device-card"
            :class="{ on: device.on, unavailable: !device.available }"
          >
            <div class="device-card-top">
              <span class="device-icon"><Icon :name="iconFor(device)" :size="21" /></span>
              <button
                v-if="auth.isAdmin"
                type="button"
                class="icon-btn device-remove"
                :aria-label="`Rimuovi ${device.name}`"
                title="Rimuovi"
                @click="removeDevice(device)"
              >
                <Icon name="trash" :size="15" />
              </button>
            </div>
            <div class="device-copy">
              <strong>{{ device.name }}</strong>
              <span v-if="!device.available" class="device-status muted">Non disponibile</span>
              <span v-else class="device-status" :class="{ active: device.on }">
                {{ device.on ? 'Acceso' : 'Spento' }}
              </span>
            </div>
            <button
              type="button"
              class="device-switch"
              :class="{ on: device.on }"
              role="switch"
              :aria-checked="device.on"
              :disabled="!device.available || busyId === device.id"
              :aria-label="`${device.on ? 'Spegni' : 'Accendi'} ${device.name}`"
              @click="toggleDevice(device)"
            >
              <span v-if="busyId === device.id" class="spinner" />
              <Icon v-else :name="device.on ? 'power' : 'power'" :size="18" />
            </button>
          </article>
        </div>
      </section>
    </div>

    <BaseModal v-model="modalOpen" title="Aggiungi dispositivo" subtitle="Scegli un’entità di Home Assistant da controllare." size="lg">
      <div class="stack">
        <div v-if="availableEntities.length" class="ha-entity-picker">
          <label>Entità disponibili</label>
          <div class="ha-entity-list">
            <button
              v-for="entity in availableEntities"
              :key="entity.entityId"
              type="button"
              class="ha-entity"
              :class="{ active: form.entityId === entity.entityId }"
              @click="selectEntity(entity)"
            >
              <span>
                <strong>{{ entity.name }}</strong>
                <small>{{ entity.entityId }} · {{ entity.state }}</small>
              </span>
              <Icon :name="form.entityId === entity.entityId ? 'check' : 'plus'" :size="16" />
            </button>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="ha-name">Nome</label>
            <input id="ha-name" v-model="form.name" class="input" maxlength="80" placeholder="es. Lampada soggiorno" />
          </div>
          <div class="field">
            <label for="ha-room">Stanza</label>
            <input id="ha-room" v-model="form.room" class="input" maxlength="60" placeholder="es. Soggiorno" />
          </div>
        </div>

        <div class="field">
          <label for="ha-entity">Entity ID</label>
          <input id="ha-entity" v-model="form.entityId" class="input" maxlength="180" placeholder="light.lampada_soggiorno" />
          <span class="hint">Puoi copiarlo da Home Assistant o selezionarlo dalla lista sopra.</span>
        </div>

        <div class="field">
          <label>Icona</label>
          <div class="ha-icon-row">
            <button
              v-for="option in iconOptions"
              :key="option.id"
              type="button"
              class="ha-icon-choice"
              :class="{ active: form.icon === option.id }"
              :aria-label="option.label"
              @click="form.icon = option.id"
            >
              <Icon :name="option.icon" :size="18" />
              <span>{{ option.label }}</span>
            </button>
          </div>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
      </div>
      <template #footer>
        <button type="button" class="btn btn-ghost" @click="modalOpen = false">Annulla</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="saveDevice">
          <span v-if="saving" class="spinner" /> Aggiungi
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.domotica-groups {
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.domotica-group-head {
  margin-bottom: 10px;
}
.domotica-group-head h2 {
  margin: 2px 0 0;
  font-size: 20px;
}
.domotica-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.device-card {
  position: relative;
  min-height: 178px;
  display: flex;
  flex-direction: column;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.device-card.on {
  border-color: rgba(192, 85, 58, 0.38);
  background: linear-gradient(145deg, var(--surface), var(--primary-soft));
}
.device-card.unavailable {
  opacity: 0.72;
}
.device-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.device-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--muted);
}
.device-card.on .device-icon {
  background: var(--primary);
  color: #fff;
}
.device-remove {
  color: var(--muted);
  opacity: 0;
}
.device-card:hover .device-remove,
.device-remove:focus-visible {
  opacity: 1;
}
.device-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 18px;
  min-width: 0;
  padding-right: 52px;
}
.device-copy strong {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-status {
  min-height: 16px;
  font-size: 12px;
  color: var(--muted);
}
.device-status.active {
  color: var(--primary);
  font-weight: 700;
}
.device-switch {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--muted);
  cursor: pointer;
}
.device-switch.on {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.device-switch:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.device-card.skeleton {
  justify-content: space-between;
}
.ha-entity-picker {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.ha-entity-picker > label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-soft);
}
.ha-entity-list {
  max-height: 210px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.ha-entity {
  width: 100%;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ha-entity:last-child {
  border-bottom: 0;
}
.ha-entity:hover,
.ha-entity.active {
  background: var(--surface-2);
}
.ha-entity span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ha-entity strong {
  font-size: 13px;
}
.ha-entity small {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ha-icon-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.ha-icon-choice {
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.ha-icon-choice.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}
@media (max-width: 760px) {
  .domotica-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .device-card {
    min-height: 156px;
  }
  .ha-icon-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 420px) {
  .domotica-grid {
    gap: 8px;
  }
  .device-card {
    padding: 13px;
  }
  .device-remove {
    opacity: 1;
  }
}
</style>
