<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  messages: { type: Array, required: true },
  selfName: { type: String, default: '我' },
  partnerName: { type: String, default: 'TA' },
});

const emit = defineEmits(['focus-date']);

const chartEl = ref(null);
const rangeKey = ref('all');
const granularity = ref(30);
const displayMode = ref('total');
const selectedCell = ref(null);
let chart = null;

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const formatNumber = (value) => new Intl.NumberFormat('zh-CN').format(value || 0);

const years = computed(() => [...new Set(props.messages.map((m) => m.date.getFullYear()))].sort((a, b) => a - b));
const months = computed(() => [...new Set(props.messages.map((m) => monthKey(m.date)))].sort());

const rangeOptions = computed(() => {
  const options = [{ value: 'all', label: '全部聊天记录' }];
  [...years.value].reverse().forEach((year) => options.push({ value: `year:${year}`, label: `${year} 年` }));
  [...months.value].reverse().forEach((month) => options.push({ value: `month:${month}`, label: month.replace('-', ' 年 ') + ' 月' }));
  return options;
});

const rangeMessages = computed(() => {
  if (rangeKey.value === 'all') return props.messages;
  const [type, value] = rangeKey.value.split(':');
  if (type === 'year') return props.messages.filter((m) => String(m.date.getFullYear()) === value);
  if (type === 'month') return props.messages.filter((m) => monthKey(m.date) === value);
  return props.messages;
});

function daySequence(messages) {
  if (!messages.length) return [];
  const first = new Date(messages[0].date.getFullYear(), messages[0].date.getMonth(), messages[0].date.getDate(), 12);
  const lastMsg = messages.at(-1);
  const last = new Date(lastMsg.date.getFullYear(), lastMsg.date.getMonth(), lastMsg.date.getDate(), 12);
  const rows = [];
  for (const date = new Date(first); date <= last; date.setDate(date.getDate() + 1)) {
    const d = new Date(date);
    rows.push({
      key: dateKey(d),
      label: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
      fullLabel: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).format(d),
    });
  }
  return rows;
}

function timeLabel(index, minutes) {
  const total = index * minutes;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${pad(hour)}:${pad(minute)}`;
}

function cellValue(bucket) {
  if (displayMode.value === 'self') return bucket.sent;
  if (displayMode.value === 'partner') return bucket.received;
  if (displayMode.value === 'balance') return bucket.sent - bucket.received;
  return bucket.total;
}

const matrix = computed(() => {
  const messages = rangeMessages.value;
  const rows = daySequence(messages);
  const minutes = granularity.value;
  const bins = 1440 / minutes;
  const x = Array.from({ length: bins }, (_, i) => timeLabel(i, minutes));
  const rowIndex = new Map(rows.map((row, i) => [row.key, i]));
  const buckets = new Map();

  messages.forEach((m) => {
    const day = dateKey(m.date);
    const yi = rowIndex.get(day);
    if (yi === undefined) return;
    const xi = Math.floor((m.date.getHours() * 60 + m.date.getMinutes()) / minutes);
    const key = `${yi}-${xi}`;
    const bucket = buckets.get(key) || { sent: 0, received: 0, total: 0 };
    bucket.total += 1;
    if (m.isSend) bucket.sent += 1;
    else bucket.received += 1;
    buckets.set(key, bucket);
  });

  const data = [];
  const flatRows = [];
  rows.forEach((row, yi) => {
    for (let xi = 0; xi < bins; xi += 1) {
      const bucket = buckets.get(`${yi}-${xi}`) || { sent: 0, received: 0, total: 0 };
      const value = cellValue(bucket);
      data.push([xi, yi, value, row.key, bucket.sent, bucket.received, bucket.total]);
      flatRows.push({
        date: row.key,
        time: x[xi],
        sent: bucket.sent,
        received: bucket.received,
        total: bucket.total,
        value,
      });
    }
  });

  return { rows, x, data, flatRows, minutes };
});

const summary = computed(() => {
  const messages = rangeMessages.value;
  const activeRows = matrix.value.flatRows.filter((x) => x.total > 0);
  const top = [...activeRows].sort((a, b) => b.total - a.total).slice(0, 5);
  const activeDays = new Set(messages.map((m) => dateKey(m.date))).size;
  const totalCells = matrix.value.flatRows.length || 1;
  const density = activeRows.length / totalCells;
  const lateNight = messages.filter((m) => m.date.getHours() < 5).length;

  return {
    total: messages.length,
    activeDays,
    activeCells: activeRows.length,
    density,
    lateNightShare: messages.length ? lateNight / messages.length : 0,
    top,
  };
});

const rangeLabel = computed(() => rangeOptions.value.find((x) => x.value === rangeKey.value)?.label || '全部聊天记录');

function modeLabel() {
  return {
    total: '总消息',
    self: props.selfName,
    partner: props.partnerName,
    balance: '双方差值',
  }[displayMode.value];
}

function render() {
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);

  const built = matrix.value;
  if (!built.rows.length) {
    chart.clear();
    return;
  }

  const values = built.data.map((x) => x[2]);
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  const labelEvery = Math.max(Math.ceil(built.rows.length / 12), 1);
  const xEvery = Math.max(Math.floor(built.x.length / 12), 1);

  const visualMap = displayMode.value === 'balance'
    ? {
        min: -max,
        max,
        orient: 'horizontal',
        left: 'center',
        bottom: 6,
        calculable: false,
        inRange: { color: ['#568aae', '#dbe8f0', '#fff9fb', '#efb6c8', '#a92f59'] },
        text: [props.selfName + ' 更多', props.partnerName + ' 更多'],
        textStyle: { color: '#7e6b74' },
      }
    : {
        min: 0,
        max,
        orient: 'horizontal',
        left: 'center',
        bottom: 6,
        calculable: false,
        inRange: { color: ['#fffafb', '#fdecef', '#f8cbd6', '#ed91aa', '#d34f79', '#a41f50', '#6f1238'] },
        text: ['消息多', '消息少'],
        textStyle: { color: '#7e6b74' },
      };

  chart.off('click');
  chart.setOption({
    animation: false,
    tooltip: {
      formatter: (p) => {
        const value = p.value;
        const day = built.rows[value[1]];
        const sent = value[4] || 0;
        const received = value[5] || 0;
        const total = value[6] || 0;
        return `${day.fullLabel}<br/>${built.x[value[0]]} · ${built.minutes}分钟<br/><b>${formatNumber(total)}</b> 条消息<br/>${props.selfName} ${sent} · ${props.partnerName} ${received}<br/><span style="color:#9d7e89">点击放大到当天</span>`;
      },
    },
    grid: { left: 72, right: 20, top: 14, bottom: 70 },
    xAxis: {
      type: 'category',
      data: built.x,
      axisLabel: {
        interval: (index) => index % xEvery === 0,
        fontSize: 10,
        color: '#826f77',
      },
      axisTick: { show: false },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: built.rows.map((x) => x.label),
      inverse: true,
      axisLabel: {
        interval: (index) => index % labelEvery === 0,
        fontSize: 9,
        color: '#826f77',
      },
      axisTick: { show: false },
      splitArea: { show: false },
    },
    visualMap,
    series: [{
      type: 'heatmap',
      data: built.data,
      progressive: 5000,
      itemStyle: {
        borderWidth: built.rows.length > 120 ? 0 : 0.35,
        borderColor: 'rgba(255,255,255,.58)',
      },
      emphasis: {
        itemStyle: {
          borderColor: '#572137',
          borderWidth: 1,
          shadowBlur: 8,
          shadowColor: 'rgba(84,35,55,.18)',
        },
      },
    }],
  }, true);

  chart.on('click', (params) => {
    const value = params.value;
    const item = {
      date: value[3],
      time: built.x[value[0]],
      sent: value[4] || 0,
      received: value[5] || 0,
      total: value[6] || 0,
    };
    selectedCell.value = item;
    emit('focus-date', item.date);
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
  if (!chart) return;
  const href = chart.getDataURL({ type: 'png', pixelRatio: 2.5, backgroundColor: '#fffdfd' });
  download(`wechat-global-heatmap-${rangeKey.value.replace(':', '-')}-${granularity.value}m.png`, href);
}

function exportCsv() {
  const rows = matrix.value.flatRows.filter((x) => x.total > 0);
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [
    ['date', 'time', props.selfName, props.partnerName, 'total'].map(escape).join(','),
    ...rows.map((row) => [row.date, row.time, row.sent, row.received, row.total].map(escape).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  download(`wechat-global-heatmap-${rangeKey.value.replace(':', '-')}.csv`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resize() {
  chart?.resize();
}

watch([rangeKey, granularity, displayMode, () => props.messages], async () => {
  selectedCell.value = null;
  await nextTick();
  render();
});

onMounted(async () => {
  await nextTick();
  render();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <section class="panel full-panel global-heatmap-panel">
    <div class="panel-heading global-heading">
      <div>
        <p class="section-kicker">GLOBAL DENSE HEATMAP · 全局总热图</p>
        <h2>把整段聊天压缩成一张“红点星图”</h2>
        <p class="global-copy">
          每一行是一整天，每一列是一天中的时间。默认看全部聊天记录，越密、越红，代表那段时间越活跃。
          点击任意红点，会直接跳到下面的日级时间显微镜。
        </p>
      </div>
      <div class="density-badge">密集总览</div>
    </div>

    <div class="global-controls no-print">
      <label>范围
        <select v-model="rangeKey">
          <option v-for="option in rangeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>

      <label>时间粒度
        <select v-model.number="granularity">
          <option :value="60">60分钟</option>
          <option :value="30">30分钟</option>
          <option :value="15">15分钟</option>
        </select>
      </label>

      <label>显示
        <select v-model="displayMode">
          <option value="total">总消息</option>
          <option value="self">{{ selfName }}</option>
          <option value="partner">{{ partnerName }}</option>
          <option value="balance">双方差值</option>
        </select>
      </label>

      <span class="control-spacer"></span>
      <button @click="exportPng">导出 PNG</button>
      <button @click="exportCsv">导出 CSV</button>
    </div>

    <div class="global-kpis">
      <div><span>当前范围</span><strong>{{ rangeLabel }}</strong><small>{{ modeLabel() }} · {{ granularity }}分钟</small></div>
      <div><span>消息总量</span><strong>{{ formatNumber(summary.total) }}</strong><small>{{ formatNumber(summary.activeDays) }} 个活跃日</small></div>
      <div><span>亮起的红点</span><strong>{{ formatNumber(summary.activeCells) }}</strong><small>密度 {{ (summary.density * 100).toFixed(1) }}%</small></div>
      <div><span>凌晨聊天</span><strong>{{ (summary.lateNightShare * 100).toFixed(1) }}%</strong><small>00:00–04:59</small></div>
    </div>

    <div ref="chartEl" class="global-dense-chart"></div>

    <div v-if="selectedCell" class="global-selected">
      <strong>你刚刚点到：</strong>
      <span>{{ selectedCell.date }} · {{ selectedCell.time }}</span>
      <span>{{ selfName }} {{ selectedCell.sent }}</span>
      <span>{{ partnerName }} {{ selectedCell.received }}</span>
      <b>共 {{ selectedCell.total }} 条</b>
    </div>

    <div class="burst-strip">
      <div class="burst-title">
        <p class="section-kicker">BURST WINDOWS</p>
        <h3>最密集的 5 个聊天瞬间</h3>
      </div>
      <div class="burst-list">
        <button
          v-for="(item, index) in summary.top"
          :key="item.date + item.time"
          class="burst-item"
          @click="emit('focus-date', item.date)"
        >
          <span>#{{ index + 1 }}</span>
          <div><strong>{{ item.date }} · {{ item.time }}</strong><small>{{ selfName }} {{ item.sent }} · {{ partnerName }} {{ item.received }}</small></div>
          <b>{{ item.total }}</b>
        </button>
      </div>
    </div>

    <p class="chart-note global-note">这张图用于看“整段关系的聊天节奏”。它只反映聊天活动密度，不对关系质量做评分。</p>
  </section>
</template>

<style scoped>
.global-heatmap-panel { overflow: hidden; }
.global-heading { align-items: flex-start; }
.global-heading > div:first-child { max-width: 900px; }
.global-copy { margin: 9px 0 0; color: #917b84; line-height: 1.75; font-size: 13px; }
.density-badge {
  flex: 0 0 auto;
  padding: 9px 13px;
  border-radius: 999px;
  background: linear-gradient(135deg, #fce8ee, #edf6fb);
  color: #9a3f61;
  font-size: 12px;
  font-weight: 800;
}
.global-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(90deg, #fff5f8, #f6fafc);
}
.global-controls label { color: #806b74; font-size: 12px; }
.global-controls select {
  margin-left: 6px;
  padding: 8px 10px;
  border: 1px solid #eadde2;
  border-radius: 10px;
  background: white;
  color: #5a4550;
}
.control-spacer { flex: 1; }
.global-controls button {
  padding: 9px 13px;
  border-radius: 11px;
  background: #fff;
  color: #9b3d61;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(78,44,57,.07);
}
.global-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 8px;
}
.global-kpis > div {
  min-height: 94px;
  padding: 14px 16px;
  border: 1px solid #f0e4e8;
  border-radius: 15px;
  background: rgba(255,255,255,.78);
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.global-kpis span { color: #8f7982; font-size: 12px; }
.global-kpis strong { margin: 4px 0 2px; color: #573744; font-size: 23px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.global-kpis small { color: #a18f96; }
.global-dense-chart { width: 100%; height: 690px; }
.global-selected {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 11px;
  margin-top: 5px;
  padding: 10px 13px;
  border-radius: 12px;
  background: #fff7fa;
  color: #76515f;
  font-size: 12px;
}
.global-selected strong,
.global-selected b { color: #983d5e; }
.burst-strip {
  margin-top: 14px;
  padding: 15px;
  border: 1px solid #f0e5e9;
  border-radius: 16px;
  background: rgba(255,255,255,.76);
}
.burst-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.burst-title h3 { margin: 0; color: #583744; font-size: 17px; }
.burst-list {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.burst-item {
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 7px;
  align-items: center;
  padding: 10px;
  border-radius: 12px;
  background: linear-gradient(145deg, #fff7fa, #f8fbfd);
  color: #65424f;
  cursor: pointer;
  text-align: left;
}
.burst-item > span { color: #ad456b; font-weight: 800; font-size: 11px; }
.burst-item div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.burst-item strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
.burst-item small { color: #9a8790; font-size: 10px; }
.burst-item b { color: #8f3157; font-size: 17px; }
.global-note { margin-top: 12px; }

@media (max-width: 1050px) {
  .burst-list { grid-template-columns: repeat(2, 1fr); }
  .global-kpis { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 720px) {
  .global-heading { flex-direction: column; }
  .global-controls { align-items: flex-start; }
  .control-spacer { display: none; }
  .global-dense-chart { height: 580px; }
  .burst-list { grid-template-columns: 1fr; }
}
@media print {
  .global-dense-chart { height: 610px !important; }
  .burst-list { grid-template-columns: repeat(2, 1fr); }
}
</style>
