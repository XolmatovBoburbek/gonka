--!strict
-- ИИ ботов (порт race/ai.js): гоночная траектория, торможение перед поворотами, дрифт и буст-шкала,
-- объезд ловушек и соперников, монеты и кристаллы, старт на оборотах, тактика предметов.
--
-- race — то, что бот видит: {
--   karts = { {progress, lateral, lapsDone, totalProgress, speed, item?} ... },  -- все карты, включая этого
--   order = { ... } (по местам), laps = число кругов,
--   boxes = { {s, lat, active} }, traps = { {s, lat, id} }, orbs = { {target, pos} },
--   coins = объект с :ahead(s, maxDs) -> {lat}?, stateTime = секунды с начала отсчёта
-- }

local Bot = {}
Bot.__index = Bot

Bot.DIFFICULTY = {
	easy = { id = "easy", label = "Лёгкий", speed = 0.87, skill = 0.25, rubber = 0.1, items = 0.35 },
	normal = { id = "normal", label = "Средний", speed = 0.95, skill = 0.62, rubber = 0.08, items = 0.7 },
	hard = { id = "hard", label = "Сложный", speed = 1.0, skill = 0.95, rubber = 0.06, items = 0.95 },
}

local function sign(x: number): number
	return if x > 0 then 1 elseif x < 0 then -1 else 0
end

local function wrapAngle(a: number): number
	while a > math.pi do
		a -= math.pi * 2
	end
	while a < -math.pi do
		a += math.pi * 2
	end
	return a
end

function Bot.new(kart, diff, rnd: () -> number)
	local self = setmetatable({}, Bot)
	self.kart = kart
	self.diff = diff
	self.rnd = rnd
	self.skill = math.clamp(diff.skill + (rnd() - 0.5) * 0.2, 0.05, 1)
	self.personal = (rnd() - 0.5) * 0.6
	self.lane = 0
	self.noise = rnd() * 100
	self.driftHold = false
	self.itemTimer = 0
	self.itemDelay = 0.6 + rnd() * 1.6 * (1.2 - diff.items)
	self.ignoreTraps = {}
	self.checkedTraps = {}
	self.driftCooldown = 0
	self.grid = nil
	return self
end

function Bot:think(dt: number, race)
	local k = self.kart
	local tr = k.track
	local out = { steer = 0, throttle = 1, brake = 0, driftHeld = false, driftPressed = false, useItem = false, useBoost = false }
	local s = k.progress
	local speed = math.abs(k.speed)
	local fr = tr:frameAtProgress(s)
	local hw = fr.hw
	self.noise += dt

	-- траектория: внутрь поворота
	local c = tr:avgCurv(s + 10, 45)
	local inside = -sign(c) * math.min(1, math.abs(c) * 32)
	local target = inside * hw * (0.25 + 0.4 * self.skill) + self.personal * hw * 0.55

	-- кристаллы с предметами
	if not k.item and (k.roulette or 0) <= 0 and race.boxes then
		local best, bestD = nil, 1e9
		for _, b in race.boxes do
			if b.active then
				local ds = tr:deltaProgress(s, b.s)
				if ds > 4 and ds < 50 then
					local d = math.abs(b.lat - self.lane) + ds * 0.05
					if d < bestD then
						bestD = d
						best = b
					end
				end
			end
		end
		if best and self.skill > 0.2 then
			target += (best.lat - target) * (0.5 + 0.4 * self.skill)
		end
	end

	-- монеты по пути
	if race.coins and self.skill > 0.2 and k.coins < 10 then
		local cn = race.coins:ahead(s, 32)
		if cn then
			target += (cn.lat - target) * (0.25 + 0.3 * self.skill)
		end
	end

	-- объезд ловушек
	if race.traps then
		for _, t in race.traps do
			local ds = tr:deltaProgress(s, t.s)
			if ds > 0 and ds < 38 then
				if not self.checkedTraps[t.id] then
					self.checkedTraps[t.id] = true
					if self.rnd() > 0.35 + 0.6 * self.skill then
						self.ignoreTraps[t.id] = true
					end
				end
				if not self.ignoreTraps[t.id] and math.abs(t.lat - target) < 3 then
					target = t.lat + (if target >= t.lat then 1 else -1) * 3.4
				end
			end
		end
	end

	-- обгон
	for _, o in race.karts do
		if o ~= k then
			local ds = tr:deltaProgress(s, o.progress)
			if ds > 0.5 and ds < 10 and math.abs(o.lateral - target) < 2.6 then
				local room = if o.lateral > 0 then -1 else 1
				target = o.lateral + room * 3.2
			end
		end
	end

	local lim = hw - 1.4
	target = math.clamp(target, -lim, lim)
	self.lane += (target - self.lane) * (1 - math.exp(-dt * (1.2 + 1.5 * self.skill)))

	-- руление к точке впереди (по направлению движения: в заносе нос смотрит внутрь поворота)
	local la = 7 + speed * 0.42
	local p = tr:pointAt(s + la, self.lane, 0)
	local desired = math.atan2(p.X - k.pos.X, p.Z - k.pos.Z)
	local diff = wrapAngle(desired - k.moveHeading)
	local steer = -diff * 2.8
	if self.skill < 0.6 then
		steer += math.sin(self.noise * 1.7) * 0.18 * (1 - self.skill)
	end
	out.steer = math.clamp(steer, -1, 1)

	-- задний ход, если развернуло
	if math.abs(diff) > 2.2 and speed < 6 then
		out.throttle = 0
		out.brake = 1
		out.steer = -out.steer
		return out
	end

	-- скорость перед поворотами
	local maxC = tr:maxCurvatureAhead(s, 8 + speed * 0.9)
	local cap = (if k.drift.active then 2.2 else 1.62) * k.handF
	local vSafe = cap / math.max(maxC, 1e-3)
	local margin = 1.0 + (1 - self.skill) * 0.08
	if speed > vSafe * margin * 1.28 then
		out.throttle = 0
		out.brake = 0.7
	elseif speed > vSafe * margin then
		out.throttle = 0.2
	end

	-- дрифт
	self.driftCooldown -= dt
	local curveNear = tr:avgCurv(s + 4, 28)
	if k.drift.active then
		local same = sign(curveNear) == sign(-k.drift.dir)
		local endOfCurve = math.abs(tr:avgCurv(s + 6, 14)) < 0.006
		if not same or endOfCurve then
			self.driftHold = false
			self.driftCooldown = 0.8
		else
			self.driftHold = true
		end
	elseif self.driftHold and not k.airborne then
		self.driftHold = false
	end
	if not k.drift.active and not k.airborne and self.driftCooldown <= 0 and self.skill > 0.3 and speed > 22 then
		if math.abs(curveNear) > 0.016 and math.abs(out.steer) > 0.3 and sign(out.steer) == -sign(curveNear) then
			if self.rnd() < dt * (1.5 + 4 * self.skill) then
				out.driftPressed = true
				self.driftHold = true
			end
		end
	end
	out.driftHeld = self.driftHold
	if k.drift.active then
		out.steer = math.clamp(out.steer * 1.15, -1, 1)
		if out.steer * k.drift.dir < -0.6 then
			out.steer = -0.6 * k.drift.dir -- долгий полный контр-руль переложил бы занос
		end
	end

	-- буст-шкала: копим в заносах, тратим на прямой
	if k.boostMeter >= 1 and k.boost.time <= 0 and not k.drift.active and not k.airborne and speed > 18 then
		local want = if self.skill > 0.8 then 3 elseif self.skill > 0.5 then 2 else 1
		local lvl = math.min(3, math.floor(k.boostMeter))
		local reach = ({ 45, 85, 140 })[lvl]
		local safe = tr:maxCurvatureAhead(s, reach + speed * 0.5) < 0.022
		local calm = tr:maxCurvatureAhead(s, 40) < 0.012
		local nearFinish = race.laps * tr.length - k.totalProgress < 160
		if (safe and calm and (lvl >= want or self.rnd() < dt * 0.3 * (1 - self.skill))) or nearFinish then
			out.useBoost = true
		end
	end

	-- трюк на трамплине
	if k.airborne and k.trick.canTrick and not k.trick.active and self.rnd() < dt * 6 * self.skill then
		out.driftPressed = true
	end

	-- предметы
	if k.item then
		self.itemTimer += dt
		if self.itemTimer > self.itemDelay then
			out.useItem = self:decideItem(race)
			if out.useItem then
				self.itemTimer = 0
				self.itemDelay = 0.5 + self.rnd() * 2 * (1.2 - self.diff.items)
			end
		end
	else
		self.itemTimer = 0
	end
	return out
end

--- Отсчёт: газ импульсами, чтобы стрелка оборотов стояла в зелёной зоне; точность — по навыку.
function Bot:revThrottle(dt: number, stateTime: number): number
	local k = self.kart
	local s = self.skill
	if not self.grid then
		local greedy = self.rnd() < 0.12 * (1 - s)
		self.grid = {
			start = 0.1 + self.rnd() * (0.5 + 1.8 * (1 - s)),
			aim = if greedy then 0.93 else 0.71 + (self.rnd() - 0.5) * 0.5 * (1.1 - s),
			react = 0.05 + 0.25 * (1 - s),
			t = 0,
			on = false,
		}
	end
	local g = self.grid
	if stateTime < g.start then
		return 0
	end
	g.t -= dt
	if g.t <= 0 then
		g.t = g.react * (0.6 + self.rnd() * 0.8)
		local pred = k.rev + k.revVel * 0.08
		if pred < g.aim - 0.03 then
			g.on = true
		elseif pred > g.aim + 0.03 then
			g.on = false
		end
	end
	return if g.on then 1 else 0
end

function Bot:decideItem(race): boolean
	local k = self.kart
	local tr = k.track
	local smart = self.diff.items
	local held = k.itemHeld or 0
	if self.rnd() > smart and held > 1.5 then
		return true
	end
	local order = race.order
	local idx = table.find(order, k) or 1
	local item = k.item
	if item == "turbo" then
		return tr:maxCurvatureAhead(k.progress, 70) < 0.02 or k.offroad or held > 6
	elseif item == "orb" then
		local ahead = if idx > 1 then order[idx - 1] else nil
		if not ahead then
			return held > 5
		end
		local ds = tr:deltaProgress(k.progress, ahead.progress) + (ahead.lapsDone - k.lapsDone) * tr.length
		return (ds > 3 and ds < 90) or held > 9
	elseif item == "shield" then
		local threat = false
		for _, o in race.orbs or {} do
			if o.target == k and (o.pos - k.pos).Magnitude < 50 then
				threat = true
			end
		end
		return threat or held > 2.5 + self.rnd() * 3
	elseif item == "ice" then
		local behind = if idx < #order then order[idx + 1] else nil
		if behind then
			local ds = tr:deltaProgress(behind.progress, k.progress)
			if ds > 2 and ds < 32 then
				return true
			end
		end
		return held > 7
	end
	return false
end

return Bot
