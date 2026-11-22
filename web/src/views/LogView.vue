<script setup>
import { onMounted, ref } from 'vue';
import { api } from '@/api.js';
import { useUiStore } from '@/stores/ui.js';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';

const ui = useUiStore();
const logs = ref([]);
const nextCursor = ref(null);
const loading = ref(true);
const loadingMore = ref(false);

const actionDescriptions = {
  login: 'ha effettuato l’accesso',
  login_failed: 'ha tentato un accesso non riuscito',
  logout: 'ha effettuato la disconnessione',
  update_profile: 'ha aggiornato il proprio profilo',
  change_pin: 'ha cambiato il proprio PIN',
  create_user: 'ha aggiunto un profilo familiare',
  update_user: 'ha modificato un profilo familiare',
  delete_user: 'ha rimosso un profilo familiare',
  create_event: 'ha creato un evento',
  update_event: 'ha modificato un evento',
  delete_event: 'ha eliminato un evento',
  create_deadline: 'ha aggiunto una scadenza',
  update_deadline: 'ha modificato una scadenza',
  complete_deadline: 'ha completato una scadenza',
  complete_recurring_deadline: 'ha completato una scadenza ricorrente',
  delete_deadline: 'ha eliminato una scadenza',
  create_plant: 'ha aggiunto una pianta',
  update_plant: 'ha modificato una pianta',
  delete_plant: 'ha eliminato una pianta',
  plant_rain_recorded: 'ha registrato la pioggia',
  create_plant_task: 'ha aggiunto una cura programmata',
  update_plant_task: 'ha modificato una cura programmata',
  delete_plant_task: 'ha rimosso una cura programmata',
  plant_task_done: 'ha registrato una cura della pianta',
  create_shopping_list: 'ha creato una lista della spesa',
  update_shopping_list: 'ha modificato una lista della spesa',
  delete_shopping_list: 'ha eliminato una lista della spesa',
  add_shopping_item: 'ha aggiunto un prodotto alla spesa',
  update_shopping_item: 'ha aggiornato un prodotto della spesa',
  delete_shopping_item: 'ha rimosso un prodotto dalla spesa',
  clear_shopping_done: 'ha svuotato i prodotti completati',
  create_recipe: 'ha aggiunto una ricetta',
  update_recipe: 'ha modificato una ricetta',
  delete_recipe: 'ha eliminato una ricetta',
  toggle_recipe_favorite: 'ha aggiornato una ricetta preferita',
  recipe_to_shopping: 'ha aggiunto ingredienti alla spesa',
  ai_generate_recipe: 'ha generato una ricetta con l’AI',
  upload_attachment: 'ha caricato un allegato',
  delete_attachment: 'ha eliminato un allegato',
  export_backup: 'ha esportato un backup',
  update_settings: 'ha modificato le impostazioni della casa',
  update_dashboard_preferences: 'ha personalizzato la dashboard',
  update_push_preferences: 'ha modificato le preferenze delle notifiche',
  push_subscription_added: 'ha attivato le notifiche su un dispositivo',
  push_subscription_removed: 'ha disattivato le notifiche su un dispositivo',
  push_test_sent: 'ha inviato una notifica di prova',
  add_domotica_device: 'ha aggiunto un dispositivo domotico',
  update_domotica_device: 'ha modificato un dispositivo domotico',
  remove_domotica_device: 'ha rimosso un dispositivo domotico',
  control_domotica_device: 'ha controllato un dispositivo domotico',
  control_domotica_group: 'ha controllato un gruppo domotico',
  test_ai: 'ha provato la connessione AI',
  resync_reminders: 'ha sincronizzato i promemoria',
  create_vehicle: 'ha aggiunto un veicolo',
  update_vehicle: 'ha modificato un veicolo',
  delete_vehicle: 'ha rimosso un veicolo',
  create_vehicle_record: 'ha registrato un’attività per un veicolo',
  update_vehicle_record: 'ha modificato un’attività di un veicolo',
  delete_vehicle_record: 'ha eliminato un’attività di un veicolo',
};

const detailLabels = {
  title: 'Titolo',
  name: 'Nome',
  type: 'Tipo',
  room: 'Stanza',
  groupName: 'Gruppo',
  entityId: 'Entità',
  role: 'Ruolo',
  fields: 'Campi',
  changed: 'Impostazioni',
  next: 'Prossima data',
  removed: 'Rimossi',
  added: 'Aggiunti',
  skipped: 'Già presenti',
  source: 'Origine',
  model: 'Modello',
  filename: 'File',
};

const entityLabels = {
  event: 'Evento',
  deadline: 'Scadenza',
  plant: 'Pianta',
  plant_task: 'Cura',
  recipe: 'Ricetta',
  shopping_list: 'Lista della spesa',
  shopping_item: 'Prodotto della spesa',
  domotica_device: 'Dispositivo domotico',
  user: 'Profilo',
  vehicle: 'Veicolo',
};

function actionDescription(entry) {
  if (entry.action === 'control_domotica_device') {
    return `ha ${entry.detail?.turnOn ? 'acceso' : 'spento'} un dispositivo domotico`;
  }
  if (entry.action === 'control_domotica_group') {
    return `ha ${entry.detail?.turnOn ? 'acceso' : 'spento'} un gruppo domotico`;
  }
  return actionDescriptions[entry.action] || `ha eseguito: ${entry.action.replaceAll('_', ' ')}`;
}

function detailSummary(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (typeof detail !== 'object') return String(detail);

  return Object.entries(detail)
    .filter(([, value]) => value !== null && ['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value))
    .map(([key, value]) => {
      if (key === 'turnOn') return `Comando: ${value ? 'Acceso' : 'Spento'}`;
      return `${detailLabels[key] || key}: ${Array.isArray(value) ? value.join(', ') : value}`;
    })
    .join(' · ');
}

function entitySummary(entry) {
  const label = entityLabels[entry.entityType];
  if (!label) return '';
  return entry.entityId ? `${label} #${entry.entityId}` : label;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const data = await api(`/api/logs?beforeId=${nextCursor.value}`);
    logs.value.push(...data.logs);
    nextCursor.value = data.nextCursor;
  } catch (err) {
    ui.error(err.message);
  } finally {
    loadingMore.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const data = await api('/api/logs');
    logs.value = data.logs;
    nextCursor.value = data.nextCursor;
  } catch (err) {
    ui.error(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="Amministrazione"
      title="Log"
      subtitle="Registro delle attività svolte nella casa."
    />

    <div v-if="loading" class="log-list" aria-label="Caricamento attività">
      <div v-for="i in 5" :key="i" class="log-entry log-skeleton">
        <span class="shimmer log-skeleton-icon" />
        <span class="log-skeleton-copy">
          <span class="shimmer" />
          <span class="shimmer" />
        </span>
      </div>
    </div>

    <EmptyState
      v-else-if="!logs.length"
      icon="list"
      title="Nessuna attività registrata"
      text="Le attività appariranno qui quando qualcuno farà un’azione nella casa."
    />

    <template v-else>
      <section class="log-list" aria-label="Registro attività">
        <article v-for="entry in logs" :key="entry.id" class="log-entry">
          <span class="log-icon"><Icon name="list" :size="17" /></span>
          <div class="log-content">
            <div class="log-heading">
              <p><strong>{{ entry.actorName }}</strong> {{ actionDescription(entry) }}</p>
              <time :datetime="entry.createdAt">{{ formatDate(entry.createdAt) }}</time>
            </div>
            <p v-if="detailSummary(entry.detail)" class="log-detail">{{ detailSummary(entry.detail) }}</p>
            <p v-else-if="entitySummary(entry)" class="log-detail">{{ entitySummary(entry) }}</p>
          </div>
        </article>
      </section>

      <div v-if="nextCursor" class="log-more">
        <button type="button" class="btn btn-ghost" :disabled="loadingMore" @click="loadMore">
          <span v-if="loadingMore" class="spinner" />
          <Icon v-else name="chevron-down" :size="16" />
          Carica attività precedenti
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.log-list {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}
.log-entry:last-child {
  border-bottom: 0;
}
.log-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 12px;
  background: var(--sage-soft);
  color: var(--sage-dark);
}
.log-content {
  min-width: 0;
  flex: 1;
}
.log-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.log-heading p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13.5px;
  line-height: 1.5;
}
.log-heading strong {
  color: var(--ink);
}
.log-heading time {
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
}
.log-detail {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.log-more {
  display: flex;
  justify-content: center;
  padding-top: 16px;
}
.log-skeleton {
  align-items: center;
}
.log-skeleton-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
}
.log-skeleton-copy {
  display: grid;
  gap: 7px;
  flex: 1;
}
.log-skeleton-copy .shimmer {
  width: 60%;
  height: 13px;
}
.log-skeleton-copy .shimmer + .shimmer {
  width: 35%;
  height: 10px;
}
@media (max-width: 640px) {
  .log-entry {
    gap: 10px;
    padding: 14px;
  }
  .log-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
}
</style>
