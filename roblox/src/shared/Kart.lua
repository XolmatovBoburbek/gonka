--!strict
-- Аркадная физика карта в "пространстве трассы" (порт race/kart.js веб-версии, метры и секунды):
-- газ/тормоз, руление, дрифт с настоящим углом заноса, буст-шкала из трёх делений, бусты складываются,
-- старт на оборотах, монеты, слипстрим, трамплины и трюки, стены, бездорожье, попадания.
-- Модуль чистый: не трогает мир Роблокса. Им пользуются и клиент (свой карт), и сервер (боты).

local Track = require(script.Parent.Track)

local Kart = {}
Kart.__index = Kart

local PHYS = {
	maxSpeed = 40,
	accel = 26,
	reverseMax = 11,
	brake = 42,
	drag = 7,
	offroadFactor = 0.55,
	turnRate = 2.05,
	gravity = 34,
	hopVel = 5.2,
	radius = 1.15,
	curbWidth = 1.5,
	driftMinSpeed = 13,
	-- занос: нос опережает направление движения на угол (рад); руль в поворот — круче, контр-руль — мельче
	driftAngle = 0.42,
	driftAngleSteer = 0.26,
	driftAngleRate = 5.5,
	driftRecover = 6.5,
	driftScrub = 0.3,
	driftFlipHold = 1.2,
	-- буст-шкала из трёх делений: копится в заносе и на трюках, тратится вся сразу
	meterRate = 0.42,
	meterTrick = 0.25,
	boostLevels = { { 0.9, 1.22 }, { 2.0, 1.3 }, { 3.2, 1.38 } },
	boostStackMax = 1.0, -- бусты складываются, но не больше чем ×2
	-- старт на оборотах
	revUp = 0.8,
	revDown = 0.55,
	revZones = { good = 0.48, perfect = 0.62, perfectTop = 0.8, red = 0.9 },
	revChargeTime = 0.7,
	launchPerfect = { 1.2, 1.32 },
	launchGood = { 0.7, 1.2 },
	launchSpin = 0.7,
	-- монеты и слипстрим
	coinMax = 10,
	coinSpeed = 0.01,
	coinLoss = 3,
	draftTime = 1.4,
	draftBoost = { 1.3, 1.16 },
}
Kart.PHYS = PHYS

local function sign(x: number): number
	return if x > 0 then 1 elseif x < 0 then -1 else 0
end

--- opts: { track, stats = {speed, accel, handling} (1..5), isPlayer }
function Kart.new(track, opts)
	local self = setmetatable({}, Kart)
	local st = opts.stats or { speed = 3, accel = 3, handling = 3 }
	self.track = track
	self.isPlayer = opts.isPlayer or false
	self.speedF = 1 + (st.speed - 3) * 0.028
	self.accelF = 1 + (st.accel - 3) * 0.13
	self.handF = 1 + (st.handling - 3) * 0.07
	self.driftF = 1 + (st.handling - 3) * 0.08
	self.rubber = 1
	self.botSpeed = 1

	self.pos = Vector3.zero
	self.heading = 0 -- куда смотрит нос (0 — вдоль +Z)
	self.moveHeading = 0 -- куда на самом деле едет
	self.speed = 0
	self.vy = 0
	self.airborne = false
	self.airTime = 0
	self.pushX, self.pushZ = 0, 0
	self.steer = 0
	self.throttle = 0

	self.drift = { active = false, dir = 0, angle = 0, flipT = 0, level = 0, intent = false }
	self.boosts = {}
	self.boost = { time = 0, power = 1, kind = "", stack = 0 }
	self.boostMeter = 0
	self.coins = 0
	self.coinsTotal = 0
	self.draft = 0
	self.draftCd = 0
	self.onGrid = false
	self.rev = 0
	self.revVel = 0
	self.revCharge = 0
	self.revLimit = 0
	self.gridThrottle = 0
	self.launchSpin = 0
	self.spinTimer = 0
	self.spinAngle = 0
	self.frozenTimer = 0
	self.invuln = 0
	self.shieldTimer = 0
	self.trick = { active = false, t = 0, pending = false, canTrick = false }
	self.hop = 0

	self.proj = {}
	self.trackIdx = -1
	self.lateral = 0
	self.progress = 0
	self.lapsDone = -1
	self.totalProgress = 0
	self.offroad = false
	self.onCurb = false
	self.surfaceUp = Vector3.new(0, 1, 0)
	self.rampZone = nil

	self.finished = false
	self.wrongWayTimer = 0
	self.wrongWay = false
	self.stuckTimer = 0
	self.respawns = 0
	self.events = {}
	return self
end

function Kart:emit(kind: string, data: any?)
	local e = data or {}
	e.type = kind
	table.insert(self.events, e)
end

function Kart:controllable(): boolean
	return self.spinTimer <= 0 and self.frozenTimer <= 0
end

function Kart:camHeading(): number
	return self.moveHeading + (self.heading - self.moveHeading) * 0.35
end

function Kart:placeAt(progress: number, lateral: number)
	local fr = self.track:frameAtProgress(progress)
	self.pos = fr.pos + fr.right * lateral
	self.heading = math.atan2(fr.tan.X, fr.tan.Z)
	self.moveHeading = self.heading
	self.drift.angle = 0
	self.trackIdx = fr.index
	local pr = self.track:project(self.pos, self.trackIdx, self.proj)
	self.progress = pr.f * self.track.spacing
	self.lateral = pr.lateral
	self.surfaceUp = fr.up
end

-- ------------------------------------------------------------------ бусты (складываются)

function Kart:_sumBoosts()
	local B = self.boost
	local bonus = 0
	local top = nil
	B.time = 0
	for _, b in self.boosts do
		bonus += b.power - 1
		if b.time > B.time then
			B.time = b.time
		end
		if not top or b.power > top.power then
			top = b
		end
	end
	B.power = 1 + math.min(PHYS.boostStackMax, bonus)
	B.kind = if top then top.kind else ""
	B.stack = #self.boosts
end

--- Буст: прибавка (power − 1) к максимальной скорости на time секунд. key — источник, который
--- не складывается сам с собой (тот же бустер под колёсами продлевает свой буст).
function Kart:addBoost(time: number, power: number, kind: string, key: string?)
	local found = nil
	if key then
		for _, b in self.boosts do
			if b.key == key then
				found = b
				break
			end
		end
	end
	if found then
		found.time = math.max(found.time, time)
		found.power = math.max(found.power, power)
	else
		table.insert(self.boosts, { key = key, kind = kind, time = time, power = power })
	end
	self:_sumBoosts()
	self:emit("boost", { kind = kind, stack = self.boost.stack, added = found == nil })
end

function Kart:clearBoosts()
	table.clear(self.boosts)
	self:_sumBoosts()
end

function Kart:boosting(): boolean
	return self.boost.time > 0
end

-- ------------------------------------------------------------------ попадания, шкала, монеты

--- 'spin' (сфера) или 'freeze' (лёд). Возвращает true, если эффект применён.
function Kart:hit(kind: string): boolean
	if self.invuln > 0 then
		return false
	end
	if self.shieldTimer > 0 then
		self.shieldTimer = 0
		self.invuln = 0.6
		self:emit("shieldBreak")
		return false
	end
	self:cancelDrift()
	self:clearBoosts()
	local lost = math.min(self.coins, PHYS.coinLoss)
	if lost > 0 then
		self.coins -= lost
		self:emit("coinLoss", { n = lost })
	end
	if kind == "freeze" then
		self.frozenTimer = 1.5
		self.invuln = 2.6
	else
		self.spinTimer = 1.05
		self.invuln = 2.2
	end
	self:emit("hit", { kind = kind })
	return true
end

function Kart:cancelDrift()
	local d = self.drift
	d.intent = false
	if not d.active then
		return
	end
	d.active = false
	d.level = 0
	d.flipT = 0
end

function Kart:fillMeter(x: number)
	local before = math.floor(self.boostMeter)
	self.boostMeter = math.min(3, self.boostMeter + x)
	local now = math.floor(self.boostMeter)
	if now > before then
		self:emit("meterSegment", { level = now })
	end
end

--- Потратить все полные деления: 1 — синий буст, 2 — оранжевый, 3 — фиолетовый.
function Kart:useBoost(): boolean
	if not self:controllable() then
		return false
	end
	local n = math.min(3, math.floor(self.boostMeter + 1e-6))
	if n < 1 then
		self:emit("boostEmpty")
		return false
	end
	self.boostMeter = math.max(0, self.boostMeter - n)
	local lv = PHYS.boostLevels[n]
	self:addBoost(lv[1], lv[2], "boost" .. n)
	self:emit("boostFire", { level = n })
	return true
end

function Kart:addCoin()
	self.coinsTotal += 1
	if self.coins < PHYS.coinMax then
		self.coins += 1
	end
	self:emit("coin")
end

-- ------------------------------------------------------------------ старт на оборотах

function Kart:revZone(r: number?): string
	local v = r or self.rev
	local Z = PHYS.revZones
	if v >= Z.red then
		return "red"
	elseif v >= Z.perfect and v <= Z.perfectTop then
		return "perfect"
	elseif v >= Z.good then
		return "good"
	end
	return "low"
end

--- Отсчёт: карт стоит, газ раскручивает мотор; пока стрелка в зелёной зоне — копится заряд старта.
function Kart:revOnGrid(dt: number, throttle: number)
	self.onGrid = true
	self.gridThrottle = throttle
	local target = throttle * 1.12
	local d = target - self.rev
	local want = if d > 0 then math.min(PHYS.revUp, d * 6) else math.max(-PHYS.revDown, d * 5)
	self.revVel += (want - self.revVel) * (1 - math.exp(-dt * 14))
	self.rev += self.revVel * dt
	if self.revLimit > 0 then
		self.revLimit -= dt
	end
	if self.rev >= 1 then
		-- отсечка: зажигание рвётся, обороты проседают и снова упираются
		self.rev = 0.955
		self.revVel = 0
		self.revLimit = 0.08
	elseif self.rev < 0 then
		self.rev = 0
		self.revVel = math.max(0, self.revVel)
	end
	local z = self:revZone()
	local dc = if z == "perfect" then 1 / PHYS.revChargeTime elseif z == "good" then -0.25 elseif z == "red" then -1.2 else -0.8
	self.revCharge = math.clamp(self.revCharge + dc * dt, 0, 1)
end

--- "СТАРТ!": итог по заряду и стрелке. 'perfect' | 'good' | 'spin' | 'none'.
function Kart:launch(): string
	local z = self:revZone()
	self.onGrid = false
	local result = "none"
	if z == "red" then
		result = "spin"
		self.launchSpin = PHYS.launchSpin
	elseif self.revCharge >= 0.999 and z ~= "low" then
		result = "perfect"
		self:addBoost(PHYS.launchPerfect[1], PHYS.launchPerfect[2], "rocket")
	elseif self.revCharge >= 0.35 and z ~= "low" then
		result = "good"
		self:addBoost(PHYS.launchGood[1], PHYS.launchGood[2], "rocket")
	end
	self.revCharge = 0
	self:emit("launch", { result = result })
	return result
end

function Kart:_revRace(dt: number, throttle: number)
	local v = math.abs(self.speed) / PHYS.maxSpeed
	local target
	if self.launchSpin > 0 then
		target = 0.97
	elseif self.airborne then
		target = if throttle > 0.1 then 0.95 else 0.3
	else
		target = math.max(0.06 + 0.8 * math.min(v, 1.2), 0.42 * throttle)
		if self.drift.active then
			target += 0.05
		end
	end
	target = math.min(0.99, target)
	local rate = if target > self.rev then 7 else 4
	self.rev += (target - self.rev) * (1 - math.exp(-dt * rate))
	self.revVel = 0
	self.revLimit = 0
end

function Kart:respawn()
	self.respawns += 1
	self:placeAt(self.progress - 4, 0)
	self.speed = 0
	self.vy = 0
	self.airborne = false
	self.pushX, self.pushZ = 0, 0
	self:cancelDrift()
	self.spinTimer = 0
	self.frozenTimer = 0
	self.invuln = 2
	self.stuckTimer = 0
	self:emit("respawn")
end

-- ------------------------------------------------------------------ шаг физики

--- input: { steer, throttle, brake, driftHeld, driftPressed }
function Kart:step(dt: number, input)
	local P = PHYS
	local track = self.track

	if #self.boosts > 0 then
		local n = 0
		local list = self.boosts
		for i = 1, #list do
			local b = list[i]
			b.time -= dt
			if b.time > 0 then
				n += 1
				list[n] = b
			end
		end
		for i = #list, n + 1, -1 do
			list[i] = nil
		end
		self:_sumBoosts()
	end
	if self.invuln > 0 then
		self.invuln -= dt
	end
	if self.shieldTimer > 0 then
		self.shieldTimer -= dt
	end
	if self.spinTimer > 0 then
		self.spinTimer -= dt
		self.spinAngle += dt * 13
		if self.spinTimer <= 0 then
			self.spinAngle = 0
		end
	end
	if self.frozenTimer > 0 then
		self.frozenTimer -= dt
		if self.frozenTimer <= 0 then
			self:emit("unfreeze")
		end
	end
	if self.launchSpin > 0 then
		self.launchSpin -= dt
	end
	if self.draftCd > 0 then
		self.draftCd -= dt
	end

	local ctrl = self:controllable()
	local throttle = if ctrl then input.throttle else 0
	local brake = if ctrl then input.brake else 0
	local steerIn = if ctrl then input.steer else 0
	self.throttle = throttle
	self.steer += (steerIn - self.steer) * (1 - math.exp(-dt * 11))

	local d = self.drift
	local boosting = self.boost.time > 0
	local vmaxBase = P.maxSpeed * self.speedF * self.rubber * self.botSpeed * (1 + P.coinSpeed * self.coins)
	local vmax = vmaxBase
	if self.offroad and not boosting then
		vmax *= P.offroadFactor
	end
	if boosting then
		vmax = vmaxBase * self.boost.power
	end

	-- ---- продольная динамика
	if self.frozenTimer > 0 then
		self.speed *= math.exp(-dt * 7)
	elseif self.spinTimer > 0 then
		self.speed *= math.exp(-dt * 2.2)
	elseif not self.airborne then
		if boosting then
			if self.speed < vmax then
				self.speed = math.min(vmax, self.speed + 75 * dt)
			end
		elseif throttle > 0.01 then
			if self.speed < 0 then
				self.speed += P.brake * dt
			elseif self.speed < vmax then
				local k = 1 - (self.speed / vmax) ^ 2
				local grip = if self.launchSpin > 0 then 0.2 else 1
				self.speed = math.min(vmax, self.speed + P.accel * self.accelF * throttle * grip * math.max(0.1, k) * dt)
			end
		end
		if brake > 0.01 and not boosting then
			if self.speed > 0.5 then
				self.speed -= P.brake * brake * dt
			else
				self.speed = math.max(-P.reverseMax, self.speed - P.accel * 0.6 * brake * dt)
			end
		end
		if throttle <= 0.01 and brake <= 0.01 and not boosting then
			local dd = P.drag * dt
			self.speed = if math.abs(self.speed) < dd then 0 else self.speed - sign(self.speed) * dd
		end
		if self.speed > vmax then
			self.speed = math.max(vmax, self.speed - (if self.offroad then 50 else 16) * dt)
		end
		if d.active then
			self.speed -= P.driftScrub * math.sin(math.abs(d.angle)) * self.speed * dt
		end
	else
		self.speed *= math.exp(-dt * 0.08)
	end

	-- ---- дрифт
	if ctrl and input.driftPressed and not self.airborne then
		self.vy = P.hopVel
		self.airborne = true
		self.airTime = 0
		self.hop = 1
		d.intent = true
		self:emit("hop")
	end
	if ctrl and input.driftPressed and self.airborne and self.trick.canTrick and not self.trick.active then
		self.trick.active = true
		self.trick.t = 0
		self.trick.pending = true
		self:emit("trick")
	end
	if not input.driftHeld then
		if d.active then
			self:cancelDrift()
		end
		d.intent = false
	end
	if d.active then
		if math.abs(self.speed) < 9 or not ctrl then
			self:cancelDrift()
		elseif not self.airborne then
			local q = math.min(1.2, math.abs(self.speed) / P.maxSpeed) * (0.45 + math.abs(d.angle) / 0.6) * self.driftF
			self:fillMeter(dt * P.meterRate * q)
			d.level = math.min(3, math.floor(self.boostMeter) + 1)
		end
	end

	-- ---- руление
	local absV = math.abs(self.speed)
	local sf = math.min(1, absV / 7) * (1 - 0.3 * math.clamp((absV - 20) / 24, 0, 1))
	local yawRate
	if d.active then
		local into = self.steer * d.dir
		yawRate = -d.dir * P.turnRate * self.handF * (0.55 + 0.5 * into) * math.max(sf, 0.6)
		if not self.airborne then
			local hard = into < -0.7
			local target = if hard then 0.05 else (P.driftAngle + P.driftAngleSteer * into) * (0.55 + 0.45 * math.min(1, absV / 30))
			d.angle += (target - d.angle) * (1 - math.exp(-dt * P.driftAngleRate * (if hard then 1.6 else 1)))
			if hard and d.angle < 0.2 then
				d.flipT += dt
				if d.flipT > P.driftFlipHold then
					d.dir = -d.dir
					d.angle = -d.angle
					d.flipT = 0
					self:emit("driftFlip")
				end
			else
				d.flipT = 0
			end
		end
	else
		yawRate = -self.steer * P.turnRate * self.handF * sf * (if self.speed < -0.5 then -1 else 1)
		if d.angle ~= 0 then
			d.angle *= math.exp(-dt * P.driftRecover)
			if math.abs(d.angle) < 0.003 then
				d.angle = 0
			end
		end
	end
	if self.airborne then
		yawRate *= if self.hop > 0 then 0.8 else 0.3
	end
	if self.spinTimer > 0 or self.frozenTimer > 0 then
		yawRate = 0
	end
	self.moveHeading += yawRate * dt
	self.heading = self.moveHeading - d.dir * d.angle

	-- ---- перемещение — по направлению движения
	local fx = math.sin(self.moveHeading)
	local fz = math.cos(self.moveHeading)
	local vx = fx * self.speed + self.pushX
	local vz = fz * self.speed + self.pushZ
	local px, py, pz = self.pos.X + vx * dt, self.pos.Y, self.pos.Z + vz * dt
	local pd = math.exp(-dt * 4.5)
	self.pushX *= pd
	self.pushZ *= pd

	-- ---- проекция на трассу
	local pr = track:project(Vector3.new(px, py, pz), self.trackIdx, self.proj)
	self.trackIdx = pr.nearest
	local lateral = pr.lateral :: number
	local lim = pr.hw + pr.wall - P.radius
	if math.abs(lateral) > lim then
		local side = sign(lateral)
		local pen = math.abs(lateral) - lim
		px -= pr.right.X * side * pen
		pz -= pr.right.Z * side * pen
		local nx = -side * pr.right.X
		local nz = -side * pr.right.Z
		local nl = math.sqrt(nx * nx + nz * nz)
		if nl == 0 then
			nl = 1
		end
		local into = -(fx * nx + fz * nz) / nl
		if into > 0.02 then
			local tx = fx + (nx / nl) * into * 1.08
			local tz = fz + (nz / nl) * into * 1.08
			self.moveHeading = math.atan2(tx, tz)
			self.heading = self.moveHeading - d.dir * d.angle
			local loss = math.min(0.65, into * 0.85)
			local before = self.speed
			self.speed *= 1 - loss
			if into > 0.28 and before > 12 then
				self:emit("wallHit", { strength = into })
				if into > 0.5 then
					self:cancelDrift()
				end
			end
		end
		local pn = self.pushX * (nx / nl) + self.pushZ * (nz / nl)
		if pn < 0 then
			self.pushX -= (nx / nl) * pn * 1.5
			self.pushZ -= (nz / nl) * pn * 1.5
		end
		lateral = side * lim
	end
	self.lateral = lateral
	self.onCurb = math.abs(lateral) > pr.hw and math.abs(lateral) <= pr.hw + P.curbWidth
	self.offroad = math.abs(lateral) > pr.hw + P.curbWidth

	-- ---- прогресс и круги
	local newProg = pr.f * track.spacing
	local delta = newProg - self.progress
	if delta < -track.length / 2 then
		self.lapsDone += 1
		self:emit("lapCross", { forward = true })
	elseif delta > track.length / 2 then
		self.lapsDone -= 1
		self:emit("lapCross", { forward = false })
	end
	self.progress = newProg
	self.totalProgress = self.lapsDone * track.length + self.progress

	-- ---- высота: дорога, трамплины, полёт
	local surf = pr.pos.Y + pr.right.Y * lateral
	local onRamp = nil
	for _, z in track.rampZones do
		if math.abs(self.lateral - z.lat) < z.halfW and self.progress >= z.s0 and self.progress <= z.s1 then
			onRamp = z
			surf += Track.rampHeightAt(z, (self.progress - z.s0) / z.len)
		end
	end
	if self.rampZone and not onRamp and not self.airborne and self.speed > 8 then
		self.vy = 6 + self.speed * 0.2
		self.airborne = true
		self.airTime = 0
		self.hop = 0
		self.trick.canTrick = true
		self:emit("jump")
	end
	self.rampZone = onRamp

	if self.airborne then
		self.airTime += dt
		self.vy -= P.gravity * dt
		py += self.vy * dt
		if self.trick.active then
			self.trick.t += dt
		end
		if py <= surf and self.vy <= 0 then
			py = surf
			local impact = -self.vy
			self.airborne = false
			self.vy = 0
			local wasHop = self.hop > 0
			self.hop = 0
			if self.trick.pending then
				self:addBoost(0.9, 1.25, "trick")
				self:fillMeter(P.meterTrick)
				self:emit("trickBoost")
			end
			self.trick.active = false
			self.trick.pending = false
			self.trick.canTrick = false
			if impact > 9 then
				self:emit("land", { impact = impact })
			end
			if wasHop and d.intent and input.driftHeld and math.abs(self.steer) > 0.22 and self.speed > P.driftMinSpeed and ctrl then
				local dir = sign(self.steer)
				d.angle *= d.dir * dir
				d.active = true
				d.dir = dir
				d.flipT = 0
				d.level = math.min(3, math.floor(self.boostMeter) + 1)
				self:emit("driftStart")
			end
		elseif py < surf - 30 then
			self.pos = Vector3.new(px, py, pz)
			self:respawn()
			return
		end
	else
		local yFree = py + self.vy * dt - 0.5 * P.gravity * dt * dt
		if surf < yFree - 0.02 and self.speed > 20 and not onRamp then
			self.airborne = true
			self.airTime = 0
			self.hop = 0
			py = yFree
			self.vy -= P.gravity * dt
		else
			self.vy = math.clamp((surf - py) / math.max(dt, 1e-4), -25, 25)
			py = surf
		end
	end
	self.pos = Vector3.new(px, py, pz)
	self.surfaceUp = self.surfaceUp:Lerp(pr.up, 1 - math.exp(-dt * 10)).Unit

	-- ---- бустеры на дороге
	if not self.airborne then
		for i, z in track.boostZones do
			if math.abs(self.lateral - z.lat) < z.halfW + 0.4 and self.progress >= z.s0 and self.progress <= z.s1 then
				local key = "pad" .. i
				local fresh = false
				for _, b in self.boosts do
					if b.key == key and b.time >= 0.9 then
						fresh = true
						break
					end
				end
				if not fresh then
					self:addBoost(1.15, 1.34, "pad", key)
				end
			end
		end
	end

	-- ---- неправильное направление / застревание
	local along = fx * pr.tan.X + fz * pr.tan.Z
	if along < -0.35 and self.speed > 4 then
		self.wrongWayTimer += dt
	else
		self.wrongWayTimer = math.max(0, self.wrongWayTimer - dt * 2)
	end
	local ww = self.wrongWayTimer > 1.2
	if ww ~= self.wrongWay then
		self.wrongWay = ww
		self:emit("wrongWay", { on = ww })
	end
	if not self.onGrid then
		self:_revRace(dt, throttle)
	end
	if ctrl and throttle > 0.5 and math.abs(self.speed) < 2.5 and not self.airborne and self.launchSpin <= 0 then
		self.stuckTimer += dt
	else
		self.stuckTimer = math.max(0, self.stuckTimer - dt)
	end
	if self.stuckTimer > (if self.isPlayer then 5 else 2.5) then
		self:respawn()
	end
end

--- Слипстрим: others — список { progress, lateral, y, speed }. Вызывать раз в кадр после step.
function Kart:updateDraft(dt: number, others)
	local inAir = false
	if self.draftCd <= 0 and self.speed > 22 and not self.airborne and self:controllable() and not self.finished then
		for _, o in others do
			if o.speed >= 15 then
				local ds = self.track:deltaProgress(self.progress, o.progress)
				if ds > 2.5 and ds < 17 and math.abs(o.lateral - self.lateral) < 2.3 and math.abs(o.y - self.pos.Y) < 2 then
					inAir = true
					break
				end
			end
		end
	end
	if inAir then
		self.draft += dt
		if self.draft >= PHYS.draftTime then
			self.draft = 0
			self.draftCd = 2.5
			self:addBoost(PHYS.draftBoost[1], PHYS.draftBoost[2], "draft", "draft")
			self:emit("slipstream")
		end
	else
		self.draft = math.max(0, self.draft - dt * 2)
	end
end

--- Столкновение с другим картом (круги радиуса PHYS.radius): толкаем только себя (у каждого свой хозяин).
function Kart:collideWith(ox: number, oy: number, oz: number, ovx: number, ovz: number, heavy: boolean?)
	local R = PHYS.radius
	local dx, dz = ox - self.pos.X, oz - self.pos.Z
	local d2 = dx * dx + dz * dz
	if d2 > 4 * R * R or math.abs(oy - self.pos.Y) > 1.6 then
		return
	end
	local d = math.sqrt(d2)
	if d < 0.001 then
		d = 0.001
	end
	local nx, nz = dx / d, dz / d
	-- доля толчка — как в веб-версии: щит делает карт "тяжелее" в 4 раза
	local mine = if self.shieldTimer > 0 then 4 else 1
	local theirs = if heavy then 4 else 1
	local wa = theirs / (mine + theirs)
	local overlap = 2 * R - d
	self.pos -= Vector3.new(nx, 0, nz) * overlap * wa
	local vax = math.sin(self.moveHeading) * self.speed + self.pushX
	local vaz = math.cos(self.moveHeading) * self.speed + self.pushZ
	local rel = (ovx - vax) * nx + (ovz - vaz) * nz
	if rel < 0 then
		local imp = (-rel * 0.85 + 1.5) * wa
		self.pushX -= nx * imp
		self.pushZ -= nz * imp
		-- тот, кто сзади, теряет немного скорости
		local fa = math.sin(self.moveHeading) * nx + math.cos(self.moveHeading) * nz
		if fa > 0.3 then
			self.speed *= 1 - 0.18 * fa * wa * 2
		end
		if -rel > 4 then
			self:emit("bump", { strength = -rel })
		end
	end
end

--- Скорость в плоскости XZ (для соседей при столкновениях).
function Kart:velocityXZ(): (number, number)
	return math.sin(self.moveHeading) * self.speed + self.pushX, math.cos(self.moveHeading) * self.speed + self.pushZ
end

return Kart
