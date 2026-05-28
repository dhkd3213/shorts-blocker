const BYPASS_COUNTDOWN_S = 30;

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

updateMidnightCountdown();
setInterval(updateMidnightCountdown, 30000);

const bypassBtn = document.getElementById('bypass-btn');

function startCountdown() {
  bypassBtn.disabled = true;
  let remaining = BYPASS_COUNTDOWN_S;
  bypassBtn.textContent = `잠시만요… ${remaining}`;
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      bypassBtn.textContent = `잠시만요… ${remaining}`;
    } else {
      clearInterval(interval);
      bypassBtn.disabled = false;
      bypassBtn.textContent = '정말 보시겠어요?';
      bypassBtn.onclick = confirmBypass;
    }
  }, 1000);
}

async function confirmBypass() {
  if (!confirm('정말 더 보고 싶어요?')) return;
  if (!confirm('후회 안 할 자신 있어요?')) return;
  const res = await chrome.runtime.sendMessage({ type: 'bypass' });
  if (res?.ok) {
    location.href = 'https://www.youtube.com/shorts';
  } else {
    alert('우회 실패: ' + (res?.error ?? 'unknown'));
  }
}

bypassBtn.onclick = startCountdown;
