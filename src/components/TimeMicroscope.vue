<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  messages: { type: Array, required: true },
  selfName: { type: String, default: '我' },
  partnerName: { type: String, default: 'TA' },
});

const chartEl = ref(null);
const mode = ref('week');
const selectedDate = ref('');
let chart = null;

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const availableDates = computed(() => {
  const values = [...new Set(props.messages.map((m) => dateKey(m.date)))].sort();
  return values;
});

const minDate = computed(() => availableDates.value[0] || '');
const maxDate = computed(() => availableDates.value.at(-1) || '');

const messageCountByDay = computed(() => {
  const map = new Map();
  props.messages.forEach((message) => {
    const key = dateKey(message.date);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
});

const busiestDate = computed(() => {
  let best = null;
  messageCountByDay.value.forEach((value, key) => {
    if (!best || value > best.value) best = { key, value };
  });
  return best;
});

function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(value, days) {
  const date = parseDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function clampDate(value) {
  if (!value) return minDate.value || maxDate.value || '';
  if (minDate.value && value < minDate.value) return minDate.value;
  if (maxDate.value && value > maxDate.value) return maxDate.value;
  return value;
}

function mondayOf(value) {
  const date = parseDate(value);
  if (!date) return null;
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function monthBounds(value) {
  const date = parseDate(value);
  if (!date) return null;
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  return { first, last };
}

function formatShort(value) {
  const date = typeof value === 'string' ? parseDate(value) : value;
  if (!date) return '—';
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatLong(value) {
  const date = typeof value === 'string' ? parseDate(value) : value;
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function messagesForDate(value) {
  return props.messages.filter((m) => dateKey(m.date) === value);
}

const selectedDayMessages = computed(() => messagesForDate(selectedDate.value));

const selectedDayStats = computed(() => {
  const rows = selectedDayMessages.value;
  const sent = rows.filter((m) => m.isSend).length;
  const received = rows.length - sent;
  const hourly = Array(24).fill(0);
  rows.forEach((m) => { hourly[m.date.getHours()] += 1; });
  const max = Math.max(...hourly);
  const peakHour = max ? hourly.indexOf(max) : null;
  return { total: rows.length, sent, received, peakHour, peakValue: max };
});

const periodLabel = computed(() => {
  if (!selectedDate.value) return '—';
  if (mode.value === 'day') return formatLong(selectedDate.value);
  if (mode.value === 'week') {
    const start = mondayOf(selectedDate.value);
    if (!start) return '—';
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${formatShort(start)} – ${formatShort(end)}`;
  }
  const date = parseDate(selectedDate.value);
  return date ? `${date.getFullYear()}年${date.getMonth() + 1}月` : '—';
});

function buildMonthData() {
  const bounds = monthBounds(selectedDate.value);
  if (!bounds) return { x: [], y: [], data: [] };

  const days = bounds.last.getDate();
  const y = Array.from({ length: days }, (_, i) => {
    const date = new Date(bounds.first.getFullYear(), bounds.first.getMonth(), i + 1, 12);
    return { key: dateKey(date), label: `${pad(i + 1)}日 ${['日','一','二','三','四','五','六'][date.getDay()]}` };
  });
  const index = new Map(y.map((row, i) => [row.key, i]));
  const map = new Map();

  props.messages.forEach((m) => {
    const key = dateKey(m.date);
    if (!index.has(key)) return;
    const bucket = `${index.get(key)}-${m.date.getHours()}`;
    map.set(bucket, (map.get(bucket) || 0) + 1);
  });

  const data = [];
  y.forEach((row, yi) => {
    for (let hour = 0; hour < 24; hour += 1) {
      data.push([hour, yi, map.get(`${yi}-${hour}`) || 0, row.key]);
    }
  });

  return { x: Array.from({ length: 24 }, (_, h) => `${h}:00`), y, data };
}

function buildWeekData() {
  const start = mondayOf(selectedDate.value);
  if (!start) return { x: [], y: [], data: [] };
  const y = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return { key: dateKey(date), label: `${['周一','周二','周三','周四','周五','周六','周日'][i]} ${formatShort(date)}` };
  });
  const index = new Map(y.map((row, i) => [row.key, i]));
  const map = new Map();

  props.messages.forEach((m) => {
    const key = dateKey(m.date);
    if (!index.has(key)) return;
    const bucket = `${index.get(key)}-${m.date.getHours()}`;
    map.set(bucket, (map.get(bucket) || 0) + 1);
  });

  const data = [];
  y.forEach((row, yi) => {
    for (let hour = 0; hour < 24; hour += 1) {
      data.push([hour, yi, map.get(`${yi}-${hour}`) || 0, row.key]);
    }
  });

  return { x: Array.from({ length: 24 }, (_, h) => `${h}:00`), y, data };
}

function buildDayData() {
  const rows = selectedDayMessages.value;
  const y = [
    { key: 'sent', label: props.selfName },
    { key: 'received', label: props.partnerName },
  ];
  const bins = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const min = i % 2 ? '30' : '00';
    return `${pad(h)}:${min}`;
  });
  const counts = [Array(48).fill(0), Array(48).fill(0)];

  rows.forEach((m) => {
    const bin = m.date.getHours() * 2 + (m.date.getMinutes() >= 30 ? 1 : 0);
    counts[m.isSend ? 0 : 1][bin] += 1;
  });

  const data = [];
  counts.forEach((line, yi) => {
    line.forEach((value, xi) => data.push([xi, yi, value, selectedDate.value]));
  });

  return { x: bins, y, data };
}

function render() {
  if (!chartEl.value || !selectedDate.value) return;
  if (!chart) chart = echarts.init(chartEl.value);

  const built = mode.value === 'month' ? buildMonthData() : mode.value === 'day' ? buildDayData() : buildWeekData();
  const max = Math.max(...built.data.map((x) => x[2]), 1);
  const isDay = mode.value === 'day';
  const isMonth = mode.value === 'month';

  chart.off('click');
  chart.setOption({
    animationDuration: 350,
    tooltip: {
      formatter: (p) => {
        const value = p.value;
        if (isDay) return `${built.y[value[1]].label}<br/>${built.x[value[0]]}–${built.x[Math.min(value[0] + 1, 47)]}<br/><b>${formatNumber(value[2])}</b> 条消息`;
        return `${value[3]}<br/>${built.x[value[0]]}<br/><b>${formatNumber(value[2])}</b> 条消息`;
      },
    },
    grid: {
      left: isMonth ? 92 : isDay ? 110 : 100,
      right: 28,
      top: 18,
      bottom: 72,
      containLabel: false,
    },
    xAxis: {
      type: 'category',
      data: built.x,
      splitArea: { show: true },
      axisLabel: {
        interval: isDay ? 3 : 2,
        fontSize: 11,
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: built.y.map((x) => x.label),
      splitArea: { show: true },
      inverse: true,
      axisLabel: { fontSize: isMonth ? 10 : 12 },
      axisTick: { show: false },
    },
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 8,
      inRange: { color: ['#f8fbfd', '#e2eef5', '#b7d2e1', '#e1a5b8', '#cf6888', '#8f3156'] },
      text: ['消息多', '消息少'],
      textStyle: { color: '#7e6b74' },
    },
    series: [{
      type: 'heatmap',
      data: built.data,
      progressive: 1000,
      emphasis: {
        itemStyle: {
          borderColor: '#6f2f49',
          borderWidth: 1,
          shadowBlur: 8,
          shadowColor: 'rgba(80,45,58,.20)',
        },
      },
    }],
  }, true);

  if (!isDay) {
    chart.on('click', (params) => {
      const key = params.value?.[3];
      if (!key) return;
      selectedDate.value = key;
      mode.value = 'day';
    });
  }
}

function move(direction) {
  if (!selectedDate.value) return;
  const current = parseDate(selectedDate.value);
  if (!current) return;

  if (mode.value === 'day') current.setDate(current.getDate() + direction);
  if (mode.value === 'week') current.setDate(current.getDate() + direction * 7);
  if (mode.value === 'month') current.setMonth(current.getMonth() + direction);

  selectedDate.value = clampDate(dateKey(current));
}

function jumpToBusiest() {
  if (!busiestDate.value) return;
  selectedDate.value = busiestDate.value.key;
  mode.value = 'day';
}

function focusDate(value, targetMode = 'day') {
  if (!value) return;
  selectedDate.value = clampDate(value);
  mode.value = targetMode;
  nextTick(() => {
    render();
    chartEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

defineExpose({ focusDate });

watch([mode, selectedDate, () => props.messages], async () => {
  await nextTick();
  render();
});

onMounted(async () => {
  selectedDate.value = busiestDate.value?.key || maxDate.value || minDate.value;
  await nextTick();
  render();
  window.addEventListener('resize', () => chart?.resize());
});

onBeforeUnmount(() => {
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <section class="panel full-panel microscope-panel">
    <div class="panel-heading microscope-heading">
      <div>
        <p class="section-kicker">TIME MICROSCOPE · 时间显微镜</p>
        <h2>把热图放大到某月、某周、某一天</h2>
        <p class="microscope-copy">周/月视图精确到每小时；日视图精确到每 30 分钟，并区分你和 TA。点击周/月热图中的任意格子，会直接钻取到当天。</p>
      </div>
      <div class="mode-switch" role="tablist" aria-label="热图粒度">
        <button :class="{ active: mode === 'month' }" @click="mode = 'month'">月</button>
        <button :class="{ active: mode === 'week' }" @click="mode = 'week'">周</button>
        <button :class="{ active: mode === 'day' }" @click="mode = 'day'">日</button>
      </div>
    </div>

    <div class="microscope-toolbar">
      <div class="period-navigation">
        <button class="nav-btn" @click="move(-1)">‹</button>
        <strong>{{ periodLabel }}</strong>
        <button class="nav-btn" @click="move(1)">›</button>
      </div>
      <div class="date-controls">
        <label>定位日期
          <input v-model="selectedDate" type="date" :min="minDate" :max="maxDate" />
        </label>
        <button class="busiest-btn" @click="jumpToBusiest">跳到最活跃日</button>
      </div>
    </div>

    <div class="micro-kpis">
      <div><span>当天消息</span><strong>{{ formatNumber(selectedDayStats.total) }}</strong><small>{{ formatLong(selectedDate) }}</small></div>
      <div><span>{{ selfName }}</span><strong>{{ formatNumber(selectedDayStats.sent) }}</strong><small>当天发送</small></div>
      <div><span>{{ partnerName }}</span><strong>{{ formatNumber(selectedDayStats.received) }}</strong><small>当天发送</small></div>
      <div><span>当天峰值小时</span><strong>{{ selectedDayStats.peakHour === null ? '—' : String(selectedDayStats.peakHour).padStart(2, '0') + ':00' }}</strong><small v-if="selectedDayStats.peakHour !== null">{{ formatNumber(selectedDayStats.peakValue) }} 条</small></div>
    </div>

    <div ref="chartEl" :class="['chart', 'microscope-chart', { month: mode === 'month', day: mode === 'day' }]"></div>
    <p class="chart-note microscope-note">提示：这里展示的是消息活动密度，不代表关系质量；空白格表示该时间段没有记录到消息。</p>
  </section>
</template>

<style scoped>
.microscope-panel { overflow: hidden; }
.microscope-heading { align-items: flex-start; }
.microscope-heading > div:first-child { max-width: 900px; }
.microscope-copy { margin: 9px 0 0; color: #917b84; line-height: 1.7; font-size: 13px; }
.mode-switch {
  flex: 0 0 auto;
  display: inline-flex;
  padding: 4px;
  border-radius: 13px;
  background: #f5edf0;
  gap: 3px;
}
.mode-switch button {
  min-width: 46px;
  padding: 8px 13px;
  border-radius: 10px;
  background: transparent;
  color: #856d77;
  cursor: pointer;
  font-weight: 700;
}
.mode-switch button.active {
  background: #fff;
  color: #9d3b60;
  box-shadow: 0 3px 14px rgba(91,48,64,.10);
}
.microscope-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  margin: 14px 0 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(90deg, #fff5f8, #f6fafc);
}
.period-navigation { display: flex; align-items: center; gap: 12px; }
.period-navigation strong { min-width: 150px; text-align: center; color: #5d3b49; }
.nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #fff;
  color: #a24668;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(78,44,57,.08);
  font-size: 22px;
  line-height: 1;
}
.date-controls { display: flex; align-items: center; gap: 10px; }
.date-controls label { color: #806b74; font-size: 12px; }
.date-controls input {
  margin-left: 7px;
  padding: 8px 10px;
  border: 1px solid #eadde2;
  border-radius: 10px;
  background: white;
  color: #5a4550;
}
.busiest-btn {
  padding: 9px 13px;
  border-radius: 11px;
  background: #fff;
  color: #9d3b60;
  cursor: pointer;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(78,44,57,.07);
}
.micro-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 12px 0 6px;
}
.micro-kpis > div {
  min-height: 92px;
  padding: 14px 16px;
  border: 1px solid #f0e4e8;
  border-radius: 15px;
  background: rgba(255,255,255,.78);
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.micro-kpis span { color: #8f7982; font-size: 12px; }
.micro-kpis strong { margin: 4px 0 2px; color: #573744; font-size: 24px; }
.micro-kpis small { color: #a18f96; }
.microscope-chart { height: 450px; }
.microscope-chart.month { height: 780px; }
.microscope-chart.day { height: 310px; }
.microscope-note { margin-top: 2px; }

@media (max-width: 920px) {
  .microscope-toolbar { align-items: flex-start; flex-direction: column; }
  .date-controls { width: 100%; justify-content: space-between; }
  .micro-kpis { grid-template-columns: repeat(2, 1fr); }
  .microscope-chart.month { height: 720px; }
}
@media (max-width: 620px) {
  .microscope-heading { flex-direction: column; }
  .date-controls { align-items: flex-start; flex-direction: column; }
  .micro-kpis { grid-template-columns: 1fr 1fr; }
  .microscope-chart { height: 420px; }
  .microscope-chart.month { height: 700px; }
  .microscope-chart.day { height: 280px; }
}
@media print {
  .mode-switch, .microscope-toolbar { display: none !important; }
  .microscope-chart { height: 420px !important; }
}
</style>
