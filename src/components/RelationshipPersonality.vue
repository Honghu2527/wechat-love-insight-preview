<script setup>
import { computed } from 'vue';
import { analyzeRelationshipPersonality } from '../lib/relationshipAnalysis';

const props = defineProps({
  messages: { type: Array, required: true },
  selfName: { type: String, default: '我' },
  partnerName: { type: String, default: 'TA' },
});

const analysis = computed(() => analyzeRelationshipPersonality(props.messages));

function axisLeader(axis) {
  return axis.leftPct >= axis.rightPct ? axis.left : axis.right;
}

function axisLeaderPct(axis) {
  return Math.max(axis.leftPct, axis.rightPct);
}

function dimensionWinner(item) {
  const diff = Math.abs(item.selfPct - item.partnerPct);
  if (diff < 8) return '接近';
  return item.selfPct > item.partnerPct ? props.selfName : props.partnerName;
}

function expressionLead() {
  const diff = Math.abs(analysis.value.relationship.selfExpression - analysis.value.relationship.partnerExpression);
  if (diff < 8) return '双方接近';
  return analysis.value.relationship.selfExpression > analysis.value.relationship.partnerExpression
    ? props.selfName
    : props.partnerName;
}
</script>

<template>
  <section class="relationship-report">
    <div class="report-intro">
      <div>
        <p class="section-kicker">RELATIONSHIP PERSONALITY · 关系人格</p>
        <h2>聊天里的 MBTI 与关系表达画像</h2>
        <p>
          这里不是正式 MBTI 测试，也不能证明谁“更爱谁”。它只根据这段聊天里出现的主动程度、表达方式、
          情绪词、计划词、回复节奏等行为信号，生成一个“关系情境下的 MBTI 倾向”和关系投入画像。
        </p>
      </div>
      <span class="play-badge">本地分析 · 仅供参考</span>
    </div>

    <section class="personality-grid">
      <article class="panel personality-card warm-card">
        <div class="personality-head">
          <div>
            <span class="person-label">{{ selfName }}</span>
            <h3>{{ analysis.self.mbti.type }}</h3>
            <p>{{ analysis.self.mbti.label }}</p>
          </div>
          <div class="type-bubble">{{ analysis.self.mbti.type }}</div>
        </div>

        <div class="axis-list">
          <div v-for="axis in analysis.self.mbti.axes" :key="'self-' + axis.key" class="axis-item">
            <div class="axis-labels">
              <span>{{ axis.left }} {{ axis.leftPct }}%</span>
              <small>{{ axis.label }}</small>
              <span>{{ axis.rightPct }}% {{ axis.right }}</span>
            </div>
            <div class="axis-track">
              <div class="axis-fill warm-fill" :style="{ width: axis.leftPct + '%' }"></div>
            </div>
            <div class="axis-summary">更偏 {{ axisLeader(axis) }} · 倾向强度 {{ axisLeaderPct(axis) - 50 }}%</div>
          </div>
        </div>

        <div class="language-block">
          <p class="section-kicker">CHAT LOVE LANGUAGE</p>
          <h4>聊天里更常用的关系表达</h4>
          <div class="language-tags">
            <span v-for="item in analysis.self.loveLanguages" :key="item.label">
              <strong>{{ item.label }}</strong>
              <small>{{ item.note }}</small>
            </span>
          </div>
        </div>
      </article>

      <article class="panel personality-card cool-card">
        <div class="personality-head">
          <div>
            <span class="person-label">{{ partnerName }}</span>
            <h3>{{ analysis.partner.mbti.type }}</h3>
            <p>{{ analysis.partner.mbti.label }}</p>
          </div>
          <div class="type-bubble cool-bubble">{{ analysis.partner.mbti.type }}</div>
        </div>

        <div class="axis-list">
          <div v-for="axis in analysis.partner.mbti.axes" :key="'partner-' + axis.key" class="axis-item">
            <div class="axis-labels">
              <span>{{ axis.left }} {{ axis.leftPct }}%</span>
              <small>{{ axis.label }}</small>
              <span>{{ axis.rightPct }}% {{ axis.right }}</span>
            </div>
            <div class="axis-track">
              <div class="axis-fill cool-fill" :style="{ width: axis.leftPct + '%' }"></div>
            </div>
            <div class="axis-summary">更偏 {{ axisLeader(axis) }} · 倾向强度 {{ axisLeaderPct(axis) - 50 }}%</div>
          </div>
        </div>

        <div class="language-block">
          <p class="section-kicker">CHAT LOVE LANGUAGE</p>
          <h4>聊天里更常用的关系表达</h4>
          <div class="language-tags">
            <span v-for="item in analysis.partner.loveLanguages" :key="item.label">
              <strong>{{ item.label }}</strong>
              <small>{{ item.note }}</small>
            </span>
          </div>
        </div>
      </article>
    </section>

    <section class="panel relationship-investment">
      <div class="investment-heading">
        <div>
          <p class="section-kicker">RELATIONSHIP INVESTMENT · 关系投入</p>
          <h3>谁更常“把爱表达出来”</h3>
          <p>
            这里比较的是聊天中的可观察行为，不等于真实感情多少。更适合理解为：
            谁更常主动、及时回应、关心、修复关系，以及投入更多文字表达。
          </p>
        </div>
        <div class="expression-score">
          <span>{{ expressionLead() }}</span>
          <strong>{{ analysis.relationship.selfExpression }} / {{ analysis.relationship.partnerExpression }}</strong>
          <small>{{ selfName }} / {{ partnerName }}</small>
        </div>
      </div>

      <div class="expression-summary">
        {{ analysis.relationship.expressionSummary }}
      </div>

      <div class="dimension-list">
        <div v-for="item in analysis.relationship.dimensions" :key="item.key" class="dimension-row">
          <div class="dimension-title">
            <strong>{{ item.label }}</strong>
            <small>{{ item.hint }}</small>
          </div>

          <div class="duel-bar">
            <div class="duel-side self-side" :style="{ width: item.selfPct + '%' }">
              <span v-if="item.selfPct >= 18">{{ selfName }} {{ item.selfPct }}%</span>
            </div>
            <div class="duel-side partner-side" :style="{ width: item.partnerPct + '%' }">
              <span v-if="item.partnerPct >= 18">{{ partnerName }} {{ item.partnerPct }}%</span>
            </div>
          </div>

          <b class="dimension-winner">{{ dimensionWinner(item) }}</b>
        </div>
      </div>
    </section>

    <section class="two-column relationship-notes">
      <article class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">PAIR DYNAMICS</p>
            <h2>你们在聊天里的配合方式</h2>
          </div>
        </div>

        <div class="note-list">
          <div v-for="(note, index) in analysis.relationship.compatibilityNotes" :key="index" class="note-item">
            <span>{{ index + 1 }}</span>
            <p>{{ note }}</p>
          </div>
        </div>
      </article>

      <article class="panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">HOW TO READ IT</p>
            <h2>这份 MBTI 怎么看</h2>
          </div>
        </div>

        <div class="reading-box">
          <p><strong>它代表的是：</strong>这段关系聊天中的沟通风格。</p>
          <p><strong>它不代表：</strong>正式人格测评、心理诊断，或完整现实人格。</p>
          <p><strong>更适合：</strong>做情侣报告、年度总结和互动风格对比。</p>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.relationship-report { margin-top: 22px; }
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
.report-intro p:not(.section-kicker) { max-width: 880px; margin: 10px 0 0; color: #806b74; line-height: 1.8; }
.play-badge {
  flex: 0 0 auto;
  padding: 9px 13px;
  border-radius: 999px;
  background: #f7f1f4;
  color: #8f4661;
  font-size: 12px;
  font-weight: 700;
}
.personality-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-bottom: 18px;
}
.personality-card {
  padding: 22px;
  border-radius: 24px;
}
.warm-card { background: linear-gradient(155deg, rgba(255,255,255,.96), rgba(255,242,247,.92)); }
.cool-card { background: linear-gradient(155deg, rgba(255,255,255,.96), rgba(242,249,253,.95)); }
.personality-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}
.personality-head h3 {
  margin: 3px 0 2px;
  font-size: 42px;
  letter-spacing: .06em;
  color: #573442;
}
.personality-head p { margin: 0; color: #8a747d; }
.person-label { color: #a74a6d; font-size: 12px; font-weight: 800; }
.type-bubble {
  width: 86px;
  height: 86px;
  display: grid;
  place-items: center;
  border-radius: 26px;
  background: linear-gradient(145deg, #e67799, #9b345a);
  color: white;
  font-size: 20px;
  font-weight: 800;
  box-shadow: 0 16px 38px rgba(159,58,92,.18);
}
.cool-bubble {
  background: linear-gradient(145deg, #7fb0cd, #557e99);
  box-shadow: 0 16px 38px rgba(79,124,153,.18);
}
.axis-list { display: grid; gap: 15px; }
.axis-item { display: grid; gap: 6px; }
.axis-labels {
  display: grid;
  grid-template-columns: 76px 1fr 76px;
  align-items: center;
  gap: 8px;
  color: #70545f;
  font-size: 12px;
  font-weight: 700;
}
.axis-labels small { text-align: center; color: #9a858d; font-weight: 500; }
.axis-labels span:last-child { text-align: right; }
.axis-track {
  height: 11px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf2f5;
}
.axis-fill { height: 100%; border-radius: 999px; }
.warm-fill { background: linear-gradient(90deg, #e890aa, #b3486e); }
.cool-fill { background: linear-gradient(90deg, #85b7d0, #557f9d); }
.axis-summary { color: #a08c94; font-size: 11px; text-align: right; }
.language-block { margin-top: 22px; padding-top: 18px; border-top: 1px solid #efe3e7; }
.language-block h4 { margin: 2px 0 12px; color: #593744; }
.language-tags { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.language-tags span {
  padding: 11px;
  border-radius: 13px;
  background: rgba(255,255,255,.78);
  border: 1px solid #efe4e8;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.language-tags strong { color: #684451; font-size: 12px; }
.language-tags small { color: #a08c94; font-size: 10px; line-height: 1.5; }

.relationship-investment { margin-bottom: 18px; }
.investment-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}
.investment-heading h3 { margin: 0; color: #593744; font-size: 24px; }
.investment-heading p:not(.section-kicker) { max-width: 760px; margin: 8px 0 0; color: #8d7881; line-height: 1.7; }
.expression-score {
  min-width: 190px;
  padding: 14px 16px;
  border-radius: 16px;
  background: linear-gradient(145deg, #fff4f7, #f4f9fc);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.expression-score span { color: #9c4968; font-size: 12px; font-weight: 700; }
.expression-score strong { margin: 2px 0; color: #573744; font-size: 30px; }
.expression-score small { color: #9c8991; }
.expression-summary {
  margin: 14px 0 16px;
  padding: 12px 14px;
  border-radius: 13px;
  background: #fbf6f8;
  color: #72515e;
  line-height: 1.7;
  font-size: 13px;
}
.dimension-list { display: grid; gap: 13px; }
.dimension-row {
  display: grid;
  grid-template-columns: 180px 1fr 70px;
  gap: 14px;
  align-items: center;
}
.dimension-title { display: flex; flex-direction: column; gap: 3px; }
.dimension-title strong { color: #674653; font-size: 13px; }
.dimension-title small { color: #a08d95; font-size: 10px; line-height: 1.45; }
.duel-bar {
  display: flex;
  height: 30px;
  overflow: hidden;
  border-radius: 999px;
  background: #f3edf0;
}
.duel-side {
  display: flex;
  align-items: center;
  min-width: 0;
  transition: width .3s ease;
}
.duel-side span { white-space: nowrap; font-size: 10px; font-weight: 700; }
.self-side {
  justify-content: flex-start;
  padding-left: 9px;
  background: linear-gradient(90deg, #f0a0b7, #c45278);
  color: white;
}
.partner-side {
  justify-content: flex-end;
  padding-right: 9px;
  background: linear-gradient(90deg, #91bfd5, #5e8aa6);
  color: white;
}
.dimension-winner {
  color: #8d5268;
  font-size: 12px;
  text-align: right;
}
.relationship-notes { margin-bottom: 18px; }
.note-list { display: grid; gap: 10px; padding: 8px 0 4px; }
.note-item {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 10px;
  align-items: start;
  padding: 12px;
  border-radius: 13px;
  background: linear-gradient(145deg, #fff7fa, #f8fbfd);
}
.note-item span {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f0dce4;
  color: #9d4565;
  font-size: 11px;
  font-weight: 800;
}
.note-item p { margin: 1px 0 0; color: #755d66; line-height: 1.65; font-size: 12px; }
.reading-box { display: grid; gap: 11px; padding: 10px 0; }
.reading-box p {
  margin: 0;
  padding: 12px 13px;
  border-radius: 13px;
  background: #f8f5f6;
  color: #755f67;
  line-height: 1.65;
  font-size: 12px;
}
.reading-box strong { color: #5f3f4b; }

@media (max-width: 980px) {
  .personality-grid { grid-template-columns: 1fr; }
  .dimension-row { grid-template-columns: 150px 1fr 60px; }
}
@media (max-width: 720px) {
  .report-intro,
  .investment-heading { flex-direction: column; align-items: flex-start; }
  .expression-score { width: 100%; align-items: flex-start; }
  .language-tags { grid-template-columns: 1fr; }
  .dimension-row { grid-template-columns: 1fr; gap: 6px; }
  .dimension-winner { text-align: left; }
}
@media print {
  .personality-card,
  .relationship-investment,
  .relationship-notes .panel { break-inside: avoid; page-break-inside: avoid; }
}
</style>
