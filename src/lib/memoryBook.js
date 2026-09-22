const HOUR = 60 * 60 * 1000;

function isUsefulText(message) {
  const text = String(message?.text || '').trim();
  if (!text || text.length < 2) return false;
  if (/^\[(图片|视频|语音|表情|文件|位置|通话|系统消息).*\]$/i.test(text)) return false;
  if (/^(撤回了一条消息|以上是打招呼的内容)$/i.test(text)) return false;
  return true;
}

function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatMemoryDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '未知日期';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

export function clusterPhotosByTime(photos, gapHours = 6) {
  const sorted = [...photos]
    .filter((photo) => photo?.takenAt instanceof Date && !Number.isNaN(photo.takenAt.getTime()))
    .sort((a, b) => a.takenAt - b.takenAt);

  const events = [];
  for (const photo of sorted) {
    const last = events.at(-1);
    if (!last) {
      events.push({ photos: [photo], start: photo.takenAt, end: photo.takenAt });
      continue;
    }

    const gap = photo.takenAt - last.end;
    const sameDay = localDayKey(photo.takenAt) === localDayKey(last.end);
    if (gap <= gapHours * HOUR && sameDay) {
      last.photos.push(photo);
      last.end = photo.takenAt;
    } else {
      events.push({ photos: [photo], start: photo.takenAt, end: photo.takenAt });
    }
  }
  return events;
}

function keywordTitle(text) {
  const rules = [
    [/生日|birthday/i, '生日这一天'],
    [/迪士尼|游乐园|乐园/i, '一起去玩的这一天'],
    [/机场|飞机|高铁|火车|出发|酒店|旅行|旅游|旅途/i, '一起在路上'],
    [/海边|大海|沙滩|海滩/i, '一起去看海'],
    [/雪|下雪|雪景/i, '一起看雪'],
    [/火锅|餐厅|吃饭|晚饭|午饭|早餐|好吃/i, '一起吃饭'],
    [/电影|影院|看电影/i, '一起看电影'],
    [/想你|想念/i, '把想念留在这一天'],
    [/爱你|喜欢你/i, '把喜欢写进这一天'],
    [/晚安/i, '舍不得结束的一天'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || '';
}

function scoreMessage(message, midpoint) {
  const text = String(message.text || '').trim();
  const distanceHours = Math.abs(message.date - midpoint) / HOUR;
  let score = Math.max(0, 40 - distanceHours * 4);
  score += Math.min(text.length, 80) * 0.18;
  if (/[！!？?～~❤♥🥰😘💕💗💖哈哈哈]/.test(text)) score += 5;
  if (/生日|第一次|纪念|爱你|喜欢|想你|开心|好看|好吃|到了|出发|一起|晚安|早安/.test(text)) score += 8;
  if (text.length > 160) score -= 8;
  return score;
}

function pickMessages(messages, event, limit = 5) {
  const midpoint = new Date((event.start.getTime() + event.end.getTime()) / 2);
  const windows = [3, 8, 24];
  let candidates = [];

  for (const hours of windows) {
    const start = event.start.getTime() - hours * HOUR;
    const end = event.end.getTime() + hours * HOUR;
    candidates = messages.filter((message) => (
      isUsefulText(message)
      && message.date instanceof Date
      && message.date.getTime() >= start
      && message.date.getTime() <= end
    ));
    if (candidates.length >= 2) break;
  }

  if (!candidates.length) {
    const key = localDayKey(event.start);
    candidates = messages.filter((message) => isUsefulText(message) && localDayKey(message.date) === key);
  }

  return candidates
    .map((message) => ({ message, score: scoreMessage(message, midpoint) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.message)
    .sort((a, b) => a.date - b.date);
}

function gpsLabel(photos) {
  const photo = photos.find((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  if (!photo) return '';
  return `${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)}`;
}

function eventTitle(event, pickedMessages, index) {
  const text = pickedMessages.map((message) => message.text).join(' ');
  const themed = keywordTitle(text);
  if (themed) return themed;
  const month = event.start.getMonth() + 1;
  const day = event.start.getDate();
  return `${month}月${day}日 · 我们的第 ${index + 1} 个回忆片段`;
}

export function buildMemoryPages({ photos, messages, maxPages = 20 }) {
  const events = clusterPhotosByTime(photos)
    .sort((a, b) => a.start - b.start)
    .slice(0, Math.max(1, maxPages));

  return events.map((event, index) => {
    const pickedMessages = pickMessages(messages, event);
    const photosForPage = event.photos.slice(0, 4);
    return {
      id: `memory-${event.start.getTime()}-${index}`,
      title: eventTitle(event, pickedMessages, index),
      dateLabel: formatMemoryDate(event.start),
      start: event.start,
      end: event.end,
      photos: photosForPage,
      extraPhotoCount: Math.max(0, event.photos.length - photosForPage.length),
      messages: pickedMessages,
      gps: gpsLabel(event.photos),
      matchLabel: pickedMessages.length ? '按拍摄时间自动匹配聊天' : '暂未匹配到附近文字聊天',
    };
  });
}
