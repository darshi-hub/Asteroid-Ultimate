// Server-side simulation engine for ASTER.
// This module is responsible for updating world state deterministically-ish each tick.

const WORLD = 4000;

const WEAPONS = [
  { name: 'LASER', cd: 12, speed: 13, spread: 0, count: 1, color: '#00f3ff', radius: 4 },
  { name: 'SPREAD', cd: 22, speed: 9, spread: 0.22, count: 3, color: '#f43f5e', radius: 4 },
  { name: 'RAIL', cd: 7, speed: 18, spread: 0, count: 1, color: '#facc15', radius: 6 }
];

const PU_TYPES = ['health', 'shield', 'rapid', 'bomb'];

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function wrap(v, max) {
  return ((v % max) + max) % max;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function getShipRadius(shipConfig) {
  return typeof shipConfig?.radius === 'number' ? shipConfig.radius : 28;
}

function getShipMaxHp(shipConfig) {
  return typeof shipConfig?.maxHp === 'number' ? shipConfig.maxHp : 100;
}

function getShipShield(shipConfig) {
  return typeof shipConfig?.shield === 'number' ? shipConfig.shield : 100;
}

function initPlayer(p) {
  p.vx = 0;
  p.vy = 0;
  p.angle = typeof p.angle === 'number' ? p.angle : -Math.PI / 2;

  // Ship customization support: treat initial stats as maxima.
  p.maxHp = typeof p.maxHp === 'number' ? p.maxHp : (typeof p.hp === 'number' ? p.hp : 100);
  p.maxShield = typeof p.maxShield === 'number' ? p.maxShield : (typeof p.shield === 'number' ? p.shield : 100);
  p.radius = typeof p.radius === 'number' ? p.radius : getShipRadius(p.shipConfig);
  p.weaponIdx = typeof p.weaponIdx === 'number' ? p.weaponIdx : 0;

  p.cooldown = 0;
  p.invuln = typeof p.invuln === 'number' ? p.invuln : 120;
  p.thrusting = false;
  p.boosting = false;

  p.shieldRegen = 0;
  p.boost = typeof p.boost === 'number' ? p.boost : 100;
  p.rapidTimer = 0;

  p.combo = typeof p.combo === 'number' ? p.combo : 0;
  p.comboTimer = typeof p.comboTimer === 'number' ? p.comboTimer : 0;
  p.score = typeof p.score === 'number' ? p.score : 0;
}

function getNearestPlayer(room, x, y) {
  let best = null;
  let bestD = Infinity;
  room.players.forEach(p => {
    const d = dist(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });
  return best;
}

function spawnAsteroid(room, x, y, r) {
  const radius = r ?? rand(38, 70);
  room.entities.push({
    type: 'asteroid',
    x: x ?? rand(0, WORLD),
    y: y ?? rand(0, WORLD),
    vx: rand(-2, 2),
    vy: rand(-2, 2),
    radius,
    angle: rand(0, Math.PI * 2),
    spin: rand(-0.03, 0.03),
    hp: radius > 55 ? 3 : radius > 35 ? 2 : 1
  });
}

function spawnUFO(room, baseX, baseY) {
  const side = Math.random() > 0.5 ? 700 : -700;
  room.entities.push({
    type: 'ufo',
    x: baseX + side,
    y: baseY + (Math.random() > 0.5 ? side : -side),
    vx: rand(-2, 2),
    vy: rand(-2, 2),
    radius: 32,
    angle: 0,
    cooldown: 90,
    hp: 3,
    chaseTimer: 0
  });
}

function spawnBoss(room) {
  const hp = 60 + room.level * 20;
  room.entities.push({
    type: 'boss',
    x: WORLD / 2,
    y: WORLD / 2 - 600,
    vx: 1.5,
    vy: 0,
    radius: 90,
    hp,
    maxHp: hp,
    cooldown: 20,
    phase: 0,
    angle: 0
  });
}

function spawnPowerup(room) {
  const t = PU_TYPES[Math.floor(Math.random() * PU_TYPES.length)];
  room.entities.push({
    type: 'powerup',
    subtype: t,
    x: rand(200, WORLD - 200),
    y: rand(200, WORLD - 200),
    vx: 0,
    vy: 0,
    radius: 20,
    angle: 0,
    spin: 0.02,
    deco: false,
    life: 900
  });
}

function loadLevel(room) {
  room.entities = [];
  const isBoss = !room.noBoss && room.level % 3 === 0;
  room.isBoss = isBoss;

  // Planets (deco)
  for (let i = 0; i < 5; i++) {
    room.entities.push({
      type: 'planet',
      x: rand(0, WORLD),
      y: rand(0, WORLD),
      vx: rand(-0.15, 0.15),
      vy: rand(-0.15, 0.15),
      radius: rand(120, 220),
      angle: 0,
      spin: 0,
      deco: true
    });
  }

  if (isBoss) {
    spawnBoss(room);
  } else {
    const pList = Array.from(room.players.values());
    const baseX = pList.length ? pList[0].x : WORLD / 2;
    const baseY = pList.length ? pList[0].y : WORLD / 2;

    const count = 8 + room.level * 4;
    for (let i = 0; i < count; i++) spawnAsteroid(room);
    for (let i = 0; i < 2 + Math.floor(room.level / 2); i++) spawnUFO(room, baseX, baseY);
  }

  // Spawn powerups
  for (let i = 0; i < 3; i++) spawnPowerup(room);
}

function enemyFire(room, ent, angle) {
  const ang = typeof angle === 'number' ? angle : Math.atan2(ent.targetY - ent.y, ent.targetX - ent.x);
  const muzzleOffset = ent.type === 'ufo' ? (ent.radius || 0) * 0.75 : 0;
  room.entities.push({
    type: 'bullet',
    x: ent.x + Math.cos(ang) * muzzleOffset,
    y: ent.y + Math.sin(ang) * muzzleOffset,
    vx: Math.cos(ang) * 7,
    vy: Math.sin(ang) * 7,
    radius: 5,
    life: 130,
    color: '#f87171',
    owner: 'enemy'
  });
}

function applyPowerup(room, player, type) {
  const p = player;
  if (type === 'health') p.hp = Math.min(p.maxHp, p.hp + 30);
  if (type === 'shield') p.shield = p.maxShield;
  if (type === 'rapid') p.rapidTimer = 300;

  if (type === 'bomb') {
    // Destroy asteroids and ufos, crediting the bomb owner.
    // Note: destroyEntity will also spawn asteroid fragments.
    const toDestroy = room.entities.filter(e => (e.type === 'asteroid' || e.type === 'ufo') && !e.deco && !e.dead);
    toDestroy.forEach(ent => {
      ent.dead = true;
      destroyEntity(room, player, ent);
    });
  }
}

function damagePlayer(room, player, amt) {
  const p = player;
  if (p.invuln > 0) return;

  if (p.shield > 0) {
    p.shield = Math.max(0, p.shield - amt * 1.5);
    p.shieldRegen = 180;
    p.invuln = 60;
    return;
  } else {
    p.hp -= amt;
    if (p.hp <= 0) {
      // MVP behavior: respawn at center rather than terminating the whole match.
      p.hp = p.maxHp;
      p.shield = 0;
      p.invuln = 60;
      p.vx = 0;
      p.vy = 0;
      p.x = WORLD / 2;
      p.y = WORLD / 2;
    }
  }
  p.invuln = 60;
}

function destroyEntity(room, killer, ent) {
  if (!ent || ent.dead !== true) {
    ent.dead = true;
  }

  if (ent.type === 'asteroid' && ent.radius > 32) {
    for (let i = 0; i < 2; i++) {
      spawnAsteroid(room, ent.x + rand(-20, 20), ent.y + rand(-20, 20), ent.radius * 0.55);
    }
  }

  if (!killer) return;

  const pts = {
    asteroid: 100 + (room.level * 10),
    ufo: 500,
    boss: 10000,
    powerup: 0
  };

  const gain = pts[ent.type] || 0;
  if (gain > 0) {
    killer.combo += 1;
    killer.comboTimer = 180;
    killer.score += gain * Math.min(killer.combo, 8);
  }

  if (ent.type === 'powerup') applyPowerup(room, killer, ent.subtype);
}

function fireWeapon(room, player) {
  const p = player;
  if (p.cooldown > 0) return;

  const w = WEAPONS[p.weaponIdx] ?? WEAPONS[0];
  const cd = p.rapidTimer > 0 ? 5 : w.cd;
  const muzzleOffset = (p.radius || 0) * 0.9;
  const muzzleX = p.x + Math.cos(p.angle) * muzzleOffset;
  const muzzleY = p.y + Math.sin(p.angle) * muzzleOffset;
  for (let i = 0; i < w.count; i++) {
    const a = p.angle + (i - (w.count - 1) / 2) * w.spread;
    room.entities.push({
      type: 'bullet',
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(a) * w.speed,
      vy: Math.sin(a) * w.speed,
      radius: w.radius,
      life: 110,
      color: w.color,
      owner: 'player',
      ownerId: p.id
    });
  }
  p.cooldown = cd;
}

function stepPlayers(room) {
  const rotSpeed = 0.075;

  room.players.forEach(p => {
    const input = p.lastInput || {};
    if (typeof input.weaponIdx === 'number') {
      const idx = Math.max(0, Math.min(WEAPONS.length - 1, Math.floor(input.weaponIdx)));
      p.weaponIdx = idx;
    }
    const left = !!input.left;
    const right = !!input.right;
    const thrust = !!input.thrust;
    const boost = !!input.boost;
    const fire = !!input.fire;

    // Rotation
    if (left) p.angle -= rotSpeed;
    if (right) p.angle += rotSpeed;

    // Boost
    if (boost && p.boost > 0) {
      p.vx += Math.cos(p.angle) * 1.2;
      p.vy += Math.sin(p.angle) * 1.2;
      p.boost = Math.max(0, p.boost - 2.5);
      p.boosting = true;
    } else {
      p.boosting = false;
    }

    // Thrust
    p.thrusting = thrust;
    if (p.thrusting) {
      p.vx += Math.cos(p.angle) * 0.38;
      p.vy += Math.sin(p.angle) * 0.38;
    }

    // Clamp speed + friction
    const maxSpd = p.boosting ? 14 : 9;
    const spd = Math.hypot(p.vx, p.vy);
    if (spd > maxSpd) {
      p.vx = (p.vx / spd) * maxSpd;
      p.vy = (p.vy / spd) * maxSpd;
    }
    p.vx *= 0.984;
    p.vy *= 0.984;

    // Move with world wrap
    p.x = wrap(p.x + p.vx, WORLD);
    p.y = wrap(p.y + p.vy, WORLD);

    // Cooldowns & regens
    if (p.cooldown > 0) p.cooldown--;
    if (p.invuln > 0) p.invuln--;
    if (p.shieldRegen > 0) p.shieldRegen--;
    else if (p.shield < p.maxShield) p.shield = Math.min(p.maxShield, p.shield + 0.15);
    if (p.rapidTimer > 0) p.rapidTimer--;
    if (p.comboTimer > 0) p.comboTimer--;
    else p.combo = 0;

    // Passive boost regen
    if (!boost) p.boost = Math.min(100, p.boost + 0.4);

    // Fire
    if (fire && p.cooldown <= 0) fireWeapon(room, p);
  });
}

function stepEntities(room) {
  // Enemy/player interaction uses collision passes after movement+AI.

  // Update entity movement + lifetimes + AI state.
  room.entities.forEach(ent => {
    if (!ent) return;
    ent.x = wrap(ent.x + (ent.vx || 0), WORLD);
    ent.y = wrap(ent.y + (ent.vy || 0), WORLD);
    if (ent.spin) ent.angle = (ent.angle || 0) + ent.spin;

    // Powerup lifetime
    if (ent.type === 'powerup') {
      ent.life--;
      if (ent.life <= 0) ent.dead = true;
    }

    // Bullet lifetime
    if (ent.type === 'bullet') {
      ent.life--;
      if (ent.life <= 0) ent.dead = true;
    }

    // UFO homing + firing
    if (ent.type === 'ufo') {
      ent.chaseTimer = (ent.chaseTimer || 0) + 1;
      const nearest = getNearestPlayer(room, ent.x, ent.y);
      if (nearest) {
        const ang = Math.atan2(nearest.y - ent.y, nearest.x - ent.x);
        ent.angle = ang;
        ent.targetX = nearest.x;
        ent.targetY = nearest.y;
        if (ent.chaseTimer % 60 === 0) {
          const spd = 2.5;
          ent.vx = Math.cos(ang) * spd + rand(-0.5, 0.5);
          ent.vy = Math.sin(ang) * spd + rand(-0.5, 0.5);
        }

        ent.cooldown = (ent.cooldown || 0) - 1;
        if (ent.cooldown <= 0) {
          enemyFire(room, ent, ang);
          ent.cooldown = 80;
        }
      } else {
        ent.cooldown = (ent.cooldown || 0) - 1;
      }
    }

    // Boss
    if (ent.type === 'boss' && !room.noBoss) {
      ent.cooldown = (ent.cooldown || 0) - 1;
      const nearest = getNearestPlayer(room, ent.x, ent.y);
      if (nearest) {
        const ang = Math.atan2(nearest.y - ent.y, nearest.x - ent.x);
        if (ent.cooldown <= 0) {
          for (let a = 0; a < 3; a++) {
            enemyFire(room, ent, ang + (a - 1) * 0.3);
          }
          ent.cooldown = 22;
        }
        ent.vx += Math.cos(ang) * 0.04;
        ent.vy += Math.sin(ang) * 0.04;
        ent.vx = Math.max(-2.5, Math.min(2.5, ent.vx));
        ent.vy = Math.max(-2.5, Math.min(2.5, ent.vy));
      }
    }
  });

  // Collision passes
  const playersArr = Array.from(room.players.values());

  // Player contacts: (asteroid/ufo/boss/powerup) destroy the entity as needed.
  room.entities.forEach(ent => {
    if (!ent || ent.deco || ent.type === 'bullet') return;
    if (ent.dead) return;

    for (const p of playersArr) {
      if (p.invuln > 0) continue;
      if (dist(p.x, p.y, ent.x, ent.y) < p.radius + ent.radius) {
        if (ent.type === 'powerup') {
          ent.dead = true;
          applyPowerup(room, p, ent.subtype);
        } else {
          damagePlayer(room, p, ent.type === 'boss' ? 5 : 20);
          if (ent.type !== 'boss') ent.dead = true;
        }
        break;
      }
    }
  });

  // Bullets
  room.entities.forEach(ent => {
    if (!ent || ent.type !== 'bullet' || ent.dead) return;

    if (ent.owner === 'enemy') {
      for (const p of playersArr) {
        if (p.invuln > 0) continue;
        if (dist(p.x, p.y, ent.x, ent.y) < p.radius + ent.radius) {
          ent.dead = true;
          damagePlayer(room, p, 12);
          break;
        }
      }
      return;
    }

    if (ent.owner === 'player') {
      const shooter = room.players.get(ent.ownerId);

      // PvP: player bullets can damage other players.
      if (room.mode === 'pvp' && shooter) {
        for (const p of playersArr) {
          if (p.id === shooter.id) continue;
          if (p.invuln > 0) continue;
          if (dist(p.x, p.y, ent.x, ent.y) < p.radius + ent.radius) {
            ent.dead = true;
            damagePlayer(room, p, 20);
            // MVP: small scoring for PvP hits/kills.
            if (p.hp <= 0) shooter.score += 300;
            else shooter.score += 50;
            break;
          }
        }
        if (ent.dead) return;
      }

      // Damage asteroids/ufos/boss.
      for (const target of room.entities) {
        if (!target || target.dead) continue;
        if (ent.dead) break;
        if (target.deco || target.type === 'bullet' || target.type === 'powerup') continue;
        if (target.type !== 'boss' && target.type !== 'ufo' && target.type !== 'asteroid') continue;
        if (dist(target.x, target.y, ent.x, ent.y) < target.radius + ent.radius) {
          ent.dead = true;
          target.hp = (target.hp || 1) - 1;
          if (target.hp <= 0) {
            target.dead = true;
            destroyEntity(room, shooter, target);
          }
          break;
        }
      }
    }
  });

  room.entities = room.entities.filter(e => !e.dead);
}

function stepRoom(room) {
  room.tick += 1;

  // Init/load level lazily (rooms created before players join can call step).
  if (!room.entities || room.entities.length === 0) {
    loadLevel(room);
  }

  stepPlayers(room);
  stepEntities(room);

  // Level complete: no asteroids/ufos/boss left (deco planets and powerups are ignored).
  const remain = room.entities.filter(e => !e.deco && e.type !== 'bullet' && e.type !== 'powerup');
  if (remain.length === 0) {
    room.level += 1;
    loadLevel(room);
  }
}

module.exports = {
  WORLD,
  WEAPONS,
  PU_TYPES,
  initPlayer,
  initRoom: loadLevel,
  stepRoom
};
