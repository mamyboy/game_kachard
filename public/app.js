if (typeof io === 'undefined') {
  const roleScreen = document.getElementById('role-screen');
  if (roleScreen) {
    roleScreen.innerHTML = `
      <h1>Spinner Battle</h1>
      <p class="subtitle">ไม่สามารถเชื่อมต่อระบบ Realtime ได้</p>
      <p class="error-text" style="min-height:auto; margin-top:12px;">
        พบว่า Socket.IO client ไม่ถูกโหลด หรือ backend ไม่พร้อมใช้งานบนโฮสต์นี้<br/>
        หากใช้ Vercel ให้รันเซิร์ฟเวอร์บน Render/Railway/Fly.io แล้วชี้หน้าเว็บไปยังเซิร์ฟเวอร์นั้น
      </p>
    `;
  }

  throw new Error('Socket.IO client is unavailable.');
}

function createNoopSocket() {
  return {
    emit() {},
    on() {},
  };
}

const configuredSocketUrl = String(window.GAME_CONFIG?.socketServerUrl || '').trim();
const isVercelHost = window.location.hostname.endsWith('vercel.app');
const socketBaseUrl = configuredSocketUrl || (!isVercelHost ? window.location.origin : '');

const socket = socketBaseUrl ? io(socketBaseUrl) : createNoopSocket();

const TAU = Math.PI * 2;
const palette = [
  '#ff9f1c',
  '#2ec4b6',
  '#e71d36',
  '#3a86ff',
  '#8ac926',
  '#ffbf69',
  '#6a4c93',
  '#f15bb5',
];

const roleScreen = document.getElementById('role-screen');
const displayScreen = document.getElementById('display-screen');
const controllerScreen = document.getElementById('controller-screen');

const btnDisplay = document.getElementById('btn-display');
const btnController = document.getElementById('btn-controller');
const joinForm = document.getElementById('join-form');
const roomInput = document.getElementById('room-input');
const btnJoin = document.getElementById('btn-join');
const joinError = document.getElementById('join-error');

const displayRoomCode = document.getElementById('display-room-code');
const displayStatus = document.getElementById('display-status');
const resultBanner = document.getElementById('result-banner');

const controllerRoomCode = document.getElementById('controller-room-code');
const controllerStatus = document.getElementById('controller-status');
const controllerMessage = document.getElementById('controller-message');
const entriesInput = document.getElementById('entries-input');
const btnApply = document.getElementById('btn-apply');
const btnSpin = document.getElementById('btn-spin');
const btnNext = document.getElementById('btn-next');

const canvas = document.getElementById('wheel-canvas');
const ctx = canvas.getContext('2d');

const state = {
  role: null,
  roomId: null,
  entries: ['กำลังโหลด'],
  phase: 'idle',
  rotation: 0,
  animating: false,
};

function showRealtimeUnavailableMessage() {
  const roleScreen = document.getElementById('role-screen');
  if (!roleScreen) {
    return;
  }

  roleScreen.innerHTML = `
    <h1>Spinner Battle</h1>
    <p class="subtitle">ยังไม่ได้ตั้งค่า Realtime Server</p>
    <p class="error-text" style="min-height:auto; margin-top:12px;">
      บน Vercel ต้องใช้ Socket backend แยกต่างหาก<br/>
      กรุณาเปิดไฟล์ <strong>public/config.js</strong> แล้วใส่ <strong>socketServerUrl</strong><br/>
      ตัวอย่าง: https://your-backend.onrender.com
    </p>
  `;
}

if (!socketBaseUrl) {
  showRealtimeUnavailableMessage();
}

function setVisible(el, show) {
  el.classList.toggle('hidden', !show);
}

function switchScreen(target) {
  setVisible(roleScreen, target === 'role');
  setVisible(displayScreen, target === 'display');
  setVisible(controllerScreen, target === 'controller');
}

function showControllerHint(message, isError = false) {
  controllerMessage.textContent = message;
  controllerMessage.style.color = isError ? '#b23a48' : '#435a46';
}

function drawWheel(entries, rotation = 0) {
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 8;

  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(rotation);

  const total = Math.max(entries.length, 1);
  const seg = TAU / total;

  for (let i = 0; i < total; i += 1) {
    const start = -Math.PI / 2 + i * seg;
    const end = start + seg;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = palette[i % palette.length];
    ctx.fill();

    ctx.save();
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'white';
    ctx.font = '600 21px Kanit';

    const text = String(entries[i] || '');
    const trimmed = text.length > 14 ? `${text.slice(0, 14)}...` : text;
    ctx.fillText(trimmed, radius - 16, 8);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 52, 0, TAU);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1f2a1f';
  ctx.stroke();

  ctx.restore();
}

function animateSpin(startAngle, targetAngle, durationMs) {
  state.animating = true;
  const startTime = performance.now();

  const easeOut = (t) => 1 - Math.pow(1 - t, 4);

  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = easeOut(t);
    const rotation = startAngle + (targetAngle - startAngle) * eased;

    state.rotation = rotation;
    drawWheel(state.entries, state.rotation);

    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }

    state.animating = false;
  }

  requestAnimationFrame(frame);
}

function hydrateFromState(serverState) {
  state.roomId = serverState.roomId;
  state.entries = serverState.entries;
  state.phase = serverState.phase;

  displayRoomCode.textContent = state.roomId || '----';
  controllerRoomCode.textContent = state.roomId || '----';

  if (state.role === 'controller') {
    entriesInput.value = state.entries.join('\n');
  }

  if (state.phase === 'spinning') {
    displayStatus.textContent = 'กำลังหมุน...';
    controllerStatus.textContent = 'กำลังหมุน...';
  } else if (state.phase === 'result') {
    displayStatus.textContent = 'หมุนจบแล้ว';
    controllerStatus.textContent = 'หมุนจบแล้ว';
  } else {
    displayStatus.textContent = 'พร้อมเล่น';
    controllerStatus.textContent = 'พร้อมเล่น';
  }

  if (serverState.phase !== 'result') {
    resultBanner.classList.add('hidden');
  }

  drawWheel(state.entries, state.rotation);
}

btnDisplay.addEventListener('click', () => {
  state.role = 'display';
  socket.emit('createGame');
});

btnController.addEventListener('click', () => {
  joinError.textContent = '';
  joinForm.classList.remove('hidden');
  roomInput.focus();
});

btnJoin.addEventListener('click', () => {
  const roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    joinError.textContent = 'กรุณาใส่รหัสเกม';
    return;
  }

  state.role = 'controller';
  socket.emit('joinGame', { roomId });
});

roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    btnJoin.click();
  }
});

btnApply.addEventListener('click', () => {
  const entries = entriesInput.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (entries.length < 2) {
    showControllerHint('ต้องมีอย่างน้อย 2 รายการ', true);
    return;
  }

  socket.emit('updateEntries', { entries });
  showControllerHint('อัปเดตข้อมูลวงล้อแล้ว');
});

btnSpin.addEventListener('click', () => {
  socket.emit('startSpin');
});

btnNext.addEventListener('click', () => {
  socket.emit('nextRound');
  resultBanner.classList.add('hidden');
});

socket.on('gameCreated', (serverState) => {
  switchScreen('display');
  hydrateFromState(serverState);
  resultBanner.classList.add('hidden');
});

socket.on('joinedGame', (serverState) => {
  switchScreen('controller');
  hydrateFromState(serverState);
  joinError.textContent = '';
  showControllerHint('เชื่อมต่อสำเร็จ กดหมุนได้เลย');
});

socket.on('joinFailed', (payload) => {
  switchScreen('role');
  joinError.textContent = payload?.message || 'เข้าร่วมห้องไม่สำเร็จ';
});

socket.on('invalidEntries', (payload) => {
  showControllerHint(payload?.message || 'ข้อมูลไม่ถูกต้อง', true);
});

socket.on('stateUpdated', (serverState) => {
  hydrateFromState(serverState);
});

socket.on('spinStarted', (payload) => {
  displayStatus.textContent = 'กำลังหมุน...';
  controllerStatus.textContent = 'กำลังหมุน...';
  resultBanner.classList.add('hidden');
  animateSpin(payload.startAngle, payload.targetAngle, payload.durationMs);
});

socket.on('roundResult', (payload) => {
  state.phase = 'result';
  resultBanner.textContent = `ยินดีด้วย คุณได้รับ ${payload.resultText}`;
  resultBanner.classList.remove('hidden');

  if (state.role === 'controller') {
    showControllerHint(`ผลรอบนี้: ${payload.resultText}`);
  }
});

socket.on('hostDisconnected', () => {
  switchScreen('role');
  state.role = null;
  state.roomId = null;
  joinError.textContent = 'จอแสดงผลปิดเกมแล้ว กรุณาสร้างเกมใหม่';
});

socket.on('controllerDisconnected', () => {
  displayStatus.textContent = 'Controller หลุดการเชื่อมต่อ';
});

socket.on('connect_error', () => {
  if (state.role) {
    return;
  }

  showRealtimeUnavailableMessage();
});

drawWheel(state.entries, state.rotation);
