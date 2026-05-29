const BYPASS_COUNTDOWN_S = 30;

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m === 0 ? `${s}초` : `${m}분 ${s}초`;
}

let statusData = null;

async function loadStatus() {
  try {
    statusData = await chrome.runtime.sendMessage({ type: 'getStatus' });
  } catch {
    statusData = null;
  }
}

function updateMidnightCountdown() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diffMs = midnight.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  const el = document.getElementById('time-left');
  if (el) el.textContent = `${hours}시간 ${minutes}분`;
}

const blockCard = document.getElementById('block-card');
const waitCard = document.getElementById('wait-card');
const bypassBtn = document.getElementById('bypass-btn');
const continueBtn = document.getElementById('wait-continue');

function startWait() {
  if (statusData?.ok) {
    document.getElementById('wait-usage').textContent = fmtDuration(statusData.todayUsageMs);
    const pct = statusData.dailyLimitMs > 0 ? (statusData.todayUsageMs / statusData.dailyLimitMs) * 100 : 0;
    document.getElementById('wait-usage-bar').style.width = Math.min(100, pct) + '%';
  }
  blockCard.classList.add('hidden');
  waitCard.classList.remove('hidden');

  let remaining = BYPASS_COUNTDOWN_S;
  const secEl = document.getElementById('wait-seconds');
  const progEl = document.getElementById('wait-progress');
  secEl.textContent = remaining;
  progEl.style.width = '100%';

  const interval = setInterval(() => {
    remaining -= 1;
    secEl.textContent = Math.max(0, remaining);
    progEl.style.width = (Math.max(0, remaining) / BYPASS_COUNTDOWN_S * 100) + '%';
    if (remaining <= 0) {
      clearInterval(interval);
      continueBtn.classList.remove('hidden');
    }
  }, 1000);
}

async function confirmBypass() {
  const usageStr = statusData?.ok ? fmtDuration(statusData.todayUsageMs) : '';
  const firstMsg = usageStr
    ? `오늘 이미 ${usageStr} 봤는데, 정말 더 보시겠어요?`
    : '정말 더 보시겠어요?';
  if (!confirm(firstMsg)) { location.reload(); return; }
  if (!confirm('후회 안 할 자신 있어요?')) { location.reload(); return; }
  const res = await chrome.runtime.sendMessage({ type: 'bypass' });
  if (res?.ok) {
    location.href = 'https://www.youtube.com/shorts';
  } else {
    alert('우회 실패: ' + (res?.error ?? 'unknown'));
  }
}

bypassBtn.addEventListener('click', startWait);
continueBtn.addEventListener('click', confirmBypass);

(async () => {
  await loadStatus();
  updateMidnightCountdown();
  setInterval(updateMidnightCountdown, 30000);
})();
