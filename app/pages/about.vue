<template>
  <div @click="count++">test {{ count }}</div>
</template>

<script lang="ts" setup>
const count = ref<number>(1);
</script>
