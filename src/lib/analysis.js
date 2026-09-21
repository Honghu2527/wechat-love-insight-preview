const pad = (n) => String(n).padStart(2, '0');

export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = (sortedValues.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (index - lo);
}

export function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  return percentile(valid, 0.5);
}

function isMeaningfulMessage(message) {
  return message.displayName || message.type !== '10000';
}

export function inferParticipants(messages) {
  const map = new Map();
  for (const message of messages) {
    if (!message.displayName) continue;
    const current = map.get(message.displayName) || {
      name: message.displayName,
      count: 0,
      sent: 0,
      received: 0,
      avatar: message.avatar,
    };
    current.count += 1;
    if (message.isSend) current.sent += 1;
    else current.received += 1;
    if (!current.avatar && message.avatar) current.avatar = message.avatar;
    map.set(message.displayName, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 2);
}

export function buildOverview(messages) {
  const valid = messages.filter(isMeaningfulMessage);
  const textMessages = valid.filter((m) => m.type === '1' && m.text.trim());
  const participants = inferParticipants(valid);
  const first = valid[0];
  const last = valid[valid.length - 1];
  const daily = dailyCounts(valid);
  const activeDays = daily.length;
  const totalChars = textMessages.reduce((sum, m) => sum + [...m.text].length, 0);
  const sent = valid.filter((m) => m.isSend).length;
  const received = valid.length - sent;
  const busiest = daily.reduce((best, row) => (!best || row.value > best.value ? row : best), null);
  const streak = longestActiveStreak(daily.map((d) => d.date));

  return {
    total: valid.length,
    textMessages: textMessages.length,
    totalChars,
    sent,
    received,
    activeDays,
    participants,
    firstDate: first?.date || null,
    lastDate: last?.date || null,
    busiest,
    longestStreak: streak,
  };
}

export function dailyCounts(messages, filter = () => true) {
  const map = new Map();
  messages.filter(filter).forEach((message) => {
    const key = dayKey(message.date);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function monthlyCounts(messages) {
  const map = new Map();
  messages.forEach((message) => {
    const key = monthKey(message.date);
    const row = map.get(key) || { month: key, total: 0, sent: 0, received: 0, activeDays: new Set() };
    row.total += 1;
    if (message.isSend) row.sent += 1;
    else row.received += 1;
    row.activeDays.add(dayKey(message.date));
    map.set(key, row);
  });
  return [...map.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({ ...row, activeDays: row.activeDays.size }));
}

export function hourlyCounts(messages) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, sent: 0, received: 0 }));
  messages.forEach((message) => {
    const bucket = buckets[message.date.getHours()];
    bucket.total += 1;
    if (message.isSend) bucket.sent += 1;
    else bucket.received += 1;
  });
  return buckets;
}

export function longestActiveStreak(dateKeys) {
  const unique = [...new Set(dateKeys)].sort();
  if (!unique.length) return 0;
  let best = 1;
  let current = 1;
  for (let i = 1; i < unique.length; i += 1) {
    const prev = new Date(`${unique[i - 1]}T00:00:00`);
    const next = new Date(`${unique[i]}T00:00:00`);
    const diff = Math.round((next - prev) / 86_400_000);
    if (diff === 1) {
      current += 1;
      best = Math.max(best, current);
    } else if (diff > 1) {
      current = 1;
    }
  }
  return best;
}

export function conversationInitiative(messages, gapHours = 4) {
  const gapSeconds = gapHours * 3600;
  let sentStarts = 0;
  let receivedStarts = 0;
  const starts = [];

  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    if (!previous || message.timestamp - previous.timestamp >= gapSeconds) {
      if (message.isSend) sentStarts += 1;
      else receivedStarts += 1;
      starts.push(message);
    }
  });

  const total = sentStarts + receivedStarts;
  return {
    gapHours,
    sentStarts,
    receivedStarts,
    total,
    sentShare: total ? sentStarts / total : 0,
    receivedShare: total ? receivedStarts / total : 0,
    starts,
  };
}

export function responseTimes(messages, maxHours = 12) {
  const maxSeconds = maxHours * 3600;
  const sentResponses = [];
  const receivedResponses = [];

  for (let i = 1; i < messages.length; i += 1) {
    const current = messages[i];
    const previous = messages[i - 1];
    if (current.isSend === previous.isSend) continue;
    const delta = current.timestamp - previous.timestamp;
    if (delta < 0 || delta > maxSeconds) continue;
    if (current.isSend) sentResponses.push(delta);
    else receivedResponses.push(delta);
  }

  return {
    sentMedianSeconds: median(sentResponses),
    receivedMedianSeconds: median(receivedResponses),
    sentSamples: sentResponses.length,
    receivedSamples: receivedResponses.length,
  };
}

const STOP_WORDS = new Set([
  '的', '了', '呢', '啊', '呀', '吧', '吗', '嘛', '哦', '嗯', '嗯嗯', '哈哈', '哈哈哈', '哈哈哈哈',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '这个', '那个', '就是', '然后', '但是', '因为',
  '所以', '可以', '不是', '没有', '一个', '什么', '怎么', '还是', '已经', '现在', '今天', '明天', '真的',
  '感觉', '一下', '这样', '那就', '好的', '好', '也', '都', '就', '还', '很', '再', '又', '要', '想',
]);

function tokenizeText(text) {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[\p{P}\p{S}\d_]+/gu, ' ')
    .trim();

  if (!cleaned) return [];

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    return [...segmenter.segment(cleaned)]
      .filter((item) => item.isWordLike)
      .map((item) => item.segment.trim());
  }

  return cleaned.split(/\s+/).flatMap((chunk) => {
    if (/^[\u4e00-\u9fff]+$/.test(chunk) && chunk.length > 2) {
      return Array.from({ length: chunk.length - 1 }, (_, i) => chunk.slice(i, i + 2));
    }
    return [chunk];
  });
}

export function wordFrequency(messages, options = {}) {
  const { isSend = null, limit = 80, minLength = 2 } = options;
  const counts = new Map();

  messages
    .filter((m) => m.type === '1' && m.text)
    .filter((m) => isSend === null || m.isSend === isSend)
    .forEach((message) => {
      tokenizeText(message.text).forEach((token) => {
        const word = token.trim();
        if (!word || word.length < minLength || STOP_WORDS.has(word)) return;
        counts.set(word, (counts.get(word) || 0) + 1);
      });
    });

  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function distinctiveWords(messages, limit = 25) {
  const sent = new Map(wordFrequency(messages, { isSend: true, limit: 500 }).map((x) => [x.name, x.value]));
  const received = new Map(wordFrequency(messages, { isSend: false, limit: 500 }).map((x) => [x.name, x.value]));
  const words = new Set([...sent.keys(), ...received.keys()]);
  const rows = [];

  words.forEach((word) => {
    const a = sent.get(word) || 0;
    const b = received.get(word) || 0;
    const total = a + b;
    if (total < 3) return;
    rows.push({
      word,
      sent: a,
      received: b,
      score: (a - b) / total,
      total,
    });
  });

  return {
    sent: rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, limit),
    received: rows.filter((r) => r.score < 0).sort((a, b) => a.score - b.score || b.total - a.total).slice(0, limit),
  };
}

export function romanticKeywordSeries(messages, keywords = ['宝宝', '老婆', '老公', '爱你', '想你', '晚安', '早安', '抱抱', '亲亲', '对不起']) {
  const months = monthlyCounts(messages).map((m) => m.month);
  const series = Object.fromEntries(keywords.map((k) => [k, Object.fromEntries(months.map((m) => [m, 0]))]));

  messages.filter((m) => m.type === '1' && m.text).forEach((message) => {
    const month = monthKey(message.date);
    keywords.forEach((keyword) => {
      const matches = message.text.split(keyword).length - 1;
      if (matches > 0 && series[keyword]?.[month] !== undefined) series[keyword][month] += matches;
    });
  });

  return { months, series };
}
