const $ = (id) => document.getElementById(id);

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m === 0 ? `${s}초` : `${m}분 ${s}초`;
}

function fmtLimitLabel(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h}시간` : `${h}시간 ${rem}분`;
}

function offState(s) {
  const off = s.offUntil;
  if (off == null) return { active: false };
  if (off === 'infinite') return { active: true, infinite: true };
  const remaining = off - s.now;
  if (remaining <= 0) return { active: false };
  return { active: true, infinite: false, remainingMs: remaining };
}

let status = null;

async function refresh() {
  status = await chrome.runtime.sendMessage({ type: 'getStatus' });
  render();
}

function render() {
  if (!status?.ok) return;
  const limitMin = Math.round(status.dailyLimitMs / 60000);
  const off = offState(status);

  if (off.active) {
    $('status-badge').textContent = off.infinite ? 'OFF' : `OFF · ${Math.ceil(off.remainingMs / 60000)}분`;
    $('status-badge').className = 'badge off';
  } else {
    $('status-badge').textContent = '✓ ON';
    $('status-badge').className = 'badge on';
  }

  $('usage-note').textContent = off.active ? '(Off 중에도 카운트)' : '';
  $('usage-text').textContent = `${fmtDuration(status.todayUsageMs)} / ${fmtLimitLabel(limitMin)}`;
  const pct = status.dailyLimitMs > 0 ? (status.todayUsageMs / status.dailyLimitMs) * 100 : 0;
  $('usage-bar').style.width = Math.min(100, pct) + '%';
  $('usage-bar').classList.toggle('over', pct >= 100);

  $('limit-slider').value = limitMin;
  $('limit-value').textContent = fmtLimitLabel(limitMin);

  $('on-controls').classList.toggle('hidden', off.active);
  $('on-btn').classList.toggle('hidden', !off.active);
  $('off-menu').classList.add('hidden');
}

$('limit-slider').addEventListener('input', () => {
  $('limit-value').textContent = fmtLimitLabel(Number($('limit-slider').value));
});
$('limit-slider').addEventListener('change', async () => {
  const min = Number($('limit-slider').value);
  await chrome.runtime.sendMessage({ type: 'setLimit', limitMs: min * 60000 });
  refresh();
});

$('off-btn').addEventListener('click', () => {
  $('off-menu').classList.toggle('hidden');
});
document.querySelectorAll('.off-opt').forEach((b) => {
  b.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'setOff', mode: b.dataset.mode });
    refresh();
  });
});

$('on-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'turnOn' });
  refresh();
});

refresh();
setInterval(refresh, 30000);
