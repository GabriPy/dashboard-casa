<script setup>
import Icon from '@/components/Icon.vue';

defineProps({
  device: { type: Object, required: true },
  editable: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});

defineEmits(['toggle', 'edit', 'remove']);

const icons = {
  power: 'power',
  light: 'bulb',
  plug: 'plug',
  fan: 'fan',
  thermostat: 'thermostat',
  lock: 'lock',
  tv: 'tv',
};
</script>

<template>
  <article class="device-card" :class="{ on: device.on, unavailable: !device.available }">
    <div class="device-card-top">
      <span class="device-icon"><Icon :name="icons[device.icon] || 'power'" :size="20" /></span>
      <div v-if="editable" class="device-tools">
        <button type="button" class="icon-btn device-tool" :aria-label="`Modifica ${device.name}`" title="Modifica" @click="$emit('edit')">
          <Icon name="edit" :size="15" />
        </button>
        <button type="button" class="icon-btn device-tool" :aria-label="`Rimuovi ${device.name}`" title="Rimuovi" @click="$emit('remove')">
          <Icon name="trash" :size="15" />
        </button>
      </div>
    </div>
    <button
      type="button"
      class="device-toggle"
      role="switch"
      :aria-checked="device.on"
      :disabled="!device.available || busy"
      :aria-label="`${device.on ? 'Spegni' : 'Accendi'} ${device.name}`"
      @click="$emit('toggle')"
    >
      <span class="device-copy">
        <strong>{{ device.name }}</strong>
        <span v-if="!device.available" class="device-status">Non disponibile</span>
        <span v-else class="device-status" :class="{ active: device.on }">
          {{ device.on ? 'Acceso' : 'Spento' }}
        </span>
      </span>
      <span class="device-switch" :class="{ on: device.on }" aria-hidden="true">
        <span v-if="busy" class="spinner" />
        <Icon v-else name="power" :size="17" />
      </span>
    </button>
  </article>
</template>

<style scoped>
.device-card {
  min-width: 0;
  min-height: 142px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 19px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.device-card.on {
  border-color: rgba(192, 85, 58, 0.3);
  background: linear-gradient(145deg, var(--surface), var(--primary-soft));
}
.device-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}
.device-card:focus-within {
  border-color: var(--primary);
}
.device-card.unavailable {
  opacity: 0.72;
}
.device-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
}
.device-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: var(--surface-2);
  color: var(--muted);
}
.device-card.on .device-icon {
  background: var(--primary);
  color: #fff;
}
.device-toggle {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.device-toggle:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 4px;
}
.device-toggle:disabled {
  cursor: not-allowed;
}
.device-tools {
  display: flex;
  gap: 2px;
}
.device-tool {
  color: var(--muted);
  opacity: 0;
}
.device-card:hover .device-tool,
.device-tool:focus-visible {
  opacity: 1;
}
.device-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.device-copy strong {
  font-size: 14px;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: normal;
  overflow: hidden;
}
.device-status {
  min-height: 15px;
  font-size: 12px;
  color: var(--muted);
}
.device-status.active {
  color: var(--primary);
  font-weight: 700;
}
.device-switch {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--muted);
  flex: none;
}
.device-switch.on {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
@media (max-width: 420px) {
  .device-card {
    min-height: 136px;
    padding: 12px;
  }
  .device-tool {
    opacity: 1;
  }
}
</style>
