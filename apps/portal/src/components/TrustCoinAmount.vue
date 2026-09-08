<template>
  <span class="trustcoin" :aria-label="`${formatted} TrustCOIN`" title="TrustCOIN">
    <svg class="trustcoin-symbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" />
      <path d="M7.5 7.5h9M12 7.5v10M8.5 12h7" />
    </svg>
    <span aria-hidden="true">{{ formatted }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ amount: string }>();
// Ledger amounts are integer strings. BigInt preserves precision without changing denomination.
const formatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatted = computed(() => formatter.format(BigInt(props.amount)));
</script>

<style scoped>
.trustcoin {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.trustcoin-symbol {
  width: 0.85em;
  height: 0.85em;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
