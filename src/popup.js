const $ = (id) => document.getElementById(id);
const R = 68;
const C = 2 * Math.PI * R;

// 피드백/기능요청 구글폼
const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeqUnz_mqvYl78bOnygtnBnQ-S9ERnt599Borpj3MPh0bNidg/viewform';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtMinLabel(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h}시간` : `${h}시간 ${r}분`;
}

let status = null;
let currentMin = 10;

function isOff(s) {
  return s.offUntil != null && s.now < s.offUntil;
}

async function refresh() {
  status = await chrome.runtime.sendMessage({ type: 'getStatus' });
  render();
}

function render() {
  if (!status?.ok) return;
  const off = isOff(status);
  currentMin = Math.round(status.dailyLimitMs / 60000);

  $('power').checked = !off;

  const effLimit = status.dailyLimitMs + (status.bonusMs ?? 0);
  const pct = effLimit > 0 ? status.todayUsageMs / effLimit : 0;
  const prog = $('ring-prog');
  prog.style.strokeDasharray = C;
  prog.style.strokeDashoffset = C * (1 - Math.min(pct, 1));
  let color = cssVar('--green');
  if (pct >= 1) color = cssVar('--red');
  else if (pct >= 0.7) color = cssVar('--amber');
  prog.style.stroke = off ? '#6a6a6a' : color;

  $('usage').textContent = fmtClock(status.todayUsageMs);
  $('limit-of').textContent = fmtClock(effLimit);
  $('cap').textContent = off ? 'Off · 카운트만' : '오늘 시청';
  $('ring-wrap').classList.toggle('off', off);

  $('off-banner').classList.toggle('hidden', !off);
  if (off) {
    const remainMin = Math.max(1, Math.ceil((status.offUntil - status.now) / 60000));
    $('off-remain').textContent = `${remainMin}분 후 자동 ON`;
  }

  $('limit-val').textContent = fmtMinLabel(currentMin);
  document.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('active', Number(c.dataset.min) === currentMin);
  });

  $('hide-shorts').checked = status.hideShorts !== false;
  $('hide-shorts').disabled = off;
  document.querySelector('.opt-row').classList.toggle('dimmed', off);
}

async function applyLimit(min) {
  min = Math.max(1, Math.min(120, min));
  currentMin = min;
  $('limit-val').textContent = fmtMinLabel(min);
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.min) === min));
  await chrome.runtime.sendMessage({ type: 'setLimit', limitMs: min * 60000 });
  refresh();
}

$('power').addEventListener('change', async () => {
  if ($('power').checked) {
    await chrome.runtime.sendMessage({ type: 'turnOn' });
  } else {
    await chrome.runtime.sendMessage({ type: 'setOff' });
  }
  refresh();
});

document.querySelectorAll('.chip').forEach((c) => {
  c.addEventListener('click', () => applyLimit(Number(c.dataset.min)));
});
$('minus').addEventListener('click', () => applyLimit(currentMin - 1));
$('plus').addEventListener('click', () => applyLimit(currentMin + 1));

$('hide-shorts').addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'setHideShorts', value: $('hide-shorts').checked });
});

$('feedback').href = FEEDBACK_URL;

refresh();
setInterval(refresh, 1000);
