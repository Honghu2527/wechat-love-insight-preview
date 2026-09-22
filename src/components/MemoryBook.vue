<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import JSZip from 'jszip';
import * as exifr from 'exifr';
import { buildMemoryPages } from '../lib/memoryBook';

const props = defineProps({
  messages: { type: Array, required: true },
  selfName: { type: String, default: '我' },
  partnerName: { type: String, default: 'TA' },
});

const zipInput = ref(null);
const loading = ref(false);
const error = ref('');
const warning = ref('');
const photoFileName = ref('');
const photos = ref([]);
const pages = ref([]);
const maxPages = ref(20);
const bookTitle = ref('我们的聊天纪念册');

const firstPhoto = computed(() => pages.value[0]?.photos?.[0]?.url || '');
const usablePhotos = computed(() => photos.value.filter((photo) => photo.takenAt));
const gpsPhotoCount = computed(() => photos.value.filter((photo) => Number.isFinite(photo.latitude) && Number.isFinite(photo.longitude)).length);

function triggerZipUpload() {
  zipInput.value?.click();
}

function mimeForName(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}

function isSupportedImage(name) {
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name);
}

function normalizeExifDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function cleanupUrls() {
  for (const photo of photos.value) {
    if (photo.url) URL.revokeObjectURL(photo.url);
  }
}

async function parsePhotoEntry(entry, index) {
  const buffer = await entry.async('arraybuffer');
  let metadata = null;
  try {
    metadata = await exifr.parse(buffer, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'latitude', 'longitude'],
    });
  } catch {
    metadata = null;
  }

  const takenAt = normalizeExifDate(metadata?.DateTimeOriginal)
    || normalizeExifDate(metadata?.CreateDate)
    || normalizeExifDate(metadata?.ModifyDate)
    || normalizeExifDate(entry.date);

  const latitude = Number(metadata?.latitude);
  const longitude = Number(metadata?.longitude);
  const blob = new Blob([buffer], { type: mimeForName(entry.name) });

  return {
    id: `${entry.name}-${index}`,
    name: entry.name.split('/').pop() || entry.name,
    takenAt,
    timeSource: metadata?.DateTimeOriginal || metadata?.CreateDate ? 'EXIF' : 'ZIP时间',
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    url: URL.createObjectURL(blob),
  };
}

async function loadZip(file) {
  if (!file) return;
  loading.value = true;
  error.value = '';
  warning.value = '';
  cleanupUrls();
  photos.value = [];
  pages.value = [];

  try {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && isSupportedImage(entry.name));
    if (!entries.length) throw new Error('这个 ZIP 里没有识别到 JPG / PNG / WebP / HEIC 等照片。');

    const limit = 400;
    const selected = entries.slice(0, limit);
    if (entries.length > limit) warning.value = `小版本暂时只读取前 ${limit} 张照片；ZIP 内共有 ${entries.length} 张。`;

    const parsed = [];
    for (let i = 0; i < selected.length; i += 1) {
      parsed.push(await parsePhotoEntry(selected[i], i));
    }

    photos.value = parsed.sort((a, b) => (a.takenAt?.getTime() || 0) - (b.takenAt?.getTime() || 0));
    photoFileName.value = file.name;
    regenerate();
  } catch (err) {
    cleanupUrls();
    photos.value = [];
    error.value = err?.message || '照片 ZIP 读取失败。';
  } finally {
    loading.value = false;
  }
}

function onZipChange(event) {
  loadZip(event.target.files?.[0]);
  event.target.value = '';
}

function regenerate() {
  pages.value = buildMemoryPages({
    photos: usablePhotos.value,
    messages: props.messages,
    maxPages: maxPages.value,
  });
}

function removePage(pageId) {
  pages.value = pages.value.filter((page) => page.id !== pageId);
}

function resetPhotos() {
  cleanupUrls();
  photos.value = [];
  pages.value = [];
  photoFileName.value = '';
  error.value = '';
  warning.value = '';
}

function exportBookPdf() {
  document.body.classList.add('memory-book-print');
  const cleanup = () => document.body.classList.remove('memory-book-print');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1500);
}

onBeforeUnmount(cleanupUrls);
</script>

<template>
  <section id="memory-book" class="memory-book-shell">
    <div class="memory-book-intro">
      <div>
        <p class="section-kicker">MEMORY BOOK · 聊天 × 照片</p>
        <h2>自动生成两个人的纪念册</h2>
        <p>导入手机照片 ZIP 后，本地读取照片时间与 GPS，并把拍摄时间附近的聊天自动放到同一页。当前 MVP 不上传照片或聊天。</p>
      </div>
      <span class="memory-badge">MVP · 本地生成</span>
    </div>

    <section class="memory-import-panel no-print">
      <div class="memory-import-main">
        <div class="memory-upload-icon">▣</div>
        <div>
          <h3>{{ photos.length ? '照片已载入' : '加入你们的照片' }}</h3>
          <p v-if="!photos.length">把手机相册中的照片打包为 ZIP。优先使用照片 EXIF 拍摄时间进行匹配，没有 EXIF 时才使用 ZIP 文件时间。</p>
          <p v-else><strong>{{ photoFileName }}</strong> · {{ photos.length }} 张照片 · {{ usablePhotos.length }} 张有时间 · {{ gpsPhotoCount }} 张带 GPS</p>
        </div>
        <button class="primary-btn memory-upload-btn" :disabled="loading" @click="triggerZipUpload">
          {{ loading ? '正在读取照片…' : (photos.length ? '换一个 ZIP' : '选择照片 ZIP') }}
        </button>
        <input ref="zipInput" class="hidden-input" type="file" accept=".zip,application/zip" @change="onZipChange" />
      </div>
      <p v-if="warning" class="memory-warning">{{ warning }}</p>
      <p v-if="error" class="error-text">{{ error }}</p>
    </section>

    <section v-if="photos.length" class="memory-toolbar no-print">
      <label>书名 <input v-model="bookTitle" type="text" /></label>
      <label>最多页面
        <select v-model.number="maxPages" @change="regenerate">
          <option :value="12">12</option>
          <option :value="20">20</option>
          <option :value="30">30</option>
          <option :value="50">50</option>
        </select>
      </label>
      <button class="ghost-btn" @click="regenerate">重新自动排版</button>
      <button class="ghost-btn" @click="exportBookPdf">导出 / 打印 PDF</button>
      <button class="ghost-btn danger-lite" @click="resetPhotos">清空照片</button>
    </section>

    <template v-if="pages.length">
      <article class="book-page book-cover">
        <img v-if="firstPhoto" :src="firstPhoto" alt="封面照片" class="cover-background" />
        <div class="cover-overlay"></div>
        <div class="cover-content">
          <p>OUR MEMORY BOOK</p>
          <h1>{{ bookTitle }}</h1>
          <div class="cover-names">{{ selfName }} <span>♥</span> {{ partnerName }}</div>
          <p class="cover-subtitle">把聊天和照片，装订成一本可以翻阅的回忆。</p>
          <small>{{ pages[0]?.dateLabel }} — {{ pages.at(-1)?.dateLabel }}</small>
        </div>
      </article>

      <article v-for="(page, index) in pages" :key="page.id" class="book-page memory-page">
        <div class="memory-page-head">
          <div>
            <p class="memory-page-date">{{ page.dateLabel }}</p>
            <input v-model="page.title" class="page-title-input" type="text" aria-label="页面标题" />
          </div>
          <div class="memory-page-meta">
            <span>PAGE {{ String(index + 1).padStart(2, '0') }}</span>
            <small>{{ page.matchLabel }}</small>
            <small v-if="page.gps">GPS {{ page.gps }}</small>
          </div>
        </div>

        <div class="memory-layout" :class="`photos-${Math.min(page.photos.length, 4)}`">
          <div class="memory-photo-grid">
            <figure v-for="photo in page.photos" :key="photo.id" class="memory-photo">
              <img :src="photo.url" :alt="photo.name" />
              <figcaption>{{ photo.timeSource }} · {{ photo.takenAt?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</figcaption>
            </figure>
            <div v-if="page.extraPhotoCount" class="extra-photo-note">+ {{ page.extraPhotoCount }} 张同一事件照片</div>
          </div>

          <div class="memory-chat-column">
            <div class="memory-quote-mark">“</div>
            <div v-if="page.messages.length" class="memory-chat-list">
              <div v-for="message in page.messages" :key="message.id" class="memory-chat" :class="message.isSend ? 'chat-self' : 'chat-partner'">
                <div class="chat-speaker">{{ message.isSend ? selfName : partnerName }} · {{ message.date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</div>
                <p>{{ message.text }}</p>
              </div>
            </div>
            <div v-else class="empty-chat-note">这一组照片附近暂时没有匹配到合适的文字聊天。后续版本会加入地点与语义匹配。</div>
          </div>
        </div>

        <div class="memory-page-footer">
          <span>{{ selfName }} × {{ partnerName }}</span>
          <button class="page-remove-btn no-print" @click="removePage(page.id)">不放这一页</button>
        </div>
      </article>

      <article class="book-page book-ending">
        <div>
          <p>TO BE CONTINUED</p>
          <h2>故事还没有写完。</h2>
          <span>{{ selfName }} ♥ {{ partnerName }}</span>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.memory-book-shell { margin-top: 26px; }
.memory-book-intro { display:flex; justify-content:space-between; align-items:flex-end; gap:24px; margin:42px 4px 16px; padding-top:26px; border-top:1px solid rgba(145,83,107,.14); }
.memory-book-intro h2 { margin:0; color:#51333f; font-size:30px; }
.memory-book-intro p:not(.section-kicker) { max-width:850px; margin:10px 0 0; color:#806b74; line-height:1.8; }
.memory-badge { padding:9px 13px; border-radius:999px; background:#f7f1f4; color:#8f4661; font-size:12px; font-weight:800; white-space:nowrap; }
.memory-import-panel,.memory-toolbar,.book-page { background:rgba(255,255,255,.9); border:1px solid rgba(145,83,107,.10); box-shadow:0 14px 50px rgba(84,44,61,.07); }
.memory-import-panel { padding:20px; border-radius:24px; margin-bottom:14px; }
.memory-import-main { display:grid; grid-template-columns:auto 1fr auto; gap:16px; align-items:center; }
.memory-upload-icon { width:58px; height:58px; display:grid; place-items:center; border-radius:18px; background:#fff0f5; color:#ae456a; font-size:26px; }
.memory-import-main h3 { margin:0 0 5px; color:#593744; }
.memory-import-main p { margin:0; color:#8e7881; line-height:1.6; font-size:13px; }
.memory-upload-btn { margin-top:0; }
.memory-warning { margin:12px 0 0; color:#8b6330; font-size:12px; }
.memory-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:14px; border-radius:18px; margin-bottom:18px; }
.memory-toolbar label { color:#755d67; font-size:12px; font-weight:700; }
.memory-toolbar input { width:220px; margin-left:6px; padding:9px 10px; border:1px solid #eadbe1; border-radius:10px; color:#5c4550; background:white; }
.danger-lite { color:#a04d5d; background:#fff3f4; }
.book-page { position:relative; width:min(100%,1120px); aspect-ratio:1.414/1; margin:0 auto 22px; overflow:hidden; border-radius:26px; }
.book-cover { display:grid; place-items:center; background:linear-gradient(145deg,#6c3448,#b45a77 55%,#e9b8c5); color:white; }
.cover-background { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.cover-overlay { position:absolute; inset:0; background:linear-gradient(110deg,rgba(46,21,32,.76),rgba(87,38,56,.42) 55%,rgba(71,27,43,.2)); }
.cover-content { position:relative; z-index:2; width:min(70%,720px); text-align:center; padding:34px; }
.cover-content>p:first-child { letter-spacing:.28em; font-size:12px; font-weight:800; opacity:.82; }
.cover-content h1 { margin:16px 0 12px; font-size:clamp(42px,6vw,82px); line-height:1; letter-spacing:-.045em; }
.cover-names { font-size:18px; letter-spacing:.08em; }
.cover-subtitle { margin:20px auto 18px; max-width:560px; line-height:1.8; opacity:.9; }
.memory-page { padding:34px 38px 30px; display:flex; flex-direction:column; }
.memory-page-head { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; margin-bottom:22px; }
.memory-page-date { margin:0 0 7px; color:#ad5774; font-size:12px; font-weight:800; }
.page-title-input { width:min(620px,70vw); border:0; border-bottom:1px dashed transparent; outline:none; background:transparent; color:#4f3440; font-size:clamp(25px,3.4vw,42px); font-weight:800; }
.memory-page-meta { display:flex; flex-direction:column; align-items:flex-end; gap:3px; color:#a18c94; font-size:10px; text-align:right; }
.memory-page-meta>span { color:#b45b79; font-weight:900; letter-spacing:.18em; }
.memory-layout { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1.25fr) minmax(280px,.75fr); gap:26px; }
.memory-photo-grid { position:relative; min-height:0; display:grid; gap:9px; grid-template-columns:repeat(2,1fr); grid-template-rows:repeat(2,minmax(0,1fr)); }
.photos-1 .memory-photo:first-child { grid-column:1/3; grid-row:1/3; }
.photos-2 .memory-photo { grid-row:1/3; }
.photos-3 .memory-photo:first-child { grid-row:1/3; }
.memory-photo { position:relative; overflow:hidden; margin:0; border-radius:16px; background:#f2e9ed; }
.memory-photo img { width:100%; height:100%; object-fit:cover; display:block; }
.memory-photo figcaption { position:absolute; left:8px; bottom:8px; padding:5px 7px; border-radius:999px; background:rgba(33,20,26,.55); color:white; font-size:9px; }
.extra-photo-note { position:absolute; right:10px; top:10px; z-index:2; padding:7px 9px; border-radius:999px; background:rgba(255,255,255,.86); color:#75485a; font-size:10px; font-weight:800; }
.memory-chat-column { position:relative; min-height:0; overflow:hidden; padding:18px 4px 4px; display:flex; flex-direction:column; justify-content:center; }
.memory-quote-mark { position:absolute; right:4px; top:-20px; color:#f1dfe5; font-family:Georgia,serif; font-size:110px; line-height:1; }
.memory-chat-list { position:relative; z-index:2; display:grid; gap:10px; }
.memory-chat { max-width:94%; padding:11px 12px; border-radius:15px; }
.memory-chat p { margin:4px 0 0; color:#674c57; line-height:1.55; font-size:12px; overflow-wrap:anywhere; }
.chat-self { justify-self:end; background:#fff0f5; border-bottom-right-radius:5px; }
.chat-partner { justify-self:start; background:#eef6fa; border-bottom-left-radius:5px; }
.chat-speaker { color:#a07283; font-size:9px; font-weight:800; }
.empty-chat-note { position:relative; z-index:2; padding:18px; border-radius:16px; background:#f8f5f6; color:#917d85; line-height:1.8; font-size:12px; }
.memory-page-footer { display:flex; justify-content:space-between; align-items:center; margin-top:18px; color:#a08d95; font-size:10px; }
.page-remove-btn { cursor:pointer; padding:7px 10px; border-radius:999px; background:#f8f1f3; color:#966078; }
.book-ending { min-height:500px; display:grid; place-items:center; text-align:center; background:linear-gradient(150deg,#fff,#fff4f7); }
.book-ending p { color:#b35a78; letter-spacing:.24em; font-size:11px; font-weight:900; }
.book-ending h2 { margin:10px 0; color:#553640; font-size:clamp(34px,5vw,62px); }

@media (max-width:800px) {
  .memory-book-intro,.memory-page-head { flex-direction:column; align-items:flex-start; }
  .memory-import-main { grid-template-columns:auto 1fr; }
  .memory-upload-btn { grid-column:1/3; width:100%; }
  .book-page { aspect-ratio:auto; min-height:760px; border-radius:20px; }
  .memory-page { padding:24px 18px; }
  .memory-layout { grid-template-columns:1fr; grid-template-rows:390px auto; }
  .memory-page-meta { align-items:flex-start; text-align:left; }
  .page-title-input { width:100%; }
}

@media print {
  .memory-book-intro,.memory-import-panel,.memory-toolbar { display:none!important; }
  .book-page { width:100%!important; height:190mm!important; min-height:0!important; aspect-ratio:auto!important; margin:0!important; border:0!important; border-radius:0!important; box-shadow:none!important; break-after:page; page-break-after:always; }
  .book-page:last-child { break-after:auto; page-break-after:auto; }
  .memory-page { padding:12mm 13mm 10mm!important; }
  .memory-layout { grid-template-columns:1.2fr .8fr!important; grid-template-rows:1fr!important; }
  .page-title-input { border:0!important; }
  .cover-overlay,.chat-self,.chat-partner,.book-ending,.book-cover { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}
</style>
