<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import {
  keywordFirstSeen,
  messageTypeComposition,
  reportHighlights,
  responseSpeedBuckets,
  romanticKeywordSplit,
  sessionSizeDistribution,
  sessionStats,
  topActiveDays,
  weekdayHourMatrix,
} from '../lib/advancedAnalysis';

const props = defineProps({
  messages: { type: Array, required: true },
  selfName: { type: String, default: '我' },
  partnerName: { type: String, default: 'TA' },
});

const matrixEl = ref(null);
const topDaysEl = ref(null);
const replyEl = ref(null);
const sessionEl = ref(null);
const keywordEl = ref(null);
const typeEl = ref(null);
const charts = new Map();

const highlights = computed(() => reportHighlights(props.messages));
const sessions = computed(() => sessionStats(props.messages, 4));
const firstSeen = computed(() => keywordFirstSeen(props.messages).slice(0, 8));

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value || 0));
}

function formatPercent(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function formatDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}小时`;
  return `${(seconds / 86400).toFixed(1)}天`;
}

function initChart(el, key) {
  if (!el) return null;
  let chart = charts.get(key);
  if (!chart) {
    chart = echarts.init(el);
    charts.set(key, chart);
  }
  return chart;
}

function renderMatrix() {
  const chart = initChart(matrixEl.value, 'matrix');
  if (!chart) return;
  const { weekdays, rows } = weekdayHourMatrix(props.messages);
  const max = Math.max(...rows.map((x) => x.total), 1);
  chart.setOption({
    tooltip: { formatter: (p) => `${weekdays[p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00<br/>${formatNumber(p.value[2])} 条消息` },
    grid: { left: 58, right: 24, top: 20, bottom: 58 },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}:00`), splitArea: { show: true }, axisLabel: { interval: 2 } },
    yAxis: { type: 'category', data: weekdays, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 4,
      inRange: { color: ['#f7fbfd', '#dcecf5', '#9fc4d9', '#d88ba4', '#963c62'] },
      text: ['高频', '低频'],
    },
    series: [{
      type: 'heatmap',
      data: rows.map((row) => [row.hour, row.weekday, row.total]),
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(87,52,66,.18)' } },
    }],
  }, true);
}

function renderTopDays() {
  const chart = initChart(topDaysEl.value, 'topDays');
  if (!chart) return;
  const rows = topActiveDays(props.messages, 10).reverse();
  chart.setOption({
    tooltip: { formatter: (p) => `${p.name}<br/>${formatNumber(p.value)} 条消息` },
    grid: { left: 82, right: 28, top: 20, bottom: 28 },
    xAxis: { type: 'value', name: '消息数', splitLine: { lineStyle: { color: '#f2e7eb' } } },
    yAxis: { type: 'category', data: rows.map((x) => x.date), axisTick: { show: false } },
    series: [{
      type: 'bar',
      data: rows.map((x) => x.value),
      itemStyle: { color: '#cf6a8b', borderRadius: [0, 7, 7, 0] },
      label: { show: true, position: 'right' },
    }],
  }, true);
}

function renderReplyBuckets() {
  const chart = initChart(replyEl.value, 'reply');
  if (!chart) return;
  const data = responseSpeedBuckets(props.messages);
  const sentDenom = Math.max(data.sentTotal, 1);
  const receivedDenom = Math.max(data.receivedTotal, 1);
  const palette = ['#5b8fb0', '#7fb0ca', '#dba0b2', '#ce6f8e', '#9a3d61'];
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => params.map((p) => `${p.marker}${p.seriesName}：${p.value.toFixed(1)}%`).join('<br/>'),
    },
    legend: { bottom: 0 },
    grid: { left: 92, right: 24, top: 24, bottom: 72 },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: [props.selfName, props.partnerName] },
    series: data.labels.map((label, index) => ({
      name: label,
      type: 'bar',
      stack: 'reply',
      emphasis: { focus: 'series' },
      itemStyle: { color: palette[index] },
      data: [
        Number((data.sent[index] / sentDenom * 100).toFixed(1)),
        Number((data.received[index] / receivedDenom * 100).toFixed(1)),
      ],
    })),
  }, true);
}

function renderSessions() {
  const chart = initChart(sessionEl.value, 'sessions');
  if (!chart) return;
  const rows = sessionSizeDistribution(sessions.value.sessions);
  chart.setOption({
    tooltip: { formatter: (p) => `${p.name}<br/>${formatNumber(p.value)} 段会话` },
    grid: { left: 48, right: 24, top: 22, bottom: 42 },
    xAxis: { type: 'category', data: rows.map((x) => x.label) },
    yAxis: { type: 'value', name: '会话数' },
    series: [{
      type: 'bar',
      data: rows.map((x) => x.value),
      itemStyle: { color: '#7da9c4', borderRadius: [7, 7, 0, 0] },
      label: { show: true, position: 'top' },
    }],
  }, true);
}

function renderKeywords() {
  const chart = initChart(keywordEl.value, 'keywords');
  if (!chart) return;
  const rows = romanticKeywordSplit(props.messages).slice(0, 10);
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: [props.selfName, props.partnerName], bottom: 0 },
    grid: { left: 58, right: 22, top: 20, bottom: 62 },
    xAxis: { type: 'category', data: rows.map((x) => x.keyword) },
    yAxis: { type: 'value', name: '出现次数' },
    series: [
      { name: props.selfName, type: 'bar', data: rows.map((x) => x.sent), itemStyle: { color: '#d35f82' } },
      { name: props.partnerName, type: 'bar', data: rows.map((x) => x.received), itemStyle: { color: '#74a6c3' } },
    ],
  }, true);
}

function renderTypes() {
  const chart = initChart(typeEl.value, 'types');
  if (!chart) return;
  const rows = messageTypeComposition(props.messages);
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 条 ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '45%'],
      label: { formatter: '{b}\n{d}%' },
      data: [
        { ...rows[0], itemStyle: { color: '#cf6587' } },
        { ...rows[1], itemStyle: { color: '#7ba8c2' } },
      ],
    }],
  }, true);
}

function renderAll() {
  if (!props.messages.length) return;
  renderMatrix();
  renderTopDays();
  renderReplyBuckets();
  renderSessions();
  renderKeywords();
  renderTypes();
}

function resizeCharts() {
  charts.forEach((chart) => chart.resize());
}

watch(() => props.messages, async () => {
  await nextTick();
  renderAll();
});

onMounted(async () => {
  await nextTick();
  renderAll();
  window.addEventListener('resize', resizeCharts);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts);
  charts.forEach((chart) => chart.dispose());
});

const storySummary = computed(() => {
  const h = highlights.value;
  if (!h) return '';
  const hour = String(h.peakHour).padStart(2, '0');
  const month = h.busiestMonth?.month || '—';
  return `聊天峰值最常出现在 ${h.peakWeekday} ${hour}:00 左右；最活跃月份是 ${month}。平均每个活跃日有 ${formatNumber(h.averagePerActiveDay)} 条消息，其中 ${formatPercent(h.lateNightShare)} 发生在 00:00–05:00。`;
});
</script>

<template>
  <section v-if="messages.length" class="advanced-report">
    <div class="report-intro">
      <div>
        <p class="section-kicker">DEEP REPORT · 多维报告</p>
        <h2>聊天节奏与互动画像</h2>
        <p>{{ storySummary }}</p>
      </div>
      <div class="report-tag">事实型分析 · 不做感情打分</div>
    </div>

    <section v-if="highlights" class="highlight-grid">
      <article class="highlight-card"><span>最活跃月份</span><strong>{{ highlights.busiestMonth?.month || '—' }}</strong><small>{{ formatNumber(highlights.busiestMonth?.total) }} 条消息</small></article>
      <article class="highlight-card"><span>最常聊天星期</span><strong>{{ highlights.peakWeekday }}</strong><small>按消息量统计</small></article>
      <article class="highlight-card"><span>峰值时段</span><strong>{{ String(highlights.peakHour).padStart(2, '0') }}:00</strong><small>一天中的高频小时</small></article>
      <article class="highlight-card"><span>平均活跃日</span><strong>{{ formatNumber(highlights.averagePerActiveDay) }}</strong><small>条 / 活跃日</small></article>
      <article class="highlight-card"><span>深夜消息</span><strong>{{ formatPercent(highlights.lateNightShare) }}</strong><small>00:00–05:00 · {{ formatNumber(highlights.lateNightCount) }} 条</small></article>
      <article class="highlight-card"><span>周末消息</span><strong>{{ formatPercent(highlights.weekendShare) }}</strong><small>{{ formatNumber(highlights.weekendCount) }} 条</small></article>
      <article class="highlight-card"><span>最长未聊天间隔</span><strong>{{ formatDuration(highlights.longestSilenceSeconds) }}</strong><small v-if="highlights.longestSilenceStart">{{ formatDate(highlights.longestSilenceStart) }} → {{ formatDate(highlights.longestSilenceEnd) }}</small></article>
      <article class="highlight-card"><span>最均衡月份</span><strong>{{ highlights.mostBalancedMonth?.month || '—' }}</strong><small v-if="highlights.mostBalancedMonth">{{ formatNumber(highlights.mostBalancedMonth.sent) }} : {{ formatNumber(highlights.mostBalancedMonth.received) }}</small></article>
    </section>

    <section class="panel full-panel">
      <div class="panel-heading">
        <div><p class="section-kicker">WEEKDAY × HOUR</p><h2>一周聊天作息热图</h2></div>
        <p>把星期与 24 小时叠在一起，看你们最容易“撞见彼此”的时间。</p>
      </div>
      <div ref="matrixEl" class="chart advanced-matrix"></div>
    </section>

    <section class="two-column">
      <article class="panel">
        <div class="panel-heading"><div><p class="section-kicker">TOP DAYS</p><h2>最能聊的 10 天</h2></div></div>
        <div ref="topDaysEl" class="chart tall-chart"></div>
      </article>
      <article class="panel">
        <div class="panel-heading"><div><p class="section-kicker">REPLY PROFILE</p><h2>回复速度分布</h2></div><p>比单一中位数更完整：看回复主要落在哪个时间段。</p></div>
        <div ref="replyEl" class="chart tall-chart"></div>
      </article>
    </section>

    <section class="two-column">
      <article class="panel session-panel">
        <div class="panel-heading"><div><p class="section-kicker">CONVERSATION SESSIONS</p><h2>一段聊天通常有多长</h2></div><p>连续消息间隔 ≥ 4 小时视为新会话。</p></div>
        <div class="session-kpis">
          <div><span>会话总数</span><strong>{{ formatNumber(sessions.sessionCount) }}</strong></div>
          <div><span>会话中位消息数</span><strong>{{ formatNumber(sessions.medianMessages) }}</strong></div>
          <div><span>会话中位时长</span><strong>{{ formatDuration(sessions.medianDurationSeconds) }}</strong></div>
        </div>
        <div ref="sessionEl" class="chart compact-chart"></div>
        <div v-if="sessions.topByMessages" class="session-record">
          <span>消息最多的一段</span>
          <strong>{{ sessions.topByMessages.date }} · {{ formatNumber(sessions.topByMessages.total) }} 条</strong>
          <small>{{ formatDuration(sessions.topByMessages.durationSeconds) }} · {{ props.selfName }} {{ sessions.topByMessages.sent }} / {{ props.partnerName }} {{ sessions.topByMessages.received }}</small>
        </div>
      </article>

      <article class="panel">
        <div class="panel-heading"><div><p class="section-kicker">MESSAGE MIX</p><h2>消息形式构成</h2></div><p>目前只区分文字与其他类型，不对图片、语音、表情作错误识别。</p></div>
        <div ref="typeEl" class="chart"></div>
      </article>
    </section>

    <section class="two-column">
      <article class="panel">
        <div class="panel-heading"><div><p class="section-kicker">LOVE WORDS SPLIT</p><h2>情侣关键词是谁说得更多</h2></div></div>
        <div ref="keywordEl" class="chart tall-chart"></div>
      </article>

      <article class="panel first-seen-panel">
        <div class="panel-heading"><div><p class="section-kicker">FIRST APPEARANCE</p><h2>这些词第一次出现是什么时候</h2></div><p>适合做成纪念册里的“关系语言时间线”。</p></div>
        <div v-if="firstSeen.length" class="first-seen-list">
          <div v-for="item in firstSeen" :key="item.keyword" class="first-seen-item">
            <span class="keyword-pill">{{ item.keyword }}</span>
            <div><strong>{{ formatDate(item.date) }}</strong><small>第一次由 {{ item.isSend ? props.selfName : props.partnerName }} 说出</small></div>
          </div>
        </div>
        <p v-else class="empty-note">当前年份没有匹配到预设情侣关键词。</p>
      </article>
    </section>
  </section>
</template>

<style scoped>
.advanced-report { margin-top: 22px; }
.report-intro {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  margin: 34px 4px 16px;
  padding-top: 20px;
  border-top: 1px solid rgba(145,83,107,.12);
}
.report-intro h2 { margin: 0; color: #51333f; font-size: 30px; }
.report-intro p:not(.section-kicker) { max-width: 820px; margin: 10px 0 0; color: #806b74; line-height: 1.8; }
.report-tag {
  flex: 0 0 auto;
  padding: 9px 13px;
  border-radius: 999px;
  background: #eef7f2;
  color: #4f7c68;
  font-size: 12px;
  font-weight: 700;
}
.highlight-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.highlight-card {
  min-height: 126px;
  padding: 18px;
  border-radius: 18px;
  background: linear-gradient(145deg, rgba(255,255,255,.94), rgba(255,246,249,.92));
  border: 1px solid rgba(145,83,107,.10);
  box-shadow: 0 12px 34px rgba(84,44,61,.05);
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.highlight-card:nth-child(even) { background: linear-gradient(145deg, rgba(255,255,255,.94), rgba(244,250,253,.96)); }
.highlight-card span { color: #8e7982; font-size: 12px; }
.highlight-card strong { margin: 6px 0 4px; color: #593744; font-size: 27px; letter-spacing: -.02em; }
.highlight-card small { color: #a08d95; line-height: 1.45; }
.advanced-matrix { height: 430px; }
.session-kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 16px 0 2px;
}
.session-kpis > div {
  padding: 14px;
  border-radius: 14px;
  background: #f9f4f6;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.session-kpis span { color: #8d7881; font-size: 12px; }
.session-kpis strong { color: #5a3645; font-size: 22px; }
.compact-chart { height: 280px; }
.session-record {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 8px;
  padding: 15px 16px;
  border-radius: 14px;
  background: #f1f7fa;
}
.session-record span { color: #6d8797; font-size: 12px; }
.session-record strong { color: #456b82; }
.session-record small { color: #8198a5; }
.first-seen-list { display: grid; gap: 10px; padding: 12px 0 8px; }
.first-seen-item {
  display: grid;
  grid-template-columns: 84px 1fr;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 15px;
  background: linear-gradient(145deg, #fff6f9, #fff);
  border: 1px solid #f2e2e8;
}
.keyword-pill {
  display: inline-grid;
  place-items: center;
  min-height: 38px;
  padding: 7px 10px;
  border-radius: 999px;
  background: #f7dce6;
  color: #9b3d60;
  font-weight: 700;
}
.first-seen-item div { display: flex; flex-direction: column; gap: 3px; }
.first-seen-item strong { color: #5c3a47; }
.first-seen-item small { color: #9b8790; }
.empty-note { color: #9b8790; padding: 20px 4px; }

@media (max-width: 920px) {
  .highlight-grid { grid-template-columns: repeat(2, 1fr); }
  .report-intro { align-items: flex-start; flex-direction: column; }
  .session-kpis { grid-template-columns: 1fr; }
}

@media (max-width: 620px) {
  .highlight-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .highlight-card { min-height: 112px; padding: 14px; }
  .highlight-card strong { font-size: 22px; }
  .advanced-matrix { height: 380px; }
  .first-seen-item { grid-template-columns: 72px 1fr; }
}

@media print {
  .highlight-card, .first-seen-item, .session-record { break-inside: avoid; page-break-inside: avoid; }
}
</style>
