<template>
  <section v-if="projects?.length" class="project-evidence" aria-label="项目作品与岗位依据">
    <h4>相关项目作品</h4>
    <article v-for="p in distinctProjects" :key="p.evidenceId">
      <b>{{ p.name }}</b>
      <span class="status">{{ p.verified ? '公开仓库已核实' : '公开状态待核实' }} · {{ p.confirmed ? '经历已确认' : '贡献待本人确认' }}</span>
      <p v-if="p.scope"><strong>个人职责：</strong>{{ p.scope }}</p>
      <p v-if="p.limitations"><strong>能力边界：</strong>{{ p.limitations }}</p>
      <a v-if="p.verified && safeUrl(p.url)" :href="safeUrl(p.url)" target="_blank" rel="noopener noreferrer">查看 {{ p.name }} 源码 ↗</a>
      <small>{{ p.reason }}</small>
    </article>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { publicRepositoryUrl, type ProjectEvidence } from '../../../../common/portfolio'
const props = defineProps<{ projects?: ProjectEvidence[] }>()
// Collapse identical presentation cards; each underlying evidence ID remains independent.
const distinctProjects = computed(() => (props.projects || []).filter((p, index, all) => all.findIndex(other => (['name', 'url', 'scope', 'limitations', 'confirmed', 'verified', 'reason'] as const).every(key => other[key] === p[key])) === index))
const safeUrl = (url: string) => { try { return publicRepositoryUrl(url) } catch { return '' } }
</script>
<style scoped>
.project-evidence { margin: 16px 0; }
h4 { margin: 0 0 10px; }
article { padding: 14px 16px; margin: 10px 0; border: 1px solid #dce6f4; border-radius: 10px; background: #f8faff; }
.status, small { display: block; color: #617189; font-size: 12px; margin: 6px 0; }
p { margin: 8px 0; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: #245fd1; }
</style>
