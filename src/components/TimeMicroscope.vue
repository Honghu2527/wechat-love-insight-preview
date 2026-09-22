<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  messages: { type: Array, required: true },
  selfName: { type: String, default: '我' },
  partnerName: { type: String, default: 'TA' },
});

const heatmapEl = ref(null);
const pulseEl = ref(null);
const mode = ref('week');
const selectedDate = ref('');
const weekMinutes = ref(30);
const dayMinutes = ref(10);
const selectedCell = ref(null);
let heatmapChart = null;
let pulseChart = null;

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const availableDates = computed(() => [...new Set(props.messages.map((m) => dateKey(m.date)))].sort());
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
  return {
    first: new Date(date.getFullYear(), date.getMonth(), 1, 12),
    last: new Date(date.getFullYear(), date.getMonth() + 1, 0, 12),
  };
}

function formatShort(value) {
  const date = typeof value === 'string' ? parseDate(value) : value;
  if (!date) return '—';
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatLong(value) {
  const date = typeof value === 'string' ? parseDate(value) : value;
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function timeLabel(binIndex, minutes) {
  const total = binIndex * minutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${pad(hour)}:${pad(minute)}`;
}

function getBinIndex(date, minutes) {
  return Math.floor((date.getHours() * 60 + date.getMinutes()) / minutes);
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

function buildPeriod(modeValue = mode.value) {
  if (!selectedDate.value) return { x: [], y: [], data: [], rows: [], title: '' };

  if (modeValue === 'month') {
    const bounds = monthBounds(selectedDate.value);
    if (!bounds) return { x: [], y: [], data: [], rows: [], title: '' };
    const minutes = 60;
    const bins = 24;
    const y = Array.from({ length: bounds.last.getDate() }, (_, i) => {
      const date = new Date(bounds.first.getFullYear(), bounds.first.getMonth(), i + 1, 12);
      return { key: dateKey(date), label: `${pad(i + 1)}日 ${['日','一','二','三','四','五','六'][date.getDay()]}` };
    });
    return buildMatrix(y, bins, minutes, true);
  }

  if (modeValue === 'week') {
    const start = mondayOf(selectedDate.value);
    if (!start) return { x: [], y: [], data: [], rows: [], title: '' };
    const minutes = weekMinutes.value;
    const bins = 1440 / minutes;
    const y = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return {
        key: dateKey(date),
        label: `${['周一','周二','周三','周四','周五','周六','周日'][i]} ${formatShort(date)}`,
      };
    });
    return buildMatrix(y, bins, minutes, true);
  }

  const minutes = dayMinutes.value;
  const bins = 1440 / minutes;
  const x = Array.from({ length: bins }, (_, i) => timeLabel(i, minutes));
  const y = [
    { key: 'sent', label: props.selfName },
    { key: 'received', label: props.partnerName },
  ];
  const counts = [Array(bins).fill(0), Array(bins).fill(0)];
  selectedDayMessages.value.forEach((m) => {
    const bin = getBinIndex(m.date, minutes);
    counts[m.isSend ? 0 : 1][bin] += 1;
  });

  const data = [];
  const rows = [];
  counts.forEach((line, yi) => {
    line.forEach((value, xi) => {
      data.push([xi, yi, value, selectedDate.value, yi === 0 ? value : 0, yi === 1 ? value : 0]);
    });
  });
  for (let xi = 0; xi < bins; xi += 1) {
    const sent = counts[0][xi];
    const received = counts[1][xi];
    rows.push({
      date: selectedDate.value,
      time: x[xi],
      sent,
      received,
      total: sent + received,
    });
  }
  return { x, y, data, rows, minutes };
}

function buildMatrix(y, bins, minutes) {
  const x = Array.from({ length: bins }, (_, i) => timeLabel(i, minutes));
  const index = new Map(y.map((row, i) => [row.key, i]));
  const buckets = new Map();

  props.messages.forEach((m) => {
    const key = dateKey(m.date);
    if (!index.has(key)) return;
    const xi = getBinIndex(m.date, minutes);
    const bucketKey = `${index.get(key)}-${xi}`;
    const current = buckets.get(bucketKey) || { sent: 0, received: 0, total: 0 };
    current.total += 1;
    if (m.isSend) current.sent += 1;
    else current.received += 1;
    buckets.set(bucketKey, current);
  });

  const data = [];
  const rows = [];
  y.forEach((row, yi) => {
    for (let xi = 0; xi < bins; xi += 1) {
      const bucket = buckets.get(`${yi}-${xi}`) || { sent: 0, received: 0, total: 0 };
      data.push([xi, yi, bucket.total, row.key, bucket.sent, bucket.received]);
      rows.push({
        date: row.key,
        time: x[xi],
        sent: bucket.sent,
        received: bucket.received,
        total: bucket.total,
      });
    }
  });
  return { x, y, data, rows, minutes };
}

const matrix = computed(() => buildPeriod());

const topWindows = computed(() => matrix.value.rows
  .filter((x) => x.total > 0)
  .sort((a, b) => b.total - a.total)
  .slice(0, 5));

const activeBins = computed(() => matrix.value.rows.filter((x) => x.total > 0).length);

const periodTotals = computed(() => matrix.value.rows.reduce(
  (acc, row) => {
    acc.total += row.total;
    acc.sent += row.sent;
    acc.received += row.received;
    return acc;
  },
  { total: 0, sent: 0, received: 0 },
));

const balanceText = computed(() => {
  const total = periodTotals.value.total;
  if (!total) return '—';
  const sentShare = periodTotals.value.sent / total;
  return `${Math.round(sentShare * 100)}% / ${Math.round((1 - sentShare) * 100)}%`;
});

function renderHeatmap() {
  if (!heatmapEl.value || !selectedDate.value) return;
  if (!heatmapChart) heatmapChart = echarts.init(heatmapEl.value);

  const built = matrix.value;
  const max = Math.max(...built.data.map((x) => x[2]), 1);
  const isDay = mode.value === 'day';
  const isMonth = mode.value === 'month';
  const xLabelInterval = isDay
    ? Math.max(Math.floor((1440 / dayMinutes.value) / 12) - 1, 0)
    : mode.value === 'week'
      ? Math.max(Math.floor((1440 / weekMinutes.value) / 12) - 1, 0)
      : 1;

  heatmapChart.off('click');
  heatmapChart.setOption({
    animationDuration: 250,
    tooltip: {
      formatter: (p) => {
        const value = p.value;
        const label = built.x[value[0]];
        const sent = value[4] || 0;
        const received = value[5] || 0;
        if (isDay) {
          return `${built.y[value[1]].label}<br/>${label}<br/><b>${formatNumber(value[2])}</b> 条消息`;
        }
        return `${value[3]} · ${label}<br/><b>${formatNumber(value[2])}</b> 条消息<br/>${props.selfName} ${sent} · ${props.partnerName} ${received}`;
      },
    },
    grid: {
      left: isMonth ? 96 : isDay ? 110 : 110,
      right: 28,
      top: 18,
      bottom: 72,
    },
    xAxis: {
      type: 'category',
      data: built.x,
      splitArea: { show: true },
      axisLabel: {
        interval: xLabelInterval,
        fontSize: 10,
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
      inRange: { color: ['#fbfcfd', '#e6eff4', '#c9dce7', '#edbfd0', '#dc84a2', '#b94b72', '#7e2347'] },
      text: ['消息多', '消息少'],
      textStyle: { color: '#7e6b74' },
    },
    series: [{
      type: 'heatmap',
      data: built.data,
      progressive: 2000,
      itemStyle: { borderWidth: 0.4, borderColor: 'rgba(255,255,255,.55)' },
      emphasis: {
        itemStyle: {
          borderColor: '#5d223b',
          borderWidth: 1,
          shadowBlur: 8,
          shadowColor: 'rgba(80,45,58,.18)',
        },
      },
    }],
  }, true);

  heatmapChart.on('click', (params) => {
    const value = params.value;
    selectedCell.value = {
      date: value[3],
      time: built.x[value[0]],
      total: value[2],
      sent: value[4] || 0,
      received: value[5] || 0,
      participant: isDay ? built.y[value[1]].label : null,
    };

    if (!isDay && value[3]) selectedDate.value = value[3];
  });
}

function pulseRows() {
  if (!selectedDate.value) return [];

  if (mode.value === 'month') {
    const bounds = monthBounds(selectedDate.value);
    if (!bounds) return [];
    const days = bounds.last.getDate();
    const rows = Array.from({ length: days }, (_, i) => ({
      label: `${i + 1}日`, sent: 0, received: 0, total: 0,
    }));
    props.messages.forEach((m) => {
      if (m.date.getFullYear() !== bounds.first.getFullYear() || m.date.getMonth() !== bounds.first.getMonth()) return;
      const row = rows[m.date.getDate() - 1];
      row.total += 1;
      if (m.isSend) row.sent += 1;
      else row.received += 1;
    });
    return rows;
  }

  if (mode.value === 'week') {
    const start = mondayOf(selectedDate.value);
    if (!start) return [];
    const keys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return dateKey(d);
    });
    const keyIndex = new Map(keys.map((k, i) => [k, i]));
    const rows = Array.from({ length: 7 * 24 }, (_, i) => ({
      label: `${['一','二','三','四','五','六','日'][Math.floor(i / 24)]} ${pad(i % 24)}:00`,
      sent: 0,
      received: 0,
      total: 0,
    }));
    props.messages.forEach((m) => {
      const dayIndex = keyIndex.get(dateKey(m.date));
      if (dayIndex === undefined) return;
      const row = rows[dayIndex * 24 + m.date.getHours()];
      row.total += 1;
      if (m.isSend) row.sent += 1;
      else row.received += 1;
    });
    return rows;
  }

  const minutes = dayMinutes.value;
  const bins = 1440 / minutes;
  const rows = Array.from({ length: bins }, (_, i) => ({
    label: timeLabel(i, minutes),
    sent: 0,
    received: 0,
    total: 0,
  }));
  selectedDayMessages.value.forEach((m) => {
    const row = rows[getBinIndex(m.date, minutes)];
    row.total += 1;
    if (m.isSend) row.sent += 1;
    else row.received += 1;
  });
  return rows;
}

function renderPulse() {
  if (!pulseEl.value || !selectedDate.value) return;
  if (!pulseChart) pulseChart = echarts.init(pulseEl.value);
  const rows = pulseRows();
  const interval = Math.max(Math.floor(rows.length / 10) - 1, 0);

  pulseChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: [props.selfName, props.partnerName] },
    grid: { left: 48, right: 18, top: 20, bottom: 58 },
    xAxis: {
      type: 'category',
      data: rows.map((x) => x.label),
      axisLabel: { interval, fontSize: 10 },
      boundaryGap: false,
    },
    yAxis: { type: 'value', name: '消息数' },
    series: [
      {
        name: props.selfName,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.08 },
        data: rows.map((x) => x.sent),
      },
      {
        name: props.partnerName,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.08 },
        data: rows.map((x) => x.received),
      },
    ],
  }, true);
}

function renderAll() {
  renderHeatmap();
  renderPulse();
}

function move(direction) {
  if (!selectedDate.value) return;
  const current = parseDate(selectedDate.value);
  if (!current) return;

  if (mode.value === 'day') current.setDate(current.getDate() + direction);
  if (mode.value === 'week') current.setDate(current.getDate() + direction * 7);
  if (mode.value === 'month') current.setMonth(current.getMonth() + direction);

  selectedDate.value = clampDate(dateKey(current));
  selectedCell.value = null;
}

function jumpToBusiest() {
  if (!busiestDate.value) return;
  selectedDate.value = busiestDate.value.key;
  mode.value = 'day';
  selectedCell.value = null;
}

function focusDate(value, targetMode = 'day') {
  if (!value) return;
  selectedDate.value = clampDate(value);
  mode.value = targetMode;
  selectedCell.value = null;
  nextTick(() => {
    renderAll();
    heatmapEl.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function download(filename, href) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportPng() {
  if (!heatmapChart) return;
  const dataUrl = heatmapChart.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: '#fffdfd',
  });
  download(`wechat-heatmap-${mode.value}-${selectedDate.value}.png`, dataUrl);
}

function exportCsv() {
  const rows = matrix.value.rows.filter((x) => x.total > 0);
  const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [
    ['date', 'time', props.selfName, props.partnerName, 'total'].map(escapeCell).join(','),
    ...rows.map((row) => [row.date, row.time, row.sent, row.received, row.total].map(escapeCell).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  download(`wechat-heatmap-${mode.value}-${selectedDate.value}.csv`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onResize() {
  heatmapChart?.resize();
  pulseChart?.resize();
}

defineExpose({ focusDate });

watch([mode, selectedDate, weekMinutes, dayMinutes, () => props.messages], async () => {
  await nextTick();
  renderAll();
});

onMounted(async () => {
  selectedDate.value = busiestDate.value?.key || maxDate.value || minDate.value;
  await nextTick();
  renderAll();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  heatmapChart?.dispose();
  pulseChart?.dispose();
  heatmapChart = null;
  pulseChart = null;
});
</script>

<template>
  <section class="panel full-panel microscope-panel">
    <div class="panel-heading microscope-heading">
      <div>
        <p class="section-kicker">TIME MICROSCOPE · 时间显微镜</p>
        <h2>把热图放大到某月、某周、某一天</h2>
        <p class="microscope-copy">
          月视图精确到每小时；周视图可细到 15 分钟；日视图最高可细到 5 分钟。
          越往下钻取，热图越密集，可以看到非常具体的聊天节奏。
        </p>
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

        <label v-if="mode === 'week'">周精度
          <select v-model.number="weekMinutes">
            <option :value="60">60分钟</option>
            <option :value="30">30分钟</option>
            <option :value="15">15分钟</option>
          </select>
        </label>

        <label v-if="mode === 'day'">日精度
          <select v-model.number="dayMinutes">
            <option :value="30">30分钟</option>
            <option :value="15">15分钟</option>
            <option :value="10">10分钟</option>
            <option :value="5">5分钟</option>
          </select>
        </label>

        <button class="busiest-btn" @click="jumpToBusiest">最活跃日</button>
      </div>
    </div>

    <div class="micro-kpis">
      <div><span>当前区间消息</span><strong>{{ formatNumber(periodTotals.total) }}</strong><small>{{ periodLabel }}</small></div>
      <div><span>活跃时间格</span><strong>{{ formatNumber(activeBins) }}</strong><small>有消息的热图格子</small></div>
      <div><span>双方占比</span><strong>{{ balanceText }}</strong><small>{{ selfName }} / {{ partnerName }}</small></div>
      <div><span>当天峰值小时</span><strong>{{ selectedDayStats.peakHour === null ? '—' : String(selectedDayStats.peakHour).padStart(2, '0') + ':00' }}</strong><small v-if="selectedDayStats.peakHour !== null">{{ formatNumber(selectedDayStats.peakValue) }} 条</small></div>
    </div>

    <div class="export-row no-print">
      <button @click="exportPng">导出当前热图 PNG</button>
      <button @click="exportCsv">导出当前热图 CSV</button>
    </div>

    <div ref="heatmapEl" :class="['chart', 'microscope-chart', { month: mode === 'month', day: mode === 'day' }]"></div>

    <div v-if="selectedCell" class="selected-cell">
      <strong>选中的时间格</strong>
      <span>{{ selectedCell.date }} · {{ selectedCell.time }}</span>
      <span v-if="selectedCell.participant">{{ selectedCell.participant }}：{{ selectedCell.total }} 条</span>
      <span v-else>{{ selfName }} {{ selectedCell.sent }} · {{ partnerName }} {{ selectedCell.received }} · 共 {{ selectedCell.total }} 条</span>
    </div>

    <div class="micro-extra-grid">
      <article class="micro-subpanel">
        <div class="sub-heading">
          <div>
            <p class="section-kicker">CHAT PULSE</p>
            <h3>互动脉搏</h3>
          </div>
          <span>看双方消息量如何随时间起伏</span>
        </div>
        <div ref="pulseEl" class="pulse-chart"></div>
      </article>

      <article class="micro-subpanel">
        <div class="sub-heading">
          <div>
            <p class="section-kicker">TOP WINDOWS</p>
            <h3>最密集的 5 个时间窗</h3>
          </div>
        </div>
        <div v-if="topWindows.length" class="top-window-list">
          <div v-for="(item, index) in topWindows" :key="item.date + item.time" class="top-window-item">
            <span class="rank">{{ index + 1 }}</span>
            <div>
              <strong>{{ item.date }} · {{ item.time }}</strong>
              <small>{{ selfName }} {{ item.sent }} · {{ partnerName }} {{ item.received }}</small>
            </div>
            <b>{{ item.total }}</b>
          </div>
        </div>
        <p v-else class="empty-note">当前区间暂无消息。</p>
      </article>
    </div>

    <p class="chart-note microscope-note">提示：热图展示的是聊天活动密度，不代表关系质量。周/日精度越细，越适合寻找“某一晚”“某个半小时”的聊天高峰。</p>
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
.mode-switch button,
.export-row button {
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
.date-controls { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
.date-controls label { color: #806b74; font-size: 12px; }
.date-controls input,
.date-controls select {
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
.export-row { display: flex; justify-content: flex-end; gap: 8px; margin: 10px 0 0; }
.export-row button { background: #f7f1f3; color: #8e3d5c; }
.export-row button:hover { background: #f0e4e9; }
.microscope-chart { height: 470px; }
.microscope-chart.month { height: 810px; }
.microscope-chart.day { height: 330px; }
.selected-cell {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  padding: 11px 14px;
  margin-top: 4px;
  border-radius: 12px;
  background: #fff7fa;
  color: #76515f;
  font-size: 12px;
}
.selected-cell strong { color: #9a3e61; }
.micro-extra-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, .85fr);
  gap: 14px;
  margin-top: 14px;
}
.micro-subpanel {
  min-width: 0;
  padding: 16px;
  border: 1px solid #f0e5e9;
  border-radius: 16px;
  background: rgba(255,255,255,.78);
}
.sub-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.sub-heading h3 { margin: 2px 0 0; color: #583744; font-size: 17px; }
.sub-heading > span { color: #9a8790; font-size: 11px; }
.pulse-chart { height: 285px; }
.top-window-list { display: grid; gap: 9px; margin-top: 12px; }
.top-window-item {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 11px;
  border-radius: 12px;
  background: linear-gradient(90deg, #fff7fa, #f8fbfd);
}
.rank {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #f2dbe3;
  color: #9b4564;
  font-size: 11px;
  font-weight: 800;
}
.top-window-item div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.top-window-item strong { color: #61404c; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-window-item small { color: #9b8790; font-size: 11px; }
.top-window-item b { color: #8e3658; font-size: 18px; }
.empty-note { color: #9b8790; padding: 16px 4px; }
.microscope-note { margin-top: 12px; }

@media (max-width: 1000px) {
  .micro-extra-grid { grid-template-columns: 1fr; }
}
@media (max-width: 920px) {
  .microscope-toolbar { align-items: flex-start; flex-direction: column; }
  .date-controls { width: 100%; justify-content: flex-start; }
  .micro-kpis { grid-template-columns: repeat(2, 1fr); }
  .microscope-chart.month { height: 760px; }
}
@media (max-width: 620px) {
  .microscope-heading { flex-direction: column; }
  .date-controls { align-items: flex-start; flex-direction: column; }
  .date-controls label { width: 100%; }
  .micro-kpis { grid-template-columns: 1fr 1fr; }
  .microscope-chart { height: 430px; }
  .microscope-chart.month { height: 720px; }
  .microscope-chart.day { height: 300px; }
  .micro-kpis strong { font-size: 20px; }
}
@media print {
  .no-print,
  .mode-switch,
  .microscope-toolbar { display: none !important; }
  .microscope-chart { height: 430px !important; }
  .micro-extra-grid { grid-template-columns: 1fr; }
}
</style>
