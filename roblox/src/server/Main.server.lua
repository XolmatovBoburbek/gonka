--!strict
-- Сервер «Sakura Drift»: Гран-при из четырёх трасс по кругу, боты добивают сетку до 8 картов.
-- Свой карт каждый игрок считает у себя (физика из Shared/Kart) и шлёт состояние ~20 раз в секунду;
-- сервер ведёт ботов, кристаллы, предметы, монеты, круги, места, очки и награды.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Tracks = require(Shared:WaitForChild("Tracks"))
local Kart = require(Shared:WaitForChild("Kart"))
local Bot = require(Shared:WaitForChild("Bot"))
local Layout = require(Shared:WaitForChild("Layout"))
local Net = require(Shared:WaitForChild("Net"))
local Cars = require(Shared:WaitForChild("Cars"))
local Profiles = require(script.Parent:WaitForChild("Profiles"))

Players.CharacterAutoLoads = false -- в гонке аватар не нужен: камера и карт — свои

local RE_State = Net.get("KartState") :: UnreliableRemoteEvent
local RE_Snap = Net.get("Snapshot") :: UnreliableRemoteEvent
local RE_Race = Net.get("Race") :: RemoteEvent
local RE_Action = Net.get("Action") :: RemoteEvent
local RF_Shop = Net.get("Shop") :: RemoteFunction

local rng = Random.new()
local function rnd(): number
	return rng:NextNumber()
end
local function now(): number
	return workspace:GetServerTimeNow()
end

-- ---------------------------------------------------------------- состояние

type Racer = {
	id: number,
	name: string,
	carId: string,
	paint: number,
	isBot: boolean,
	player: Player?,
	body: any, -- Kart (бот) или прокси игрока с теми же полями
	bot: any?,
	finished: boolean,
	finishTime: number?,
	coinsTotal: number,
	hitCd: number,
	lastPacket: number,
}

local S = {
	phase = "lobby",
	phaseStart = now(),
	trackId = Config.TRACK_ORDER[1],
	track = nil :: any,
	votes = {} :: { [Player]: string },
	pvp = false,
	racers = {} :: { Racer },
	byPlayer = {} :: { [Player]: Racer },
	order = {} :: { Racer },
	boxes = {} :: { any },
	coins = {} :: { any },
	orbs = {} :: { any },
	traps = {} :: { any },
	nextObjId = 1,
	raceStart = 0,
	firstHumanFinish = nil :: number?,
	allHumansDoneAt = nil :: number?,
	finishedCount = 0,
	lastResults = nil :: any,
	ready = {} :: { [Player]: boolean },
}

local diff = Bot.DIFFICULTY[Config.BOT_DIFFICULTY] or Bot.DIFFICULTY.normal

local function setPhase(phase: string)
	S.phase = phase
	S.phaseStart = now()
	ReplicatedStorage:SetAttribute("SD_Phase", phase)
	ReplicatedStorage:SetAttribute("SD_PhaseStart", S.phaseStart)
	ReplicatedStorage:SetAttribute("SD_Track", S.trackId)
end

local function sendAll(kind: string, data: any?)
	for p in S.ready do
		RE_Race:FireClient(p, kind, data)
	end
end

local function send(p: Player?, kind: string, data: any?)
	if p and S.ready[p] then
		RE_Race:FireClient(p, kind, data)
	end
end

local function humans(): { Racer }
	local out = {}
	for _, r in S.racers do
		if not r.isBot then
			table.insert(out, r)
		end
	end
	return out
end

-- ---------------------------------------------------------------- подготовка гонки

local function newProxy(track)
	return {
		track = track,
		pos = Vector3.zero,
		heading = 0,
		moveHeading = 0,
		speed = 0,
		progress = 0,
		lateral = 0,
		lapsDone = -1,
		totalProgress = 0,
		airborne = false,
		finished = false,
		shieldTimer = 0,
		item = nil,
		roulette = 0,
		pendingItem = nil,
		itemHeld = 0,
		net = nil,
		isProxy = true,
	}
end

local function gridPlace(track, slot: number): (number, number)
	local L = track.length
	local row = math.floor(slot / 2)
	local col = slot % 2
	local fr0 = track:frameAtProgress(L - 8)
	local lat = (if col == 0 then -1 else 1) * fr0.hw * 0.42
	return L - 8 - row * 6.5 - col * 3, lat
end

local function shuffle<T>(t: { T })
	for i = #t, 2, -1 do
		local j = rng:NextInteger(1, i)
		t[i], t[j] = t[j], t[i]
	end
end

local function rosterView()
	local list = {}
	for _, r in S.racers do
		table.insert(list, {
			id = r.id,
			name = r.name,
			carId = r.carId,
			paint = r.paint,
			isBot = r.isBot,
			userId = if r.player then r.player.UserId else 0,
		})
	end
	return list
end

local function boxState()
	local out = {}
	for i, b in S.boxes do
		if not b.active then
			table.insert(out, { i, b.timer })
		end
	end
	return out
end

local function coinState()
	local out = {}
	for i, c in S.coins do
		if c.t > 0 then
			table.insert(out, { i, c.t })
		end
	end
	return out
end

local function trapList()
	local out = {}
	for _, t in S.traps do
		table.insert(out, { id = t.id, s = t.s, lat = t.lat, x = t.pos.X, y = t.pos.Y, z = t.pos.Z })
	end
	return out
end

local function setupView(forPlayer: Player?)
	local me = if forPlayer then S.byPlayer[forPlayer] else nil
	return {
		trackId = S.trackId,
		laps = Config.LAPS,
		pvp = S.pvp,
		roster = rosterView(),
		myId = if me then me.id else 0,
		boxes = boxState(),
		coins = coinState(),
		traps = trapList(),
		phase = S.phase,
		phaseStart = S.phaseStart,
		raceStart = S.raceStart,
	}
end

local function voteCounts()
	local counts = {}
	for _, id in Config.TRACK_ORDER do
		counts[id] = 0
	end
	for p, id in S.votes do
		if p.Parent and counts[id] then
			counts[id] += 1
		end
	end
	return counts
end

local function pickTrack(): string
	local counts = voteCounts()
	local best, top = {}, 0
	for _, id in Config.TRACK_ORDER do
		if counts[id] > top then
			top = counts[id]
			best = { id }
		elseif counts[id] == top then
			table.insert(best, id)
		end
	end
	if top == 0 and #best > 1 then
		-- никто не голосовал — любая, кроме только что сыгранной
		local i = table.find(best, S.trackId)
		if i then
			table.remove(best, i)
		end
	end
	return best[rng:NextInteger(1, #best)]
end

local function startRace()
	S.trackId = pickTrack()
	S.votes = {}
	local track = Tracks.get(S.trackId)
	S.track = track
	S.racers = {}
	S.byPlayer = {}
	S.orbs = {}
	S.traps = {}
	S.finishedCount = 0
	S.firstHumanFinish = nil
	S.allHumansDoneAt = nil

	-- кто едет: все готовые игроки (до 8). Боты — только если игрок один (или так задано в Config)
	local entries = {}
	for p in S.ready do
		local prof = Profiles.get(p)
		if p.Parent and prof and #entries < Config.MAX_KARTS then
			local car = Cars.get(prof.car)
			if not prof.cars[car.id] then
				car = Cars.list[1]
			end
			table.insert(entries, { player = p, name = p.DisplayName, carId = car.id, paint = math.clamp(prof.paint or 1, 1, #Cars.paints) })
		end
	end
	shuffle(entries)
	S.pvp = #entries >= 2
	local nb = math.min(Config.MAX_KARTS - #entries, if S.pvp then Config.BOTS_PVP else Config.BOTS_SOLO)
	local bots = {}
	for i = 1, nb do
		local car = Cars.list[rng:NextInteger(1, #Cars.list)]
		table.insert(bots, { name = "Бот " .. car.name, carId = car.id, paint = rng:NextInteger(1, #Cars.paints) })
	end
	-- боты занимают первые ряды, игроки — за ними
	for _, e in entries do
		table.insert(bots, e)
	end
	entries = bots

	for slot, e in entries do
		local s0, lat = gridPlace(track, slot - 1)
		local c = Cars.get(e.carId)
		local r: Racer = {
			id = slot,
			name = e.name,
			carId = e.carId,
			paint = e.paint,
			isBot = e.player == nil,
			player = e.player,
			body = nil,
			bot = nil,
			finished = false,
			finishTime = nil,
			coinsTotal = 0,
			hitCd = 0,
			lastPacket = 0,
		}
		if r.isBot then
			local k = Kart.new(track, { stats = c.stats })
			k:placeAt(s0, lat)
			k.lapsDone = -1
			k.totalProgress = -track.length + k.progress
			k.botSpeed = diff.speed * (0.985 + rnd() * 0.03)
			k.item = nil
			k.roulette = 0
			k.itemHeld = 0
			k.onGrid = true
			r.body = k
			r.bot = Bot.new(k, diff, rnd)
		else
			local px = newProxy(track)
			local fr = track:frameAtProgress(s0)
			px.pos = fr.pos + fr.right * lat
			px.heading = math.atan2(fr.tan.X, fr.tan.Z)
			px.moveHeading = px.heading
			px.progress = s0
			px.lateral = lat
			px.totalProgress = -track.length + s0
			r.body = px
			S.byPlayer[e.player] = r
		end
		table.insert(S.racers, r)
	end
	S.order = table.clone(S.racers)

	S.boxes = {}
	for _, b in Layout.boxes(track) do
		table.insert(S.boxes, { s = b.s, lat = b.lat, pos = b.pos, active = true, timer = 0 })
	end
	S.coins = {}
	for _, c in Layout.coins(track) do
		table.insert(S.coins, { s = c.s, lat = c.lat, pos = c.pos, t = 0 })
	end

	setPhase("intro")
	for p in S.ready do
		RE_Race:FireClient(p, "setup", setupView(p))
	end
end

local function goLobby()
	S.votes = {}
	S.lastResults = nil
	setPhase("lobby")
	sendAll("lobby", {})
	sendAll("votes", voteCounts())
end

-- ---------------------------------------------------------------- предметы

local function placeFrac(r: Racer): number
	local idx = table.find(S.order, r) or 1
	return (idx - 1) / math.max(1, #S.order - 1)
end

local function racerOfBody(body): Racer?
	for _, r in S.racers do
		if r.body == body then
			return r
		end
	end
	return nil
end

local function giveBox(r: Racer)
	local b = r.body
	if b.item == nil and (b.roulette or 0) <= 0 then
		b.roulette = if r.isBot then 0.9 + rnd() * 0.5 else 1.35
		b.pendingItem = Layout.rollItem(placeFrac(r), rnd)
		send(r.player, "roulette", { item = b.pendingItem, time = b.roulette })
	end
end

local function hitRacer(r: Racer, kind: string, by: Racer?)
	if r.finished then
		return
	end
	local b = r.body
	if r.isBot then
		b:hit(kind)
	else
		if r.hitCd > 0 then
			return
		end
		r.hitCd = if kind == "freeze" then 2.6 else 2.2
		if b.shieldTimer > 0 then
			b.shieldTimer = 0
			r.hitCd = 0.6
		end
		send(r.player, "hit", { kind = kind, by = if by then by.id else 0 })
	end
	sendAll("hitFx", { id = r.id, kind = kind, by = if by then by.id else 0 })
end

local function fireOrb(r: Racer)
	local b = r.body
	local idx = table.find(S.order, r) or 1
	local target = if idx > 1 then S.order[idx - 1] else nil
	local pos = b.pos + Vector3.new(math.sin(b.heading) * 2.2, 0.9, math.cos(b.heading) * 2.2)
	local id = S.nextObjId
	S.nextObjId += 1
	table.insert(S.orbs, {
		id = id,
		owner = r,
		target = target,
		body = target and target.body,
		s = b.progress + 2.2,
		lat = b.lateral,
		pos = pos,
		speed = math.max(62, b.speed + 22),
		life = 7,
		age = 0,
		idx = S.track:project(pos, -1).nearest,
	})
	sendAll("orbFire", { id = r.id })
end

local function dropTrap(r: Racer)
	local b = r.body
	local tr = S.track
	local s = b.progress - 3.2
	local fr = tr:frameAtProgress(s)
	local lat = math.clamp(b.lateral, -fr.hw - 1, fr.hw + 1)
	local pos = fr.pos + fr.right * lat
	local id = S.nextObjId
	S.nextObjId += 1
	local t = { id = id, owner = r, s = s, lat = lat, pos = pos, age = 0 }
	table.insert(S.traps, t)
	sendAll("trapAdd", { id = id, s = s, lat = lat, x = pos.X, y = pos.Y, z = pos.Z, by = r.id })
	if #S.traps > 12 then
		local old = table.remove(S.traps, 1)
		sendAll("trapRemove", { id = old.id, burst = false })
	end
end

local function removeTrap(t, burst: boolean)
	local i = table.find(S.traps, t)
	if i then
		table.remove(S.traps, i)
		sendAll("trapRemove", { id = t.id, burst = burst })
	end
end

local function useItem(r: Racer): boolean
	local b = r.body
	local item = b.item
	if not item or (b.roulette or 0) > 0 then
		return false
	end
	b.item = nil
	b.itemHeld = 0
	if item == "turbo" then
		if r.isBot then
			b:addBoost(2.0, 1.42, "item")
		else
			send(r.player, "boost", { time = 2.0, power = 1.42, kind = "item" })
		end
	elseif item == "shield" then
		b.shieldTimer = 7.5
		send(r.player, "shield", { time = 7.5 })
	elseif item == "orb" then
		fireOrb(r)
	elseif item == "ice" then
		dropTrap(r)
	end
	sendAll("itemUsed", { id = r.id, item = item })
	return true
end

local function updateItems(dt: number)
	local tr = S.track
	-- кристаллы
	for i, bx in S.boxes do
		if not bx.active then
			bx.timer -= dt
			if bx.timer <= 0 then
				bx.active = true
			end
		else
			for _, r in S.racers do
				if r.isBot and not r.finished then
					local k = r.body
					local dx, dz = k.pos.X - bx.pos.X, k.pos.Z - bx.pos.Z
					local dy = k.pos.Y + 0.8 - bx.pos.Y
					if dx * dx + dz * dz < 2.3 * 2.3 and math.abs(dy) < 2.4 then
						bx.active = false
						bx.timer = Layout.BOX_RESPAWN
						sendAll("boxTaken", { i = i, by = r.id })
						giveBox(r)
						break
					end
				end
			end
		end
	end
	-- рулетка и удержание предмета
	for _, r in S.racers do
		local b = r.body
		if (b.roulette or 0) > 0 then
			b.roulette -= dt
			if b.roulette <= 0 then
				b.item = b.pendingItem
				b.itemHeld = 0
				send(r.player, "item", { item = b.item })
			end
		elseif b.item then
			b.itemHeld += dt
		end
		if r.hitCd > 0 then
			r.hitCd -= dt
		end
		if not r.isBot and b.shieldTimer > 0 then
			b.shieldTimer -= dt
		end
	end
	-- сферы
	for i = #S.orbs, 1, -1 do
		local o = S.orbs[i]
		o.age += dt
		o.life -= dt
		local homing = false
		local tb = o.body
		if tb and not (o.target and o.target.finished) then
			local d = (o.pos - tb.pos).Magnitude
			local ds = tr:deltaProgress(o.s, tb.progress)
			if d < 16 or (ds < 12 and ds > -4) then
				homing = true
			else
				o.lat += (tb.lateral - o.lat) * (1 - math.exp(-dt * 2.5))
			end
		end
		if homing then
			local tgt = tb.pos + Vector3.new(0, 0.8, 0)
			local dir = tgt - o.pos
			local len = dir.Magnitude
			if len > 1e-3 then
				o.pos += dir / len * math.min(len, o.speed * dt)
			end
			local p = tr:project(o.pos, o.idx)
			o.idx = p.nearest
			o.s = p.f * tr.spacing
			o.lat = p.lateral
		else
			o.s += o.speed * dt
			local fr = tr:frameAtProgress(o.s)
			local lim = fr.hw + fr.wall - 1
			o.lat = math.clamp(o.lat, -lim, lim)
			o.pos = fr.pos + fr.right * o.lat + fr.up * 0.9
			o.idx = fr.index
		end
		local done = o.life <= 0
		if not done then
			for _, r in S.racers do
				if not (r == o.owner and o.age < 0.6) and not (r.finished and r ~= o.target) then
					local k = r.body
					local dx, dy, dz = k.pos.X - o.pos.X, k.pos.Y + 0.8 - o.pos.Y, k.pos.Z - o.pos.Z
					-- у игроков позиция приходит с задержкой — радиус чуть больше
					local R = if r.isBot then 1.9 else 2.6
					if dx * dx + dy * dy + dz * dz < R * R then
						hitRacer(r, "spin", o.owner)
						done = true
						break
					end
				end
			end
		end
		if not done then
			for _, t in S.traps do
				if (t.pos - o.pos).Magnitude < 2 then
					removeTrap(t, true)
					done = true
					break
				end
			end
		end
		if done then
			table.remove(S.orbs, i)
			sendAll("orbEnd", { id = o.id, x = o.pos.X, y = o.pos.Y, z = o.pos.Z })
		end
	end
	-- ловушки (ботов проверяет сервер, игроки сообщают сами)
	for i = #S.traps, 1, -1 do
		local t = S.traps[i]
		t.age += dt
		if t.age >= 0.35 then
			for _, r in S.racers do
				if r.isBot and not r.finished then
					local k = r.body
					local dx, dz, dy = k.pos.X - t.pos.X, k.pos.Z - t.pos.Z, k.pos.Y - t.pos.Y
					if dx * dx + dz * dz < 1.7 * 1.7 and math.abs(dy) < 1.6 and not k.airborne then
						hitRacer(r, "freeze", t.owner)
						removeTrap(t, true)
						break
					end
				end
			end
		end
	end
end

local function updateCoins(dt: number)
	for i, c in S.coins do
		if c.t > 0 then
			c.t -= dt
		else
			for _, r in S.racers do
				if r.isBot and not r.finished then
					local k = r.body
					local dx, dz = k.pos.X - c.pos.X, k.pos.Z - c.pos.Z
					if dx * dx + dz * dz <= 1.75 * 1.75 and math.abs(k.pos.Y + 0.9 - c.pos.Y) <= 2.2 then
						c.t = Layout.COIN_RESPAWN
						k:addCoin()
						r.coinsTotal += 1
						sendAll("coinTaken", { i = i, by = r.id })
						break
					end
				end
			end
		end
	end
end

-- ---------------------------------------------------------------- гонка

local function updateOrder()
	table.sort(S.order, function(a, b)
		if a.finished and b.finished then
			return (a.finishTime or 0) < (b.finishTime or 0)
		end
		if a.finished ~= b.finished then
			return a.finished
		end
		if a.body.totalProgress ~= b.body.totalProgress then
			return a.body.totalProgress > b.body.totalProgress
		end
		return a.id < b.id
	end)
end

local function finishRacer(r: Racer)
	if r.finished then
		return
	end
	r.finished = true
	r.body.finished = true
	r.finishTime = now() - S.raceStart
	S.finishedCount += 1
	if not r.isBot and not S.firstHumanFinish then
		S.firstHumanFinish = now()
	end
	sendAll("finish", { id = r.id, place = S.finishedCount, time = r.finishTime })
end

local function racingInput()
	return { steer = 0, throttle = 0, brake = 0, driftHeld = false, driftPressed = false, useItem = false, useBoost = false }
end

local function botView()
	local karts, order = {}, {}
	for _, r in S.racers do
		table.insert(karts, r.body)
	end
	for _, r in S.order do
		table.insert(order, r.body)
	end
	local traps = {}
	for _, t in S.traps do
		table.insert(traps, { s = t.s, lat = t.lat, id = t.id })
	end
	local orbs = {}
	for _, o in S.orbs do
		table.insert(orbs, { target = o.body, pos = o.pos })
	end
	local boxes = {}
	for _, b in S.boxes do
		table.insert(boxes, { s = b.s, lat = b.lat, active = b.active })
	end
	local coins = {
		ahead = function(_, s: number, maxDs: number)
			local best, bd = nil, maxDs
			for _, c in S.coins do
				if c.t <= 0 then
					local ds = S.track:deltaProgress(s, c.s)
					if ds > 5 and ds < bd then
						bd = ds
						best = c
					end
				end
			end
			return best
		end,
	}
	return { karts = karts, order = order, laps = Config.LAPS, boxes = boxes, traps = traps, orbs = orbs, coins = coins }
end

local SUBSTEP = 1 / 120

local function stepBots(dt: number, racing: boolean)
	local view = botView()
	-- резинка: боты держатся рядом со средним игроком
	local hs = humans()
	local avg = nil
	if #hs > 0 then
		local sum = 0
		for _, h in hs do
			sum += h.body.totalProgress
		end
		avg = sum / #hs
	end
	local inputs = {}
	for _, r in S.racers do
		if r.isBot then
			local k = r.body
			local inp
			if not racing then
				inp = racingInput()
			else
				inp = r.bot:think(dt, view)
				if r.finished then
					inp.useItem = false
					inp.useBoost = false
				end
				if inp.useItem and k.item then
					useItem(r)
				end
				if inp.useBoost then
					k:useBoost()
				end
				if avg then
					local gap = k.totalProgress - avg
					k.rubber = 1 + math.clamp(-gap / 260, -0.6, 1) * diff.rubber
				end
			end
			inputs[r] = inp
		end
	end
	local steps = math.min(6, math.max(1, math.ceil(dt / SUBSTEP - 0.05)))
	local h = dt / steps
	for _ = 1, steps do
		for r, inp in inputs do
			r.body:step(h, inp)
			inp.driftPressed = false
		end
		-- столкновения: бот толкает только себя; игроки — по последнему присланному положению
		for r in inputs do
			local k = r.body
			for _, o in S.racers do
				if o ~= r then
					local ob = o.body
					local vx = math.sin(ob.moveHeading) * ob.speed
					local vz = math.cos(ob.moveHeading) * ob.speed
					if not o.isBot then
						k:collideWith(ob.pos.X, ob.pos.Y, ob.pos.Z, vx, vz, ob.shieldTimer > 0)
					else
						local ovx, ovz = ob:velocityXZ()
						k:collideWith(ob.pos.X, ob.pos.Y, ob.pos.Z, ovx, ovz, ob.shieldTimer > 0)
					end
				end
			end
		end
	end
	for r in inputs do
		local k = r.body
		if racing then
			local others = {}
			for _, o in S.racers do
				if o ~= r then
					table.insert(others, { progress = o.body.progress, lateral = o.body.lateral, y = o.body.pos.Y, speed = o.body.speed })
				end
			end
			k:updateDraft(dt, others)
		end
		for _, e in k.events do
			if e.type == "lapCross" and e.forward and racing and not r.finished and k.lapsDone >= Config.LAPS then
				finishRacer(r)
			end
		end
		table.clear(k.events)
	end
end

local function revBots(dt: number, stateTime: number)
	for _, r in S.racers do
		if r.isBot then
			r.body:revOnGrid(dt, r.bot:revThrottle(dt, stateTime))
		end
	end
end

local function results()
	updateOrder()
	local hs = {}
	for _, r in S.order do
		if not r.isBot then
			table.insert(hs, r)
		end
	end
	local pvp = #hs >= 2
	local delta = {}
	for i, r in hs do
		if pvp then
			delta[r] = math.floor(Config.TROPHY_WIN + (Config.TROPHY_LOSE - Config.TROPHY_WIN) * (i - 1) / (#hs - 1) + 0.5)
		else
			delta[r] = 0
		end
	end
	local list = {}
	for place, r in S.order do
		table.insert(list, {
			id = r.id,
			name = r.name,
			carId = r.carId,
			paint = r.paint,
			isBot = r.isBot,
			place = place,
			time = r.finishTime,
			finished = r.finished,
			trophies = delta[r] or 0,
		})
	end
	local data = { list = list, pvp = pvp, trackId = S.trackId }
	S.lastResults = data
	sendAll("results", data)

	-- награды игрокам
	for place, r in S.order do
		local p = r.player
		local prof = p and Profiles.get(p)
		if p and p.Parent and prof then
			local reward = { collected = r.coinsTotal, placeBonus = Config.PLACE_COINS[place] or 0, trophies = delta[r] or 0, pvp = pvp, total = 0 }
			reward.total = reward.collected + reward.placeBonus
			prof.coins += reward.total
			prof.races = (prof.races or 0) + 1
			if pvp then
				prof.trophies = math.max(0, (prof.trophies or 0) + reward.trophies)
				if hs[1] == r then
					prof.wins = (prof.wins or 0) + 1
				end
			end
			Profiles.markDirty(p)
			Profiles.syncStats(p)
			send(p, "reward", reward)
			send(p, "profile", Profiles.view(p))
		end
	end
	setPhase("results")
end

local function snapshot()
	local karts = {}
	for _, r in S.racers do
		local st
		if r.isBot then
			st = Net.fromKart(r.id, r.body)
		else
			st = r.body.net
			if not st then
				st = {
					id = r.id,
					x = r.body.pos.X,
					y = r.body.pos.Y,
					z = r.body.pos.Z,
					heading = r.body.heading,
					moveHeading = r.body.moveHeading,
					speed = 0,
					progress = r.body.progress,
					lateral = r.body.lateral,
					lapsDone = -1,
					airborne = false,
					drifting = false,
					driftDir = 1,
					finished = false,
					shield = false,
					frozen = false,
					spinning = false,
					offroad = false,
					driftLevel = 0,
					boostKind = "",
					coins = 0,
					trick = false,
				}
			end
			st.id = r.id
			st.finished = r.finished
		end
		table.insert(karts, st)
	end
	local orbs = {}
	for _, o in S.orbs do
		table.insert(orbs, { id = o.id, x = o.pos.X, y = o.pos.Y, z = o.pos.Z })
	end
	RE_Snap:FireAllClients(Net.packSnapshot(now(), karts, orbs))
end

-- ---------------------------------------------------------------- сеть: от клиентов

RE_State.OnServerEvent:Connect(function(p: Player, b: any)
	if typeof(b) ~= "buffer" or buffer.len(b) ~= Net.KART_BYTES then
		return
	end
	local r = S.byPlayer[p]
	if not r or not (S.phase == "countdown" or S.phase == "race" or S.phase == "intro") then
		return
	end
	local ok, st = pcall(Net.readKart, b, 0)
	if not ok then
		return
	end
	for _, v in { st.x, st.y, st.z, st.heading, st.moveHeading, st.speed, st.progress, st.lateral } do
		if v ~= v or math.abs(v) > 1e5 then
			return
		end
	end
	local px = r.body
	local L = S.track.length
	if S.phase ~= "race" then
		-- до старта карт стоит на своём месте
		st.lapsDone = -1
	else
		-- круг засчитывается только при честном пересечении линии (прогресс перескочил конец трассы)
		local old = px.lapsDone
		if st.lapsDone > old then
			if st.lapsDone == old + 1 and px.progress > L * 0.6 and st.progress < L * 0.4 then
				px.lapsDone = st.lapsDone
			end
		elseif st.lapsDone < old then
			if st.lapsDone == old - 1 and px.progress < L * 0.4 and st.progress > L * 0.6 then
				px.lapsDone = st.lapsDone
			end
		end
		st.lapsDone = px.lapsDone
	end
	px.pos = Vector3.new(st.x, st.y, st.z)
	px.heading = st.heading
	px.moveHeading = st.moveHeading
	px.speed = math.clamp(st.speed, -20, 120)
	px.progress = math.clamp(st.progress, 0, L)
	px.lateral = st.lateral
	px.airborne = st.airborne
	px.totalProgress = px.lapsDone * L + px.progress
	px.net = st
	r.lastPacket = now()
	if S.phase == "race" and not r.finished and px.lapsDone >= Config.LAPS then
		finishRacer(r)
	end
end)

RE_Action.OnServerEvent:Connect(function(p: Player, kind: any, data: any)
	if kind == "hello" then
		-- профиль грузится из DataStore асинхронно — подождём его
		local waited = 0
		while not Profiles.get(p) and waited < 15 and p.Parent do
			waited += task.wait(0.2)
		end
		if not p.Parent then
			return
		end
		if not Profiles.get(p) then
			Profiles.load(p)
		end
		S.ready[p] = true
		send(p, "profile", Profiles.view(p))
		send(p, "votes", voteCounts())
		if S.phase ~= "lobby" and S.track then
			send(p, "setup", setupView(p))
			if S.phase == "results" and S.lastResults then
				send(p, "results", S.lastResults)
			end
		end
		return
	end
	if kind == "vote" then
		if S.phase == "lobby" and S.ready[p] and type(data) == "string" and table.find(Config.TRACK_ORDER, data) then
			S.votes[p] = data
			sendAll("votes", voteCounts())
		end
		return
	end
	local r = S.byPlayer[p]
	if not r or S.phase ~= "race" or r.finished then
		return
	end
	local body = r.body
	if kind == "use" then
		useItem(r)
	elseif kind == "box" and type(data) == "number" then
		local bx = S.boxes[data]
		if bx and bx.active and (bx.pos - body.pos).Magnitude < 12 then
			bx.active = false
			bx.timer = Layout.BOX_RESPAWN
			sendAll("boxTaken", { i = data, by = r.id })
			giveBox(r)
		end
	elseif kind == "coin" and type(data) == "number" then
		local c = S.coins[data]
		if c and c.t <= 0 and (c.pos - body.pos).Magnitude < 10 then
			c.t = Layout.COIN_RESPAWN
			r.coinsTotal += 1
			sendAll("coinTaken", { i = data, by = r.id })
		end
	elseif kind == "trap" and type(data) == "number" then
		for _, t in S.traps do
			if t.id == data and (t.pos - body.pos).Magnitude < 10 then
				r.hitCd = 2.6
				removeTrap(t, true)
				sendAll("hitFx", { id = r.id, kind = "freeze", by = t.owner.id })
				break
			end
		end
	end
end)

RF_Shop.OnServerInvoke = function(p: Player, action: any, id: any)
	local prof = Profiles.get(p)
	if not prof then
		return nil
	end
	local c = if type(id) == "string" then Cars.byId[id] else nil
	if action == "buy" and c and not prof.cars[c.id] then
		if prof.coins >= c.price then
			prof.coins -= c.price
			prof.cars[c.id] = true
			prof.car = c.id
			Profiles.save(p)
		end
	elseif action == "select" and c and prof.cars[c.id] then
		prof.car = c.id
		Profiles.markDirty(p)
	elseif action == "paint" and type(id) == "number" and Cars.paints[id] then
		prof.paint = id
		Profiles.markDirty(p)
	end
	return Profiles.view(p)
end

-- ---------------------------------------------------------------- игроки

Players.PlayerAdded:Connect(function(p)
	Profiles.load(p)
end)
for _, p in Players:GetPlayers() do
	task.spawn(Profiles.load, p)
end

Players.PlayerRemoving:Connect(function(p)
	S.ready[p] = nil
	S.votes[p] = nil
	local r = S.byPlayer[p]
	if r then
		S.byPlayer[p] = nil
		local i = table.find(S.racers, r)
		if i then
			table.remove(S.racers, i)
		end
		local j = table.find(S.order, r)
		if j then
			table.remove(S.order, j)
		end
		sendAll("leave", { id = r.id })
	end
	Profiles.release(p)
end)

-- ---------------------------------------------------------------- главный цикл

setPhase("lobby")

local snapAcc = 0
RunService.Heartbeat:Connect(function(dt: number)
	dt = math.min(dt, 0.1)
	local t = now() - S.phaseStart
	local readyCount = 0
	for p in S.ready do
		if p.Parent then
			readyCount += 1
		end
	end

	if S.phase == "lobby" then
		local need = math.max(Config.MIN_PLAYERS, if Config.BOTS_SOLO > 0 then 1 else 2)
		ReplicatedStorage:SetAttribute("SD_Need", need)
		ReplicatedStorage:SetAttribute("SD_Players", readyCount)
		if readyCount < need then
			S.phaseStart = now() -- ждём игроков
			ReplicatedStorage:SetAttribute("SD_PhaseStart", S.phaseStart)
		else
			-- все проголосовали — не тянем
			local voted = 0
			for p in S.votes do
				if p.Parent then
					voted += 1
				end
			end
			if voted >= readyCount and Config.LOBBY_TIME - t > 4 then
				S.phaseStart = now() - (Config.LOBBY_TIME - 4)
				ReplicatedStorage:SetAttribute("SD_PhaseStart", S.phaseStart)
			elseif t >= Config.LOBBY_TIME then
				startRace()
			end
		end
		return
	end

	if S.phase == "intro" then
		if t >= Config.INTRO_TIME then
			setPhase("countdown")
		end
	elseif S.phase == "countdown" then
		revBots(dt, t)
		if t >= Config.COUNT_TIME then
			for _, r in S.racers do
				if r.isBot then
					r.body:launch()
					table.clear(r.body.events)
				end
			end
			S.raceStart = now()
			setPhase("race")
			sendAll("go", { raceStart = S.raceStart })
		end
	end

	if S.phase == "intro" or S.phase == "countdown" or S.phase == "race" then
		local racing = S.phase == "race"
		stepBots(dt, racing)
		local hs = humans()
		if #hs == 0 then
			goLobby()
			return
		end
		if racing then
			updateItems(dt)
			updateCoins(dt)
			updateOrder()
			local allDone = true
			for _, h in hs do
				if not h.finished then
					allDone = false
				end
			end
			if allDone and not S.allHumansDoneAt then
				S.allHumansDoneAt = now()
			end
			local tnow = now()
			if
				(S.allHumansDoneAt and tnow - S.allHumansDoneAt > 3)
				or (S.firstHumanFinish and tnow - S.firstHumanFinish > Config.FINISH_TIMEOUT)
				or tnow - S.raceStart > Config.RACE_TIMEOUT
			then
				results()
			end
		end
		snapAcc += dt
		if snapAcc >= 1 / 20 then
			snapAcc = 0
			snapshot()
		end
	elseif S.phase == "results" then
		if t >= Config.RESULTS_TIME then
			goLobby()
		end
	end
end)
