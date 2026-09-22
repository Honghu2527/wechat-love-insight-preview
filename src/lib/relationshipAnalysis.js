import { conversationInitiative, responseTimes, dayKey } from './analysis';

const WORD_SETS = {
  affection: ['爱你', '喜欢你', '想你', '宝宝', '宝贝', '老婆', '老公', '亲亲', '抱抱', '么么', '晚安', '早安', '乖', '可爱'],
  care: ['吃饭', '吃了吗', '到家', '到了吗', '注意安全', '早点睡', '别熬夜', '多喝水', '休息', '累不累', '难受', '身体', '记得', '小心'],
  repair: ['对不起', '抱歉', '错了', '别生气', '不生气', '原谅', '和好', '没关系', '理解你', '我懂', '别难过'],
  affirmation: ['辛苦了', '真棒', '厉害', '很好', '优秀', '支持你', '相信你', '为你开心', '谢谢你', '感谢'],
  planning: ['计划', '安排', '几点', '明天', '后天', '周末', '下周', '下个月', '以后', '到时候', '提前', '预约', '订票', '行程'],
  spontaneous: ['随便', '看情况', '再说', '临时', '突然', '现在就', '马上', '随机', '到时候再说', '顺其自然'],
  abstract: ['感觉', '意义', '未来', '如果', '假如', '可能', '想象', '为什么', '价值', '理想', '关系', '人生', '觉得', '本质'],
  concrete: ['几点', '在哪', '哪里', '吃饭', '上班', '下班', '回家', '睡觉', '到了', '出门', '买', '钱', '地址', '车', '地铁'],
  feeling: ['开心', '难过', '想你', '爱你', '喜欢', '生气', '委屈', '害怕', '担心', '心疼', '感动', '幸福', '不开心'],
  thinking: ['因为', '所以', '逻辑', '原因', '问题', '解决', '应该', '建议', '分析', '方案', '效率', '数据', '判断', '考虑'],
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const safeDiv = (a, b) => (b ? a / b : 0);

function countOccurrences(text, words) {
  if (!text) return 0;
  return words.reduce((sum, word) => {
    let count = 0;
    let from = 0;
    while (true) {
      const index = text.indexOf(word, from);
      if (index < 0) break;
      count += 1;
      from = index + word.length;
    }
    return sum + count;
  }, 0);
}

function countEmoji(text) {
  if (!text) return 0;
  return (text.match(/\p{Extended_Pictographic}/gu) || []).length;
}

function countPunctuation(text, regex) {
  if (!text) return 0;
  return (text.match(regex) || []).length;
}

function pairShare(a, b) {
  if (a <= 0 && b <= 0) return 0.5;
  return a / (a + b);
}

function axisPercent(leftEvidence, rightEvidence, base = 0.5) {
  const evidence = leftEvidence + rightEvidence;
  if (!evidence) return Math.round(base * 100);
  const raw = leftEvidence / evidence;
  // Pull extreme heuristic results toward the middle.
  const softened = 0.5 + (raw - 0.5) * 0.72;
  return Math.round(clamp(softened, 0.18, 0.82) * 100);
}

function participantMetrics(messages, isSend) {
  const rows = messages.filter((m) => m.isSend === isSend);
  const textRows = rows.filter((m) => m.type === '1' && m.text?.trim());
  const text = textRows.map((m) => m.text).join('\n');
  const chars = textRows.reduce((sum, m) => sum + [...m.text].length, 0);
  const longMessages = textRows.filter((m) => [...m.text].length >= 35).length;
  const questionMarks = countPunctuation(text, /[?？]/g);
  const exclamations = countPunctuation(text, /[!！]/g);
  const emoji = countEmoji(text);
  const activeDays = new Set(rows.map((m) => dayKey(m.date))).size;
  const lateNight = rows.filter((m) => m.date.getHours() < 5).length;
  const hourly = Array(24).fill(0);
  rows.forEach((m) => { hourly[m.date.getHours()] += 1; });
  const total = rows.length || 1;
  const entropyBase = hourly
    .filter(Boolean)
    .reduce((sum, count) => {
      const p = count / total;
      return sum - p * Math.log2(p);
    }, 0);
  const normalizedEntropy = hourly.filter(Boolean).length > 1
    ? entropyBase / Math.log2(hourly.filter(Boolean).length)
    : 0;

  const keywordCounts = Object.fromEntries(
    Object.entries(WORD_SETS).map(([key, words]) => [key, countOccurrences(text, words)]),
  );

  return {
    rows: rows.length,
    textRows: textRows.length,
    chars,
    avgChars: safeDiv(chars, textRows.length),
    longMessageShare: safeDiv(longMessages, textRows.length),
    questionMarks,
    exclamations,
    emoji,
    activeDays,
    lateNightShare: safeDiv(lateNight, rows.length),
    rhythmEntropy: normalizedEntropy,
    ...keywordCounts,
  };
}

function mbtiProfile(own, other, startsOwn, startsOther, replyOwn, replyOther) {
  const msgShare = pairShare(own.rows, other.rows);
  const startShare = pairShare(startsOwn, startsOther);
  const expressiveShare = pairShare(
    own.emoji + own.exclamations + own.questionMarks * 0.6,
    other.emoji + other.exclamations + other.questionMarks * 0.6,
  );

  const ePct = axisPercent(
    2.0 * startShare + 1.2 * msgShare + expressiveShare,
    2.0 * (1 - startShare) + 1.2 * (1 - msgShare) + (1 - expressiveShare),
    0.5,
  );

  const nPct = axisPercent(
    own.abstract + own.longMessageShare * Math.max(own.textRows, 1) * 0.35 + own.questionMarks * 0.25,
    own.concrete + Math.max(0, 1 - own.longMessageShare) * Math.max(own.textRows, 1) * 0.05,
    0.5,
  );

  const fPct = axisPercent(
    own.feeling + own.affection + own.care + own.repair + own.affirmation + own.emoji * 0.12,
    own.thinking + own.questionMarks * 0.18,
    0.5,
  );

  const replyOwnSpeed = Number.isFinite(replyOwn) ? 1 / Math.max(replyOwn, 30) : 0;
  const replyOtherSpeed = Number.isFinite(replyOther) ? 1 / Math.max(replyOther, 30) : 0;
  const responseShare = pairShare(replyOwnSpeed, replyOtherSpeed);
  const jPct = axisPercent(
    own.planning + (1 - own.rhythmEntropy) * Math.max(own.textRows, 1) * 0.08 + responseShare * 5,
    own.spontaneous + own.rhythmEntropy * Math.max(own.textRows, 1) * 0.06 + (1 - responseShare) * 5,
    0.5,
  );

  const axes = [
    { key: 'EI', left: 'E', right: 'I', leftPct: ePct, rightPct: 100 - ePct, label: '外向表达 / 内向蓄能' },
    { key: 'NS', left: 'N', right: 'S', leftPct: nPct, rightPct: 100 - nPct, label: '抽象联想 / 具体当下' },
    { key: 'TF', left: 'F', right: 'T', leftPct: fPct, rightPct: 100 - fPct, label: '情感回应 / 理性判断' },
    { key: 'JP', left: 'J', right: 'P', leftPct: jPct, rightPct: 100 - jPct, label: '计划秩序 / 灵活随性' },
  ];

  const type = axes.map((axis) => (axis.leftPct >= 50 ? axis.left : axis.right)).join('');
  const strength = axes.map((axis) => Math.abs(axis.leftPct - 50)).reduce((a, b) => a + b, 0) / axes.length;

  return { type, axes, strength: Math.round(strength) };
}

const TYPE_LABELS = {
  INTJ: '规划型思考者',
  INTP: '探索型分析者',
  ENTJ: '推进型组织者',
  ENTP: '点子型探索者',
  INFJ: '洞察型陪伴者',
  INFP: '理想型共情者',
  ENFJ: '热情型连接者',
  ENFP: '灵感型互动者',
  ISTJ: '稳健型执行者',
  ISFJ: '细致型照顾者',
  ESTJ: '秩序型推进者',
  ESFJ: '关系型照顾者',
  ISTP: '冷静型解决者',
  ISFP: '温柔型感受者',
  ESTP: '行动型互动者',
  ESFP: '活力型表达者',
};

function ratePerThousand(value, count) {
  return safeDiv(value * 1000, Math.max(count, 1));
}

function relationshipDimensions(self, partner, initiative, replies) {
  const selfReplySpeed = Number.isFinite(replies.sentMedianSeconds) ? 1 / Math.max(replies.sentMedianSeconds, 30) : 0;
  const partnerReplySpeed = Number.isFinite(replies.receivedMedianSeconds) ? 1 / Math.max(replies.receivedMedianSeconds, 30) : 0;

  const raw = [
    {
      key: 'initiative',
      label: '主动开启',
      selfValue: initiative.sentStarts,
      partnerValue: initiative.receivedStarts,
      hint: '谁更常在沉默后先发出第一条消息',
    },
    {
      key: 'response',
      label: '及时回应',
      selfValue: selfReplySpeed,
      partnerValue: partnerReplySpeed,
      hint: '基于双方中位回复速度的相对表现',
    },
    {
      key: 'affection',
      label: '爱意表达',
      selfValue: ratePerThousand(self.affection + self.affirmation, self.textRows),
      partnerValue: ratePerThousand(partner.affection + partner.affirmation, partner.textRows),
      hint: '爱称、想念、肯定、夸赞等表达频率',
    },
    {
      key: 'care',
      label: '关心照顾',
      selfValue: ratePerThousand(self.care, self.textRows),
      partnerValue: ratePerThousand(partner.care, partner.textRows),
      hint: '吃饭、到家、安全、休息、身体等关心',
    },
    {
      key: 'repair',
      label: '修复关系',
      selfValue: ratePerThousand(self.repair, self.textRows),
      partnerValue: ratePerThousand(partner.repair, partner.textRows),
      hint: '道歉、安慰、理解、和好等维护性表达',
    },
    {
      key: 'depth',
      label: '表达投入',
      selfValue: self.avgChars + self.longMessageShare * 30,
      partnerValue: partner.avgChars + partner.longMessageShare * 30,
      hint: '平均文本长度与长消息占比',
    },
  ];

  return raw.map((item) => {
    const selfShare = pairShare(item.selfValue, item.partnerValue);
    return {
      ...item,
      selfPct: Math.round(selfShare * 100),
      partnerPct: 100 - Math.round(selfShare * 100),
    };
  });
}

function topLoveLanguages(metrics) {
  const items = [
    { label: '言语肯定', value: metrics.affirmation + metrics.affection, note: '爱称、夸赞、想念与肯定' },
    { label: '生活照顾', value: metrics.care, note: '吃饭、休息、安全、身体状态' },
    { label: '修复沟通', value: metrics.repair, note: '道歉、理解、安慰与和好' },
    { label: '共同计划', value: metrics.planning, note: '安排时间、未来与行程' },
    { label: '陪伴互动', value: metrics.rows * 0.015 + metrics.lateNightShare * 20, note: '持续互动与深夜陪伴' },
  ];

  return items.sort((a, b) => b.value - a.value).slice(0, 3);
}

function compatibilityNotes(a, b) {
  const notes = [];

  a.axes.forEach((axis, index) => {
    const otherAxis = b.axes[index];
    const aLetter = axis.leftPct >= 50 ? axis.left : axis.right;
    const bLetter = otherAxis.leftPct >= 50 ? otherAxis.left : otherAxis.right;

    if (axis.key === 'EI') {
      notes.push(aLetter === bLetter
        ? '聊天节奏偏相似：双方在互动频率和主动表达上更容易同步。'
        : '互动节奏互补：一方更容易先抛出话题，另一方更偏向在已有话题里深入回应。');
    }
    if (axis.key === 'TF') {
      notes.push(aLetter === bLetter
        ? '回应方式比较接近：双方在“讲感受还是讲解决方案”上不容易完全错频。'
        : '回应方式有差异：一方更重感受，一方更重问题解决，冲突时适合先确认对方需要的是安慰还是方案。');
    }
  });

  return notes.slice(0, 2);
}

export function analyzeRelationshipPersonality(messages) {
  const self = participantMetrics(messages, true);
  const partner = participantMetrics(messages, false);
  const initiative = conversationInitiative(messages, 4);
  const replies = responseTimes(messages, 12);

  const selfMbti = mbtiProfile(
    self,
    partner,
    initiative.sentStarts,
    initiative.receivedStarts,
    replies.sentMedianSeconds,
    replies.receivedMedianSeconds,
  );
  const partnerMbti = mbtiProfile(
    partner,
    self,
    initiative.receivedStarts,
    initiative.sentStarts,
    replies.receivedMedianSeconds,
    replies.sentMedianSeconds,
  );

  selfMbti.label = TYPE_LABELS[selfMbti.type] || '关系情境型人格';
  partnerMbti.label = TYPE_LABELS[partnerMbti.type] || '关系情境型人格';

  const dimensions = relationshipDimensions(self, partner, initiative, replies);
  const selfExpression = Math.round(dimensions.reduce((sum, item) => sum + item.selfPct, 0) / dimensions.length);
  const partnerExpression = 100 - selfExpression;

  let expressionSummary = '双方在聊天中的投入表达比较接近。';
  if (Math.abs(selfExpression - partnerExpression) >= 8) {
    expressionSummary = selfExpression > partnerExpression
      ? '从聊天行为看，你更常通过“主动、回应、关心或文字投入”来表达关系投入。'
      : '从聊天行为看，TA更常通过“主动、回应、关心或文字投入”来表达关系投入。';
  }

  const topSelf = topLoveLanguages(self);
  const topPartner = topLoveLanguages(partner);

  return {
    self: { metrics: self, mbti: selfMbti, loveLanguages: topSelf },
    partner: { metrics: partner, mbti: partnerMbti, loveLanguages: topPartner },
    relationship: {
      dimensions,
      selfExpression,
      partnerExpression,
      expressionSummary,
      compatibilityNotes: compatibilityNotes(selfMbti, partnerMbti),
      initiative,
      replies,
    },
  };
}
