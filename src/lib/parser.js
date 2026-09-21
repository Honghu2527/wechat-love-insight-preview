function findBalancedArray(source, startIndex) {
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }

  throw new Error('没有找到完整的 chatMessages 数组。');
}

function parseEmbeddedValue(html, variableName) {
  const patterns = [
    new RegExp(`const\\s+${variableName}\\s*=\\s*(["'][\\s\\S]*?["']|[^;\\n]+)`),
    new RegExp(`let\\s+${variableName}\\s*=\\s*(["'][\\s\\S]*?["']|[^;\\n]+)`),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const raw = match[1].trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return null;
}

export function parseWeChatHtml(html) {
  const marker = /const\s+chatMessages\s*=\s*\[/m;
  const match = marker.exec(html);
  if (!match) {
    throw new Error('没有识别到 WeChatMsg 导出的 chatMessages 数据。请确认上传的是聊天记录 HTML。');
  }

  const arrayStart = html.indexOf('[', match.index);
  const arrayText = findBalancedArray(html, arrayStart);

  let rawMessages;
  try {
    rawMessages = JSON.parse(arrayText);
  } catch (error) {
    throw new Error(`聊天记录数据存在，但解析失败：${error.message}`);
  }

  const messages = rawMessages
    .filter((item) => item && Number.isFinite(Number(item.timestamp)))
    .map((item, index) => {
      const ts = Number(item.timestamp);
      const millis = ts > 10_000_000_000 ? ts : ts * 1000;
      const date = new Date(millis);
      return {
        id: item.server_id || `${ts}-${index}`,
        type: String(item.type ?? ''),
        isSend: Boolean(item.is_send),
        timestamp: ts,
        date,
        displayName: String(item.display_name || '').trim(),
        avatar: item.avatar_src || '',
        text: typeof item.text === 'string' ? item.text : '',
        raw: item,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!messages.length) throw new Error('HTML 中没有找到可分析的消息。');

  return {
    messages,
    meta: {
      wxid: parseEmbeddedValue(html, 'wxid'),
      isChatroom: parseEmbeddedValue(html, 'isChatroom'),
      source: 'WeChatMsg HTML',
    },
  };
}

export function readHtmlFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取 HTML 文件失败。'));
    reader.readAsText(file, 'utf-8');
  });
}
