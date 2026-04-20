const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

let waitingPlayer = null;
const rooms = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('findMatch', () => {
    if (waitingPlayer && waitingPlayer.id !== socket.id) {
      const roomId = `room_${Date.now()}`;
      const p1 = waitingPlayer;
      const p2 = socket;

      rooms[roomId] = {
        players: [p1.id, p2.id],
        state: initGameState()
      };

      p1.join(roomId);
      p2.join(roomId);

      p1.emit('matchFound', { roomId, playerIndex: 0 });
      p2.emit('matchFound', { roomId, playerIndex: 1 });

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit('waiting');
    }
  });

  socket.on('playerInput', ({ roomId, input }) => {
    const room = rooms[roomId];
    if (!room) return;

    const pIdx = room.players.indexOf(socket.id);
    if (pIdx === -1) return;

    updateGameState(room.state, pIdx, input);

    io.to(roomId).emit('gameState', room.state);
  });

  socket.on('disconnect', () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        io.to(roomId).emit('opponentLeft');
        delete rooms[roomId];
      }
    }
  });
});

function initGameState() {
  return {
    players: [
      { x: 150, y: 300, vx: 0, vy: 0, hp: 100, facing: 1, state: 'idle', attackTimer: 0, hitTimer: 0, blockTimer: 0 },
      { x: 650, y: 300, vx: 0, vy: 0, hp: 100, facing: -1, state: 'idle', attackTimer: 0, hitTimer: 0, blockTimer: 0 }
    ],
    timer: 60,
    timerTick: 0,
    gameOver: false,
    winner: null
  };
}

const GROUND_Y = 300;
const PLAYER_SPEED = 5;
const JUMP_FORCE = -14;
const GRAVITY = 0.7;
const STAGE_LEFT = 50;
const STAGE_RIGHT = 750;
const PUNCH_RANGE = 80;
const KICK_RANGE = 95;
const PUNCH_DAMAGE = 8;
const KICK_DAMAGE = 12;

function updateGameState(state, pIdx, input) {
  if (state.gameOver) return;

  const p = state.players[pIdx];
  const opp = state.players[1 - pIdx];

  p.hitTimer = Math.max(0, p.hitTimer - 1);
  p.attackTimer = Math.max(0, p.attackTimer - 1);
  p.blockTimer = Math.max(0, p.blockTimer - 1);

  // Auto-face opponent
  p.facing = opp.x > p.x ? 1 : -1;

  // Movement
  if (input.left) p.vx = -PLAYER_SPEED;
  else if (input.right) p.vx = PLAYER_SPEED;
  else p.vx = 0;

  // Jump
  if (input.jump && p.y >= GROUND_Y) {
    p.vy = JUMP_FORCE;
  }

  // Gravity
  p.vy += GRAVITY;
  p.y += p.vy;
  p.x += p.vx;

  // Ground
  if (p.y >= GROUND_Y) {
    p.y = GROUND_Y;
    p.vy = 0;
  }

  // Stage bounds
  p.x = Math.max(STAGE_LEFT, Math.min(STAGE_RIGHT, p.x));

  // State
  if (p.hitTimer > 0) p.state = 'hit';
  else if (p.attackTimer > 0) p.state = p.attackType || 'punch';
  else if (p.y < GROUND_Y) p.state = 'jump';
  else if (p.vx !== 0) p.state = 'walk';
  else p.state = 'idle';

  // Attack
  if (p.attackTimer === 0 && p.hitTimer === 0) {
    const dist = Math.abs(p.x - opp.x);

    if (input.punch) {
      p.attackTimer = 20;
      p.attackType = 'punch';
      if (dist <= PUNCH_RANGE) {
        opp.hp = Math.max(0, opp.hp - PUNCH_DAMAGE);
        opp.hitTimer = 15;
        opp.vx = p.facing * 3;
      }
    } else if (input.kick) {
      p.attackTimer = 25;
      p.attackType = 'kick';
      if (dist <= KICK_RANGE) {
        opp.hp = Math.max(0, opp.hp - KICK_DAMAGE);
        opp.hitTimer = 20;
        opp.vx = p.facing * 5;
      }
    }
  }

  // Timer
  state.timerTick++;
  if (state.timerTick >= 60) {
    state.timerTick = 0;
    state.timer = Math.max(0, state.timer - 1);
  }

  // Check win
  if (state.players[0].hp <= 0 || state.players[1].hp <= 0 || state.timer <= 0) {
    state.gameOver = true;
    if (state.players[0].hp > state.players[1].hp) state.winner = 0;
    else if (state.players[1].hp > state.players[0].hp) state.winner = 1;
    else state.winner = -1;
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
