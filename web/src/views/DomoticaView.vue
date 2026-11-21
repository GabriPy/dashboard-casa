<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api.js';
import { useAuthStore } from '@/stores/auth.js';
import { useUiStore } from '@/stores/ui.js';
import PageHeader from '@/components/PageHeader.vue';
import BaseModal from '@/components/BaseModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import HomeAssistantDeviceCard from '@/components/HomeAssistantDeviceCard.vue';
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
const editingDevice = ref(null);
const busyGroup = ref('');
const expandedGroups = ref(new Set());

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
  groupName: '',
  icon: 'power',
});

const groupedDevices = computed(() => {
  const rooms = new Map();
  for (const device of devices.value) {
    const roomName = device.room || 'Casa';
    if (!rooms.has(roomName)) rooms.set(roomName, { name: roomName, devices: [], groups: new Map() });
    const room = rooms.get(roomName);
    if (!device.groupName) {
      room.devices.push(device);
      continue;
    }
    if (!room.groups.has(device.groupName)) room.groups.set(device.groupName, []);
    room.groups.get(device.groupName).push(device);
  }
  return [...rooms.values()].map((room) => ({
    name: room.name,
    devices: room.devices,
    groups: [...room.groups.entries()].map(([name, items]) => ({
      name,
      items,
      key: JSON.stringify([room.name, name]),
      onCount: items.filter((device) => device.on).length,
      availableCount: items.filter((device) => device.available).length,
    })),
  }));
});

const onCount = computed(() => devices.value.filter((device) => device.on).length);

function resetForm() {
  editingDevice.value = null;
  Object.assign(form, { name: '', entityId: '', room: '', groupName: '', icon: 'power' });
  formError.value = '';
}

function openNew() {
  resetForm();
  modalOpen.value = true;
}

function openEdit(device) {
  editingDevice.value = device;
  Object.assign(form, {
    name: device.name,
    entityId: device.entityId,
    room: device.room,
    groupName: device.groupName,
    icon: device.icon,
  });
  formError.value = '';
  modalOpen.value = true;
}

function isGroupExpanded(key) {
  return expandedGroups.value.has(key);
}

function toggleGroupExpanded(key) {
  const updated = new Set(expandedGroups.value);
  if (updated.has(key)) updated.delete(key);
  else updated.add(key);
  expandedGroups.value = updated;
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
    const body = {
      name: form.name.trim(),
      room: form.room.trim() || null,
      groupName: form.groupName.trim() || null,
      icon: form.icon,
    };
    if (editingDevice.value) {
      await api(`/api/home-assistant/devices/${editingDevice.value.id}`, { method: 'PATCH', body });
    } else {
      await api('/api/home-assistant/devices', {
        method: 'POST',
        body: { ...body, entityId: form.entityId.trim() },
      });
    }
    modalOpen.value = false;
    ui.success(editingDevice.value ? 'Dispositivo aggiornato.' : 'Dispositivo aggiunto.');
    editingDevice.value = null;
    await load();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function toggleGroup(group, room) {
  if (!group.availableCount || busyGroup.value) return;
  busyGroup.value = group.key;
  try {
    const result = await api('/api/home-assistant/groups/action', {
      method: 'POST',
      body: {
        room,
        groupName: group.name,
        turnOn: group.onCount === 0,
      },
    });
    const updatedById = new Map(result.devices.map((device) => [device.id, device]));
    devices.value = devices.value.map((device) => updatedById.get(device.id) || device);
  } catch (err) {
    ui.error(err.message);
  } finally {
    busyGroup.value = '';
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
    if (editingDevice.value?.id === device.id) modalOpen.value = false;
    ui.success('Dispositivo rimosso.');
  } catch (err) {
    ui.error(err.message);
  }
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
      <section v-for="room in groupedDevices" :key="room.name" class="domotica-group">
        <header class="domotica-group-head">
          <p class="eyebrow">Stanza</p>
          <h2>{{ room.name }}</h2>
        </header>
        <div v-if="room.groups.length" class="domotica-named-groups">
          <article v-for="group in room.groups" :key="group.key" class="device-group">
            <header class="device-group-head">
              <button
                type="button"
                class="device-group-expand"
                :aria-expanded="isGroupExpanded(group.key)"
                :aria-label="`${isGroupExpanded(group.key) ? 'Comprimi' : 'Espandi'} gruppo ${group.name}`"
                @click="toggleGroupExpanded(group.key)"
              >
                <Icon :name="isGroupExpanded(group.key) ? 'chevron-down' : 'chevron-right'" :size="18" />
                <span class="device-group-icon"><Icon name="group" :size="19" /></span>
                <span class="device-group-title">
                  <strong>{{ group.name }}</strong>
                  <small>
                    {{ group.availableCount ? `${group.onCount} accesi · ${group.items.length} dispositivi` : 'Nessun dispositivo disponibile' }}
                  </small>
                </span>
              </button>
              <button
                type="button"
                class="device-group-action"
                :class="{ on: group.onCount > 0 }"
                :disabled="!group.availableCount || busyGroup === group.key"
                :aria-label="`${group.onCount ? 'Spegni' : 'Accendi'} gruppo ${group.name}`"
                @click="toggleGroup(group, room.name)"
              >
                <span v-if="busyGroup === group.key" class="spinner" />
                <template v-else>
                  <Icon name="power" :size="17" />
                  <span>{{ group.onCount ? 'Spegni' : 'Accendi' }}</span>
                </template>
              </button>
            </header>
            <div v-if="isGroupExpanded(group.key)" class="domotica-grid device-group-devices">
              <HomeAssistantDeviceCard
                v-for="device in group.items"
                :key="device.id"
                :device="device"
                :editable="auth.isAdmin"
                :busy="busyId === device.id"
                @toggle="toggleDevice(device)"
                @edit="openEdit(device)"
                @remove="removeDevice(device)"
              />
            </div>
          </article>
        </div>
        <div v-if="room.devices.length" class="domotica-grid">
          <HomeAssistantDeviceCard
            v-for="device in room.devices"
            :key="device.id"
            :device="device"
            :editable="auth.isAdmin"
            :busy="busyId === device.id"
            @toggle="toggleDevice(device)"
            @edit="openEdit(device)"
            @remove="removeDevice(device)"
          />
        </div>
      </section>
    </div>

    <BaseModal
      v-model="modalOpen"
      :title="editingDevice ? 'Modifica dispositivo' : 'Aggiungi dispositivo'"
      :subtitle="editingDevice ? 'Scegli stanza e gruppo per organizzare i controlli.' : 'Scegli un’entità di Home Assistant da controllare.'"
      size="lg"
    >
      <div class="stack">
        <div v-if="availableEntities.length && !editingDevice" class="ha-entity-picker">
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
          <div class="field">
            <label for="ha-group">Gruppo (facoltativo)</label>
            <input id="ha-group" v-model="form.groupName" class="input" maxlength="60" placeholder="es. Tavolo" />
            <span class="hint">I dispositivi con lo stesso gruppo e stanza si comandano insieme.</span>
          </div>
        </div>

        <div v-if="!editingDevice" class="field">
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
          <span v-if="saving" class="spinner" /> {{ editingDevice ? 'Salva modifiche' : 'Aggiungi' }}
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
.domotica-named-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}
.device-group {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.device-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
}
.device-group-expand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.device-group-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 12px;
  background: var(--gold-soft);
  color: var(--gold);
}
.device-group-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.device-group-title strong {
  font-size: 14px;
}
.device-group-title small {
  color: var(--muted);
  font-size: 11.5px;
}
.device-group-action {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex: none;
}
.device-group-action.on {
  border-color: rgba(192, 85, 58, 0.28);
  background: var(--primary-soft);
  color: var(--primary);
}
.device-group-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.device-group-devices {
  padding: 0 12px 12px;
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
  .device-group-head {
    padding: 8px;
  }
  .device-group-devices {
    padding: 0 8px 8px;
  }
  .ha-icon-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 420px) {
  .domotica-grid {
    gap: 8px;
  }
  .device-group-action {
    width: 38px;
    padding: 0;
  }
  .device-group-action span:not(.spinner) {
    display: none;
  }
}
</style>
