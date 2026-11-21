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
      <span class="device-icon"><Icon :name="icons[device.icon] || 'power'" :size="21" /></span>
      <div v-if="editable" class="device-tools">
        <button type="button" class="icon-btn device-tool" :aria-label="`Modifica ${device.name}`" title="Modifica" @click="$emit('edit')">
          <Icon name="edit" :size="15" />
        </button>
        <button type="button" class="icon-btn device-tool" :aria-label="`Rimuovi ${device.name}`" title="Rimuovi" @click="$emit('remove')">
          <Icon name="trash" :size="15" />
        </button>
      </div>
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
      :disabled="!device.available || busy"
      :aria-label="`${device.on ? 'Spegni' : 'Accendi'} ${device.name}`"
      @click="$emit('toggle')"
    >
      <span v-if="busy" class="spinner" />
      <Icon v-else name="power" :size="18" />
    </button>
  </article>
</template>

<style scoped>
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
@media (max-width: 760px) {
  .device-card {
    min-height: 156px;
  }
}
@media (max-width: 420px) {
  .device-card {
    padding: 13px;
  }
  .device-tool {
    opacity: 1;
  }
}
</style>
