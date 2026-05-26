const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TAU = Math.PI * 2;

const rooms = new Map();

function makeRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createRoom() {
  let roomId = makeRoomId();
  while (rooms.has(roomId)) {
    roomId = makeRoomId();
  }

  const defaultEntries = [
      'รางวัลพิเศษ',
      'ส่วนลดร้าน unlocated cafe',
      'ยากันยุง',
      'ของที่ระลึก',
    'ไม่ได้อะไรเลย',
  ];

  const room = {
    id: roomId,
    entries: defaultEntries,
    phase: 'idle',
    resultIndex: null,
    currentAngle: 0,
    displaySocketId: null,
    controllerSocketId: null,
  };

  rooms.set(roomId, room);
  return room;
}

function getPublicState(room) {
  return {
    roomId: room.id,
    entries: room.entries,
    phase: room.phase,
    resultIndex: room.resultIndex,
  };
}

function pickSpinTarget(currentAngle, resultIndex, segmentCount) {
  const segmentAngle = TAU / segmentCount;
  const currentMod = ((currentAngle % TAU) + TAU) % TAU;

  const pointerTarget =
    (((TAU - (resultIndex + 0.5) * segmentAngle) % TAU) + TAU) % TAU;
  const delta = (((pointerTarget - currentMod) % TAU) + TAU) % TAU;

  const fullTurns = 6 + Math.floor(Math.random() * 3);
  return currentAngle + fullTurns * TAU + delta;
}

io.on('connection', (socket) => {
  socket.on('createGame', () => {
    const room = createRoom();
    room.displaySocketId = socket.id;

    socket.data.roomId = room.id;
    socket.data.role = 'display';
    socket.join(room.id);

    socket.emit('gameCreated', getPublicState(room));
    io.to(room.id).emit('stateUpdated', getPublicState(room));
  });

  socket.on('joinGame', (payload) => {
    const roomId = String(payload?.roomId || '')
      .trim()
      .toUpperCase();
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('joinFailed', { message: 'ไม่พบรหัสเกมนี้' });
      return;
    }

    room.controllerSocketId = socket.id;
    socket.data.roomId = room.id;
    socket.data.role = 'controller';
    socket.join(room.id);

    socket.emit('joinedGame', getPublicState(room));
    io.to(room.id).emit('stateUpdated', getPublicState(room));
  });

  socket.on('updateEntries', (payload) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || socket.data.role !== 'controller') {
      return;
    }

    if (room.phase === 'spinning') {
      return;
    }

    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
      .slice(0, 20);

    if (entries.length < 2) {
      socket.emit('invalidEntries', { message: 'ต้องมีอย่างน้อย 2 ตัวเลือก' });
      return;
    }

    room.entries = entries;
    room.phase = 'idle';
    room.resultIndex = null;

    io.to(room.id).emit('stateUpdated', getPublicState(room));
  });

  socket.on('startSpin', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || socket.data.role !== 'controller') {
      return;
    }

    if (room.phase === 'spinning' || room.entries.length < 2) {
      return;
    }

    const resultIndex = Math.floor(Math.random() * room.entries.length);
    const durationMs = 4500 + Math.floor(Math.random() * 1700);
    const targetAngle = pickSpinTarget(
      room.currentAngle,
      resultIndex,
      room.entries.length
    );

    room.phase = 'spinning';
    room.resultIndex = resultIndex;

    io.to(room.id).emit('spinStarted', {
      durationMs,
      startAngle: room.currentAngle,
      targetAngle,
      resultIndex,
    });

    setTimeout(() => {
      const stillThere = rooms.get(room.id);
      if (!stillThere) {
        return;
      }

      stillThere.currentAngle = targetAngle % TAU;
      stillThere.phase = 'result';

      io.to(stillThere.id).emit('stateUpdated', getPublicState(stillThere));
      io.to(stillThere.id).emit('roundResult', {
        resultIndex,
        resultText: stillThere.entries[resultIndex],
      });
    }, durationMs + 80);
  });

  socket.on('nextRound', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || socket.data.role !== 'controller') {
      return;
    }

    if (room.phase === 'spinning') {
      return;
    }

    room.phase = 'idle';
    room.resultIndex = null;

    io.to(room.id).emit('stateUpdated', getPublicState(room));
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    if (socket.id === room.displaySocketId) {
      io.to(room.id).emit('hostDisconnected');
      rooms.delete(room.id);
      return;
    }

    if (socket.id === room.controllerSocketId) {
      room.controllerSocketId = null;
      io.to(room.id).emit('controllerDisconnected');
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`Spinner game server running on http://localhost:${PORT}`);
});
