<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import * as echarts from 'echarts';
import 'echarts-wordcloud';
import AdvancedReport from './components/AdvancedReport.vue';
import TimeMicroscope from './components/TimeMicroscope.vue';
import { parseWeChatHtml, readHtmlFile } from './lib/parser';
import {
  buildOverview,
  conversationInitiative,
  dailyCounts,
  distinctiveWords,
  hourlyCounts,
  monthlyCounts,
  responseTimes,
  romanticKeywordSeries,
  wordFrequency,
} from './lib/analysis';

const fileInput = ref(null);
const loading = ref(false);
const error = ref('');
const fileName = ref('');
const messages = ref([]);
const meta = ref({});
const selectedYear = ref(null);
const initiativeGap = ref(4);

const heatmapEl = ref(null);
const microscopeRef = ref(null);
const monthlyEl = ref(null);
const hourlyEl = ref(null);
const initiativeEl = ref(null);
const wordsEl = ref(null);
const distinctiveEl = ref(null);
const romanticEl = ref(null);
const charts = new Map();

const years = computed(() => {
  const values = [...new Set(messages.value.map((m) => m.date.getFullYear()))].sort((a, b) => a - b);
  return values;
});

const filteredMessages = computed(() => {
  if (!selectedYear.value) return messages.value;
  return messages.value.filter((m) => m.date.getFullYear() === Number(selectedYear.value));
});

const overview = computed(() => (filteredMessages.value.length ? buildOverview(filteredMessages.value) : null));
const initiative = computed(() => conversationInitiative(filteredMessages.value, initiativeGap.value));
const replies = computed(() => responseTimes(filteredMessages.value));

const selfName = computed(() => {
  const found = messages.value.find((m) => m.isSend && m.displayName);
  return found?.displayName || '我';
});

const partnerName = computed(() => {
  const found = messages.value.find((m) => !m.isSend && m.displayName);
  return found?.displayName || '对方';
});

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function formatDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 3600).toFixed(1)} 小时`;
}

function triggerUpload() {
  fileInput.value?.click();
}

async function loadFile(file) {
  if (!file) return;
  loading.value = true;
  error.value = '';
  try {
    const html = await readHtmlFile(file);
    const parsed = parseWeChatHtml(html);
    messages.value = parsed.messages;
    meta.value = parsed.meta;
    fileName.value = file.name;
    selectedYear.value = years.value.at(-1) || null;
    await nextTick();
    renderAll();
  } catch (err) {
    error.value = err?.message || '解析失败，请确认文件格式。';
  } finally {
    loading.value = false;
  }
}

function onFileChange(event) {
  loadFile(event.target.files?.[0]);
}

function onDrop(event) {
  event.preventDefault();
  loadFile(event.dataTransfer?.files?.[0]);
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

function renderHeatmap() {
  const chart = initChart(heatmapEl.value, 'heatmap');
  if (!chart || !filteredMessages.value.length) return;
  const rows = dailyCounts(filteredMessages.value);
  const max = Math.max(...rows.map((x) => x.value), 1);
  const year = Number(selectedYear.value || filteredMessages.value[0].date.getFullYear());
  chart.off('click');
  chart.setOption({
    tooltip: { formatter: (p) => `${p.value[0]}<br/>${formatNumber(p.value[1])} 条消息<br/><span style="color:#9a7b87">点击查看当天 30 分钟级热图</span>` },
    visualMap: {
      min: 0,
      max,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      calculable: false,
      inRange: { color: ['#fff3f7', '#ffd4df', '#f49ab1', '#d9577a', '#8f2449'] },
      text: ['聊得多', '聊得少'],
      textStyle: { color: '#7a5261' },
    },
    calendar: {
      top: 45,
      left: 45,
      right: 25,
      bottom: 55,
      range: String(year),
      cellSize: ['auto', 17],
      splitLine: { show: false },
      itemStyle: { borderWidth: 3, borderColor: '#fffafd' },
      yearLabel: { show: false },
      monthLabel: { color: '#7d6670', fontSize: 12 },
      dayLabel: { firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六'], color: '#9a8790' },
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: rows.map((x) => [x.date, x.value]),
    }],
  }, true);

  chart.on('click', (params) => {
    const date = params.value?.[0];
    if (date) microscopeRef.value?.focusDate(date, 'day');
  });
}

function renderMonthly() {
  const chart = initChart(monthlyEl.value, 'monthly');
  if (!chart) return;
  const rows = monthlyCounts(filteredMessages.value);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: [selfName.value, partnerName.value], bottom: 0 },
    grid: { left: 48, right: 20, top: 25, bottom: 55 },
    xAxis: { type: 'category', data: rows.map((x) => x.month), axisLabel: { rotate: rows.length > 12 ? 45 : 0 } },
    yAxis: { type: 'value', name: '消息数' },
    series: [
      { name: selfName.value, type: 'bar', stack: 'total', data: rows.map((x) => x.sent), itemStyle: { color: '#d9577a' } },
      { name: partnerName.value, type: 'bar', stack: 'total', data: rows.map((x) => x.received), itemStyle: { color: '#79a9c9' } },
    ],
  }, true);
}

function renderHourly() {
  const chart = initChart(hourlyEl.value, 'hourly');
  if (!chart) return;
  const rows = hourlyCounts(filteredMessages.value);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 18, top: 25, bottom: 35 },
    xAxis: { type: 'category', data: rows.map((x) => `${x.hour}:00`) },
    yAxis: { type: 'value', name: '消息数' },
    series: [{
      type: 'bar',
      data: rows.map((x) => x.total),
      itemStyle: { color: '#7eabc9', borderRadius: [5, 5, 0, 0] },
      markLine: { silent: true, data: [{ xAxis: '0:00' }], lineStyle: { opacity: 0 } },
    }],
  }, true);
}

function renderInitiative() {
  const chart = initChart(initiativeEl.value, 'initiative');
  if (!chart) return;
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} 次 ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '45%'],
      label: { formatter: '{b}\n{d}%' },
      data: [
        { value: initiative.value.sentStarts, name: selfName.value, itemStyle: { color: '#d9577a' } },
        { value: initiative.value.receivedStarts, name: partnerName.value, itemStyle: { color: '#79a9c9' } },
      ],
    }],
  }, true);
}

function renderWords() {
  const chart = initChart(wordsEl.value, 'words');
  if (!chart) return;
  const rows = wordFrequency(filteredMessages.value, { limit: 80 });
  chart.setOption({
    tooltip: { show: true },
    series: [{
      type: 'wordCloud',
      shape: 'circle',
      gridSize: 8,
      sizeRange: [13, 52],
      rotationRange: [-20, 20],
      textStyle: {
        color: () => ['#8f2449', '#d9577a', '#d98ea3', '#5e8ba8', '#7eabc9'][Math.floor(Math.random() * 5)],
      },
      data: rows,
    }],
  }, true);
}

function renderDistinctive() {
  const chart = initChart(distinctiveEl.value, 'distinctive');
  if (!chart) return;
  const data = distinctiveWords(filteredMessages.value, 15);
  const left = data.sent.map((x) => ({ word: x.word, value: -x.sent }));
  const right = data.received.map((x) => ({ word: x.word, value: x.received }));
  const merged = [...left, ...right].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 24).reverse();
  chart.setOption({
    tooltip: { formatter: (p) => `${p.name}<br/>${formatNumber(Math.abs(p.value))} 次` },
    grid: { left: 90, right: 40, top: 25, bottom: 45 },
    xAxis: {
      type: 'value',
      axisLabel: { formatter: (v) => Math.abs(v) },
      splitLine: { lineStyle: { color: '#f2e7eb' } },
    },
    yAxis: { type: 'category', data: merged.map((x) => x.word), axisTick: { show: false } },
    series: [{
      type: 'bar',
      data: merged.map((x) => ({ value: x.value, itemStyle: { color: x.value < 0 ? '#d9577a' : '#79a9c9' } })),
      label: { show: true, position: (p) => (p.value < 0 ? 'left' : 'right'), formatter: (p) => Math.abs(p.value) },
    }],
  }, true);
}

function renderRomantic() {
  const chart = initChart(romanticEl.value, 'romantic');
  if (!chart) return;
  const { months, series } = romanticKeywordSeries(filteredMessages.value);
  const ranked = Object.entries(series)
    .map(([name, values]) => ({ name, total: Object.values(values).reduce((a, b) => a + b, 0), values }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ranked.map((x) => x.name), bottom: 0 },
    grid: { left: 48, right: 20, top: 25, bottom: 65 },
    xAxis: { type: 'category', data: months, axisLabel: { rotate: months.length > 12 ? 45 : 0 } },
    yAxis: { type: 'value', name: '出现次数' },
    series: ranked.map((x) => ({ name: x.name, type: 'line', smooth: true, symbolSize: 5, data: months.map((m) => x.values[m]) })),
  }, true);
}

function renderAll() {
  if (!filteredMessages.value.length) return;
  renderHeatmap();
  renderMonthly();
  renderHourly();
  renderInitiative();
  renderWords();
  renderDistinctive();
  renderRomantic();
}

function resizeCharts() {
  charts.forEach((chart) => chart.resize());
}

watch([selectedYear, initiativeGap], async () => {
  if (!messages.value.length) return;
  await nextTick();
  renderAll();
});

window.addEventListener('resize', resizeCharts);
onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts);
  charts.forEach((chart) => chart.dispose());
});
</script>

<template>
  <main class="page-shell">
    <header class="hero">
      <div>
        <p class="eyebrow">LOCAL · PRIVATE · YOUR STORY</p>
        <h1>WeChat Love Insight</h1>
        <p class="hero-copy">把聊天记录变成只属于两个人的时间地图。所有分析都在浏览器本地完成，原始聊天内容不会上传到服务器。</p>
      </div>
      <div class="hero-heart" aria-hidden="true">♥</div>
    </header>

    <section v-if="!messages.length" class="upload-card" @dragover.prevent @drop="onDrop">
      <div class="upload-icon">♡</div>
      <h2>拖入 WeChatMsg 导出的 HTML</h2>
      <p>支持你刚刚导出的聊天记录 HTML。文件只在当前浏览器中读取。</p>
      <button class="primary-btn" :disabled="loading" @click="triggerUpload">
        {{ loading ? '正在解析…' : '选择 HTML 文件' }}
      </button>
      <input ref="fileInput" class="hidden-input" type="file" accept=".html,.htm,text/html" @change="onFileChange" />
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="privacy-note"><strong>隐私保护：</strong>项目已默认忽略 *.html、数据库和 data/ 目录，不会把聊天记录提交到 GitHub。</div>
    </section>

    <template v-else>
      <section class="control-bar">
        <div>
          <span class="status-dot"></span>
          已载入 <strong>{{ fileName }}</strong>
          <span class="muted">· {{ formatNumber(messages.length) }} 条原始记录</span>
        </div>
        <div class="controls">
          <label>年份
            <select v-model="selectedYear">
              <option v-for="year in years" :key="year" :value="year">{{ year }}</option>
            </select>
          </label>
          <button class="ghost-btn" @click="triggerUpload">换一个文件</button>
          <input ref="fileInput" class="hidden-input" type="file" accept=".html,.htm,text/html" @change="onFileChange" />
        </div>
      </section>

      <section class="identity-card">
        <div class="person"><span class="person-badge warm">你</span><strong>{{ selfName }}</strong></div>
        <div class="identity-heart">♥</div>
        <div class="person"><span class="person-badge cool">TA</span><strong>{{ partnerName }}</strong></div>
      </section>

      <section v-if="overview" class="stats-grid">
        <article class="stat-card"><span>消息总数</span><strong>{{ formatNumber(overview.total) }}</strong><small>条</small></article>
        <article class="stat-card"><span>聊天活跃</span><strong>{{ formatNumber(overview.activeDays) }}</strong><small>天</small></article>
        <article class="stat-card"><span>文字总量</span><strong>{{ formatNumber(overview.totalChars) }}</strong><small>字</small></article>
        <article class="stat-card"><span>最长连续聊天</span><strong>{{ overview.longestStreak }}</strong><small>天</small></article>
        <article class="stat-card wide"><span>这一年的聊天跨度</span><strong class="date-range">{{ formatDate(overview.firstDate) }} → {{ formatDate(overview.lastDate) }}</strong><small v-if="overview.busiest">最能聊的一天：{{ overview.busiest.date }} · {{ formatNumber(overview.busiest.value) }} 条</small></article>
      </section>

      <section class="panel full-panel">
        <div class="panel-heading"><div><p class="section-kicker">CALENDAR HEATMAP</p><h2>聊天日历热力图</h2></div><p>颜色越深，这一天你们越能聊。点击任意日期，可直接放大到当天的 30 分钟级热图。</p></div>
        <div ref="heatmapEl" class="chart heatmap-chart"></div>
      </section>

      <TimeMicroscope
        ref="microscopeRef"
        :messages="filteredMessages"
        :self-name="selfName"
        :partner-name="partnerName"
      />

      <section class="two-column">
        <article class="panel">
          <div class="panel-heading"><div><p class="section-kicker">MONTHLY TREND</p><h2>每月聊天量</h2></div></div>
          <div ref="monthlyEl" class="chart"></div>
        </article>
        <article class="panel">
          <div class="panel-heading"><div><p class="section-kicker">24 HOURS</p><h2>一天里什么时候最能聊</h2></div></div>
          <div ref="hourlyEl" class="chart"></div>
        </article>
      </section>

      <section class="two-column">
        <article class="panel">
          <div class="panel-heading inline-heading">
            <div><p class="section-kicker">INITIATIVE</p><h2>谁更常开启一段聊天</h2></div>
            <label class="mini-control">沉默超过 <select v-model.number="initiativeGap"><option :value="2">2h</option><option :value="4">4h</option><option :value="6">6h</option><option :value="12">12h</option></select></label>
          </div>
          <div ref="initiativeEl" class="chart"></div>
          <p class="chart-note">把相隔至少 {{ initiativeGap }} 小时后的第一条消息视为一次“新会话开启”。这是互动行为指标，不等同于感情程度。</p>
        </article>
        <article class="panel response-panel">
          <div class="panel-heading"><div><p class="section-kicker">RESPONSE TIME</p><h2>回复速度</h2></div></div>
          <div class="response-grid">
            <div><span>{{ selfName }}</span><strong>{{ formatDuration(replies.sentMedianSeconds) }}</strong><small>中位回复时间 · {{ formatNumber(replies.sentSamples) }} 次有效切换</small></div>
            <div><span>{{ partnerName }}</span><strong>{{ formatDuration(replies.receivedMedianSeconds) }}</strong><small>中位回复时间 · {{ formatNumber(replies.receivedSamples) }} 次有效切换</small></div>
          </div>
          <p class="chart-note">连续同一人发送不重复计时；超过 12 小时的跨时段回复不纳入中位数。</p>
        </article>
      </section>

      <section class="two-column">
        <article class="panel">
          <div class="panel-heading"><div><p class="section-kicker">WORD CLOUD</p><h2>你们最常说的话</h2></div></div>
          <div ref="wordsEl" class="chart tall-chart"></div>
        </article>
        <article class="panel">
          <div class="panel-heading"><div><p class="section-kicker">SIGNATURE WORDS</p><h2>各自更偏爱的词</h2></div></div>
          <div class="mirror-labels"><span>← {{ selfName }}</span><span>{{ partnerName }} →</span></div>
          <div ref="distinctiveEl" class="chart tall-chart"></div>
        </article>
      </section>

      <section class="panel full-panel">
        <div class="panel-heading"><div><p class="section-kicker">LOVE KEYWORDS</p><h2>情侣关键词随时间变化</h2></div><p>宝宝、老婆、老公、爱你、想你、晚安、早安、抱抱、亲亲、对不起。</p></div>
        <div ref="romanticEl" class="chart romantic-chart"></div>
      </section>

      <AdvancedReport :messages="filteredMessages" :self-name="selfName" :partner-name="partnerName" />

      <footer class="footer-card">
        <div><strong>下一版</strong><span>年度故事翻页 · 自定义纪念日 · 长图导出 · 可打印情侣纪念册</span></div>
        <span class="footer-lock">本地分析 🔒</span>
      </footer>
    </template>
  </main>
</template>
