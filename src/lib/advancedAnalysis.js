import { dailyCounts, median, monthlyCounts } from './analysis';

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const LOVE_KEYWORDS = ['宝宝', '老婆', '老公', '爱你', '想你', '晚安', '早安', '抱抱', '亲亲', '对不起'];

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

export function weekdayHourMatrix(messages) {
  const buckets = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({ weekday, hour, total: 0, sent: 0, received: 0 })),
  );

  messages.forEach((message) => {
    const weekday = weekdayIndex(message.date);
    const hour = message.date.getHours();
    const bucket = buckets[weekday][hour];
    bucket.total += 1;
    if (message.isSend) bucket.sent += 1;
    else bucket.received += 1;
  });

  return {
    weekdays: WEEKDAYS,
    rows: buckets.flat(),
  };
}

export function reportHighlights(messages) {
  if (!messages.length) return null;

  const hourly = Array.from({ length: 24 }, () => 0);
  const weekdays = Array.from({ length: 7 }, () => 0);
  let lateNight = 0;
  let weekend = 0;

  messages.forEach((message) => {
    const hour = message.date.getHours();
    const weekday = weekdayIndex(message.date);
    hourly[hour] += 1;
    weekdays[weekday] += 1;
    if (hour < 5) lateNight += 1;
    if (weekday >= 5) weekend += 1;
  });

  const peakHour = hourly.indexOf(Math.max(...hourly));
  const peakWeekdayIndex = weekdays.indexOf(Math.max(...weekdays));
  const months = monthlyCounts(messages);
  const busiestMonth = months.reduce((best, row) => (!best || row.total > best.total ? row : best), null);
  const activeDays = dailyCounts(messages).length;

  let longestSilenceSeconds = null;
  let longestSilenceStart = null;
  let longestSilenceEnd = null;
  for (let i = 1; i < messages.length; i += 1) {
    const delta = messages[i].timestamp - messages[i - 1].timestamp;
    if (delta >= 0 && (longestSilenceSeconds === null || delta > longestSilenceSeconds)) {
      longestSilenceSeconds = delta;
      longestSilenceStart = messages[i - 1].date;
      longestSilenceEnd = messages[i].date;
    }
  }

  const balancedCandidates = months.filter((row) => row.total >= 20 && row.sent > 0 && row.received > 0);
  const mostBalancedMonth = balancedCandidates
    .map((row) => ({ ...row, balanceGap: Math.abs(row.sent - row.received) / row.total }))
    .sort((a, b) => a.balanceGap - b.balanceGap || b.total - a.total)[0] || null;

  return {
    peakHour,
    peakWeekday: WEEKDAYS[peakWeekdayIndex],
    busiestMonth,
    activeDays,
    averagePerActiveDay: activeDays ? messages.length / activeDays : 0,
    lateNightCount: lateNight,
    lateNightShare: messages.length ? lateNight / messages.length : 0,
    weekendCount: weekend,
    weekendShare: messages.length ? weekend / messages.length : 0,
    longestSilenceSeconds,
    longestSilenceStart,
    longestSilenceEnd,
    mostBalancedMonth,
  };
}

export function topActiveDays(messages, limit = 10) {
  return dailyCounts(messages)
    .sort((a, b) => b.value - a.value || a.date.localeCompare(b.date))
    .slice(0, limit);
}

export function responseSpeedBuckets(messages, maxHours = 12) {
  const labels = ['<1分钟', '1–5分钟', '5–30分钟', '30–60分钟', '1–12小时'];
  const sent = Array(labels.length).fill(0);
  const received = Array(labels.length).fill(0);
  const maxSeconds = maxHours * 3600;

  function bucketIndex(seconds) {
    if (seconds < 60) return 0;
    if (seconds < 300) return 1;
    if (seconds < 1800) return 2;
    if (seconds < 3600) return 3;
    return 4;
  }

  for (let i = 1; i < messages.length; i += 1) {
    const current = messages[i];
    const previous = messages[i - 1];
    if (current.isSend === previous.isSend) continue;
    const delta = current.timestamp - previous.timestamp;
    if (delta < 0 || delta > maxSeconds) continue;
    const target = current.isSend ? sent : received;
    target[bucketIndex(delta)] += 1;
  }

  return {
    labels,
    sent,
    received,
    sentTotal: sent.reduce((a, b) => a + b, 0),
    receivedTotal: received.reduce((a, b) => a + b, 0),
  };
}

export function sessionStats(messages, gapHours = 4) {
  if (!messages.length) {
    return {
      gapHours,
      sessions: [],
      sessionCount: 0,
      medianMessages: 0,
      medianDurationSeconds: 0,
      topByMessages: null,
      topByDuration: null,
    };
  }

  const gapSeconds = gapHours * 3600;
  const groups = [];
  let current = [messages[0]];

  for (let i = 1; i < messages.length; i += 1) {
    const message = messages[i];
    const previous = messages[i - 1];
    if (message.timestamp - previous.timestamp >= gapSeconds) {
      groups.push(current);
      current = [message];
    } else {
      current.push(message);
    }
  }
  groups.push(current);

  const sessions = groups.map((group, index) => {
    const first = group[0];
    const last = group[group.length - 1];
    const sent = group.filter((m) => m.isSend).length;
    return {
      index: index + 1,
      start: first.date,
      end: last.date,
      date: formatDateKey(first.date),
      total: group.length,
      sent,
      received: group.length - sent,
      durationSeconds: Math.max(0, last.timestamp - first.timestamp),
    };
  });

  const topByMessages = [...sessions].sort((a, b) => b.total - a.total || b.durationSeconds - a.durationSeconds)[0] || null;
  const topByDuration = [...sessions].sort((a, b) => b.durationSeconds - a.durationSeconds || b.total - a.total)[0] || null;

  return {
    gapHours,
    sessions,
    sessionCount: sessions.length,
    medianMessages: median(sessions.map((s) => s.total)) || 0,
    medianDurationSeconds: median(sessions.map((s) => s.durationSeconds)) || 0,
    topByMessages,
    topByDuration,
  };
}

export function sessionSizeDistribution(sessions) {
  const rows = [
    { label: '1–5条', min: 1, max: 5, value: 0 },
    { label: '6–20条', min: 6, max: 20, value: 0 },
    { label: '21–50条', min: 21, max: 50, value: 0 },
    { label: '51–100条', min: 51, max: 100, value: 0 },
    { label: '100+条', min: 101, max: Infinity, value: 0 },
  ];

  sessions.forEach((session) => {
    const row = rows.find((item) => session.total >= item.min && session.total <= item.max);
    if (row) row.value += 1;
  });

  return rows;
}

export function romanticKeywordSplit(messages, keywords = LOVE_KEYWORDS) {
  const map = new Map(keywords.map((keyword) => [keyword, { keyword, sent: 0, received: 0, total: 0 }]));

  messages
    .filter((m) => m.type === '1' && m.text)
    .forEach((message) => {
      keywords.forEach((keyword) => {
        const matches = message.text.split(keyword).length - 1;
        if (matches <= 0) return;
        const row = map.get(keyword);
        row.total += matches;
        if (message.isSend) row.sent += matches;
        else row.received += matches;
      });
    });

  return [...map.values()].filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
}

export function keywordFirstSeen(messages, keywords = LOVE_KEYWORDS) {
  const found = [];

  keywords.forEach((keyword) => {
    const message = messages.find((m) => m.type === '1' && m.text && m.text.includes(keyword));
    if (!message) return;
    found.push({
      keyword,
      date: message.date,
      isSend: message.isSend,
      timestamp: message.timestamp,
    });
  });

  return found.sort((a, b) => a.timestamp - b.timestamp);
}

export function messageTypeComposition(messages) {
  let text = 0;
  let other = 0;

  messages.forEach((message) => {
    if (message.type === '10000' && !message.displayName) return;
    if (message.type === '1' && message.text?.trim()) text += 1;
    else other += 1;
  });

  return [
    { name: '文字消息', value: text },
    { name: '其他消息', value: other },
  ];
}
