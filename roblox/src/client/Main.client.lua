--!strict
-- Клиент «Sakura Drift»: свой карт считается здесь (Shared/Kart — та же физика, что в веб-версии),
-- соперники — по снимкам сервера с плавным сглаживанием. Камера, HUD, звук и подбор монет/кристаллов.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Tracks = require(Shared.Tracks)
local Kart = require(Shared.Kart)
local Bot = require(Shared.Bot)
local Net = require(Shared.Net)
local Characters = require(Shared.Characters)

local Input = require(script.Parent.Input)
local Hud = require(script.Parent.Hud)
local World = require(script.Parent.World)
local KartModel = require(script.Parent.KartModel)
local Audio = require(script.Parent.Audio)

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local SC = Config.SCALE

local RE_State = Net.get("KartState") :: UnreliableRemoteEvent
local RE_Snap = Net.get("Snapshot") :: UnreliableRemoteEvent
local RE_Race = Net.get("Race") :: RemoteEvent
local RE_Action = Net.get("Action") :: RemoteEvent
local RF_Shop = Net.get("Shop") :: RemoteFunction

pcall(function()
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Health, false)
end)

local CHAR_BY_ID = {}
for _, c in Characters do
	CHAR_BY_ID[c.id] = c
end

local function now(): number
	return workspace:GetServerTimeNow()
end

-- ---------------------------------------------------------------- состояние

local R: any = nil -- текущая гонка (после "setup")
local profile: any = nil
local myKey = "p" .. player.UserId

local function clearRace()
	if not R then
		return
	end
	for _, rk in R.remote do
		rk.model:destroy()
	end
	if R.myModel then
		R.myModel:destroy()
	end
	for _, o in R.orbs do
		o:Destroy()
	end
	World.clearTraps()
	Audio.stopEngine()
	R = nil
end

local function setupRace(d)
	clearRace()
	local track = Tracks.get(d.trackId)
	local built = World.build(d.trackId)
	World.clearTraps()
	for _, b in built.boxes do
		b.active = true
		b.timer = 0
	end
	for _, c in built.coins do
		c.t = 0
	end
	for _, e in d.boxes or {} do
		World.setBoxTaken(e[1], e[2])
	end
	for _, e in d.coins or {} do
		World.setCoinTaken(e[1], e[2])
	end
	for _, t in d.traps or {} do
		World.addTrap(t.id, t.x, t.y, t.z, t.s, t.lat)
	end
	local r = {
		track = track,
		trackId = d.trackId,
		laps = d.laps,
		raceNum = d.raceNum,
		raceCount = d.raceCount,
		myId = d.myId,
		roster = {},
		remote = {},
		orbs = {},
		finishPlace = {},
		kart = nil,
		myModel = nil,
		item = nil,
		roulette = 0,
		launched = false,
		finished = false,
		autopilot = nil,
		lastStage = 0,
		sendAcc = 0,
		camHeading = nil,
		camPos = nil,
		lastPlace = 0,
		raceStart = d.raceStart or 0,
		wrongWay = false,
	}
	for _, e in d.roster do
		r.roster[e.id] = e
		local c = CHAR_BY_ID[e.charId] or Characters[1]
		if e.id ~= d.myId then
			local m = KartModel.new(c, e.name, false)
			m:setParent(built.folder)
			r.remote[e.id] = { model = m, net = nil, disp = nil, heading = 0, recv = 0, hint = -1, up = Vector3.yAxis, roster = e }
		end
	end
	if d.myId > 0 then
		local me = r.roster[d.myId]
		local c = CHAR_BY_ID[me.charId] or Characters[1]
		local k = Kart.new(track, { stats = c.stats, isPlayer = true })
		local L = track.length
		local slot = d.myId - 1
		local row, col = math.floor(slot / 2), slot % 2
		local fr0 = track:frameAtProgress(L - 8)
		k:placeAt(L - 8 - row * 6.5 - col * 3, (if col == 0 then -1 else 1) * fr0.hw * 0.42)
		k.lapsDone = -1
		k.totalProgress = -L + k.progress
		k.onGrid = true
		r.kart = k
		r.myModel = KartModel.new(c, me.name, true)
		r.myModel:setParent(built.folder)
		if d.phase == "race" then
			-- подключились посреди гонки (переподключение) — сразу в путь
			k:launch()
			r.launched = true
		end
	end
	R = r
	World.setLights(0)
	Audio.playMusic(track.data.music)
	Audio.setMusicSpeed(1)
	if r.kart then
		Audio.startEngine()
	end
end

-- ---------------------------------------------------------------- сеть

RE_Snap.OnClientEvent:Connect(function(b: buffer)
	if not R then
		return
	end
	local t, karts, orbs = Net.unpackSnapshot(b)
	local recv = now()
	for _, s in karts do
		local rk = R.remote[s.id]
		if rk then
			if not rk.net or t >= (rk.netT or 0) then
				rk.net = s
				rk.netT = t
				rk.recv = recv
			end
		end
	end
	-- сферы
	local seen = {}
	for _, o in orbs do
		seen[o.id] = true
		local p = R.orbs[o.id]
		if not p then
			p = Instance.new("Part")
			p.Shape = Enum.PartType.Ball
			p.Anchored = true
			p.CanCollide = false
			p.CanQuery = false
			p.CanTouch = false
			p.Material = Enum.Material.Neon
			p.Color = Color3.fromRGB(255, 122, 230)
			p.Size = Vector3.one * 1.1 * SC
			local light = Instance.new("PointLight")
			light.Color = p.Color
			light.Range = 18
			light.Brightness = 3
			light.Parent = p
			p.Parent = workspace
			R.orbs[o.id] = p
		end
		p:SetAttribute("tx", o.x)
		p:SetAttribute("ty", o.y)
		p:SetAttribute("tz", o.z)
	end
	for id, p in R.orbs do
		if not seen[id] then
			p:Destroy()
			R.orbs[id] = nil
		end
	end
end)

local LAUNCH_TEXT = {
	perfect = { "ИДЕАЛЬНЫЙ СТАРТ!", Color3.fromRGB(60, 255, 120) },
	good = { "ХОРОШИЙ СТАРТ", Color3.fromRGB(80, 200, 110) },
	spin = { "ПЕРЕГАЗОВКА!", Color3.fromRGB(255, 60, 70) },
}

local function onRace(kind: string, d: any)
	if kind == "profile" then
		profile = d
		Hud.setProfile(d)
	elseif kind == "setup" then
		setupRace(d)
	elseif kind == "lobby" then
		clearRace()
	elseif not R then
		return
	elseif kind == "go" then
		R.raceStart = d.raceStart
	elseif kind == "roulette" then
		R.roulette = d.time
		R.pendingItem = d.item
		Audio.sfx("roulette", 0.7)
	elseif kind == "item" then
		R.roulette = 0
		R.item = d.item
		Audio.sfx("itemGet", 0.8)
	elseif kind == "boost" and R.kart then
		R.kart:addBoost(d.time, d.power, d.kind)
		Audio.sfx("boost", 1)
	elseif kind == "shield" and R.kart then
		R.kart.shieldTimer = d.time
		Audio.sfx("shieldUp", 0.9)
	elseif kind == "hit" and R.kart then
		if R.kart:hit(d.kind) then
			Hud.callout(if d.kind == "freeze" then "ЗАМОРОЗКА!" else "ПОПАДАНИЕ!", Color3.fromRGB(255, 80, 120))
		end
	elseif kind == "hitFx" then
		if d.by == R.myId and d.id ~= R.myId then
			local who = R.roster[d.id]
			Hud.callout("Попал в " .. (if who then who.name else "соперника") .. "!", Color3.fromRGB(160, 90, 255))
		end
	elseif kind == "boxTaken" then
		World.setBoxTaken(d.i)
	elseif kind == "coinTaken" then
		if d.by ~= R.myId then
			World.setCoinTaken(d.i)
		end
	elseif kind == "trapAdd" then
		World.addTrap(d.id, d.x, d.y, d.z, d.s, d.lat)
		if d.by == R.myId then
			Audio.sfx("trapDrop", 0.8)
		end
	elseif kind == "trapRemove" then
		World.removeTrap(d.id)
		if d.burst then
			Audio.sfx("shatter", 0.5)
		end
	elseif kind == "orbFire" then
		Audio.sfx("orbFire", if d.id == R.myId then 0.9 else 0.4)
	elseif kind == "orbEnd" then
		Audio.sfx("hit", 0.5)
	elseif kind == "finish" then
		R.finishPlace[d.id] = d.place
		local who = R.roster[d.id]
		if d.id == R.myId then
			R.myFinishTime = d.time
			Hud.big(string.format("ФИНИШ — %d МЕСТО!", d.place), if d.place <= 3 then Color3.fromRGB(255, 200, 40) else nil, 2.5)
			Audio.sfx(if d.place <= 3 then "finishWin" else "finishLose", 1)
		elseif who then
			Hud.callout(string.format("%s финишировал%s %d-м", who.name, "", d.place), Color3.fromRGB(90, 80, 130), 1.4)
		end
	elseif kind == "results" then
		Hud.showResults(d, R.myId, myKey)
		Audio.playMusic("results")
		Audio.setMusicSpeed(1)
		Audio.stopEngine()
	elseif kind == "reward" then
		Hud.showReward(d)
	elseif kind == "leave" then
		local rk = R.remote[d.id]
		if rk then
			rk.model:destroy()
			R.remote[d.id] = nil
		end
	end
end
RE_Race.OnClientEvent:Connect(onRace)

-- ---------------------------------------------------------------- гонка: свой карт

local function sendState()
	if not R or not R.kart then
		return
	end
	local b = buffer.create(Net.KART_BYTES)
	Net.writeKart(b, 0, Net.fromKart(R.myId, R.kart))
	RE_State:FireServer(b)
end

local function remoteVel(s): (number, number)
	return math.sin(s.moveHeading) * s.speed, math.cos(s.moveHeading) * s.speed
end

local BOOST_TEXT = { "МИНИ-ТУРБО!", "СУПЕР-ТУРБО!", "УЛЬТРА-ТУРБО!" }

local function handleKartEvents(k)
	for _, e in k.events do
		Audio.kartEvent(e)
		local t = e.type
		if t == "boostFire" then
			Hud.callout(BOOST_TEXT[e.level] or "ТУРБО!", KartModel.DRIFT_COLORS[e.level])
		elseif t == "slipstream" then
			Hud.callout("СЛИПСТРИМ!", Color3.fromRGB(150, 230, 255))
		elseif t == "trickBoost" then
			Hud.callout("ТРЮК!", Color3.fromRGB(120, 255, 170))
		elseif t == "coinLoss" then
			Hud.callout(string.format("−%d монеты", e.n), Color3.fromRGB(255, 160, 40))
		elseif t == "shieldBreak" then
			Hud.callout("БАРЬЕР СПАС!", Color3.fromRGB(73, 216, 255))
		elseif t == "wrongWay" then
			R.wrongWay = e.on
		elseif t == "launch" then
			local lt = LAUNCH_TEXT[e.result]
			if lt then
				Hud.callout(lt[1], lt[2], 1.8)
			end
		elseif t == "lapCross" and e.forward and R.launched and not R.finished then
			if k.lapsDone >= R.laps then
				R.finished = true
				k.finished = true
				R.autopilot = Bot.new(k, Bot.DIFFICULTY.hard, function()
					return math.random()
				end)
				Audio.setMusicSpeed(1)
			elseif k.lapsDone >= 1 then
				if k.lapsDone == R.laps - 1 then
					Hud.big("ФИНАЛЬНЫЙ КРУГ!", Color3.fromRGB(255, 80, 120), 1.6)
					Audio.sfx("finalLap", 1)
					local fk = R.track.data.music .. "_final"
					if (Config.Sounds.music :: any)[fk] and (Config.Sounds.music :: any)[fk] ~= "" then
						Audio.playMusic(fk)
					else
						Audio.setMusicSpeed(1.06)
					end
				else
					Hud.callout(string.format("КРУГ %d/%d", k.lapsDone + 1, R.laps), Color3.fromRGB(57, 243, 255))
					Audio.sfx("lap", 0.9)
				end
			end
		end
	end
	table.clear(k.events)
end

local function pickups(k)
	local w = World.current()
	if not w then
		return
	end
	local p = k.pos
	for i, b in w.boxes do
		if b.active then
			local dx, dz, dy = p.X - b.pos.X, p.Z - b.pos.Z, p.Y + 0.8 - b.pos.Y
			if dx * dx + dz * dz < 2.3 * 2.3 and math.abs(dy) < 2.4 then
				World.setBoxTaken(i)
				RE_Action:FireServer("box", i)
				Audio.sfx("itemBox", 0.8)
			end
		end
	end
	for i, c in w.coins do
		if c.t <= 0 then
			local dx, dz = p.X - c.pos.X, p.Z - c.pos.Z
			if dx * dx + dz * dz <= 1.75 * 1.75 and math.abs(p.Y + 0.9 - c.pos.Y) <= 2.2 then
				World.setCoinTaken(i)
				k:addCoin()
				RE_Action:FireServer("coin", i)
			end
		end
	end
	for id, t in w.traps do
		if t.age >= 0.35 and not k.airborne then
			local dx, dz, dy = p.X - t.pos.X, p.Z - t.pos.Z, p.Y - t.pos.Y
			if dx * dx + dz * dz < 1.7 * 1.7 and math.abs(dy) < 1.6 then
				World.removeTrap(id)
				RE_Action:FireServer("trap", id)
				if k:hit("freeze") then
					Hud.callout("ЗАМОРОЗКА!", Color3.fromRGB(120, 200, 255))
				end
			end
		end
	end
end

local SUBSTEP = 1 / 120

local function stepMyKart(dt: number, phase: string, t: number, inp)
	local k = R.kart
	if phase == "countdown" then
		local stage = math.min(4, math.floor(t / (Config.COUNT_TIME / 3)) + 1)
		if stage ~= R.lastStage then
			R.lastStage = stage
			World.setLights(stage)
			if stage <= 3 then
				Hud.big(tostring(4 - stage), nil, 0.8)
				Audio.sfx("countdown", 0.9)
			end
		end
		k:revOnGrid(dt, inp.throttle)
		handleKartEvents(k)
		return
	end
	if phase ~= "race" then
		return
	end
	if not R.launched then
		R.launched = true
		World.setLights(4)
		Hud.big("СТАРТ!", Color3.fromRGB(60, 255, 120), 1)
		Audio.sfx("go", 1)
		k:launch()
	end
	local drive
	if R.finished and R.autopilot then
		drive = R.autopilot:think(dt, { karts = { k }, order = { k }, laps = R.laps })
		drive.useItem = false
		drive.useBoost = false
	else
		drive = { steer = inp.steer, throttle = inp.throttle, brake = inp.brake, driftHeld = inp.driftHeld, driftPressed = inp.driftPressed }
		if inp.item and R.item and (R.roulette or 0) <= 0 then
			RE_Action:FireServer("use")
			R.item = nil
		end
		if inp.boost then
			k:useBoost()
		end
	end
	local steps = math.min(6, math.max(1, math.ceil(dt / SUBSTEP - 0.05)))
	local h = dt / steps
	for _ = 1, steps do
		k:step(h, drive)
		drive.driftPressed = false
		for _, rk in R.remote do
			local s = rk.net
			if s and rk.disp then
				local vx, vz = remoteVel(s)
				k:collideWith(rk.disp.X, rk.disp.Y, rk.disp.Z, vx, vz, s.shield)
			end
		end
	end
	local others = {}
	for _, rk in R.remote do
		local s = rk.net
		if s then
			table.insert(others, { progress = s.progress, lateral = s.lateral, y = rk.disp and rk.disp.Y or s.y, speed = s.speed })
		end
	end
	k:updateDraft(dt, others)
	if not R.finished then
		pickups(k)
	end
	if R.roulette > 0 then
		R.roulette -= dt
	end
	handleKartEvents(k)
end

local function updateRemotes(dt: number)
	local tnow = now()
	local track = R.track
	for _, rk in R.remote do
		local s = rk.net
		if s then
			local age = math.clamp(tnow - rk.recv, 0, 0.25)
			local vx, vz = remoteVel(s)
			local target = Vector3.new(s.x + vx * age, s.y, s.z + vz * age)
			if not rk.disp or (rk.disp - target).Magnitude > 12 then
				rk.disp = target
				rk.heading = s.heading
			else
				local a = 1 - math.exp(-dt * 14)
				rk.disp = rk.disp:Lerp(target, a)
				local dh = (s.heading - rk.heading + math.pi) % (2 * math.pi) - math.pi
				rk.heading += dh * a
			end
			local pr = track:project(rk.disp, rk.hint)
			rk.hint = pr.nearest
			rk.up = rk.up:Lerp(if s.airborne then Vector3.yAxis else pr.up, 1 - math.exp(-dt * 10)).Unit
			rk.model:update(dt, {
				pos = rk.disp,
				heading = rk.heading,
				surfaceUp = rk.up,
				airborne = s.airborne,
				drifting = s.drifting,
				driftDir = s.driftDir,
				driftLevel = s.driftLevel,
				boostKind = s.boostKind,
				shield = s.shield,
				frozen = s.frozen,
				spinning = s.spinning,
				trick = s.trick,
			})
		end
	end
	for _, p in R.orbs do
		local tx = p:GetAttribute("tx") :: number?
		if tx then
			local target = Vector3.new(tx, p:GetAttribute("ty") :: number, p:GetAttribute("tz") :: number) * SC
			p.Position = p.Position:Lerp(target, 1 - math.exp(-dt * 20))
		end
	end
end

local function myModelUpdate(dt: number)
	local k = R.kart
	if not k or not R.myModel then
		return
	end
	R.myModel:update(dt, {
		pos = k.pos,
		heading = k.heading,
		surfaceUp = k.surfaceUp,
		airborne = k.airborne,
		drifting = k.drift.active,
		driftDir = k.drift.dir,
		driftLevel = k.drift.level,
		boostKind = if k.boost.time > 0 then k.boost.kind else "",
		shield = k.shieldTimer > 0,
		frozen = k.frozenTimer > 0,
		spinning = k.spinTimer > 0 or k.launchSpin > 0,
		trick = k.trick.active,
	})
end

-- ---------------------------------------------------------------- места

local function computeOrder()
	local L = R.track.length
	local list = {}
	if R.kart then
		table.insert(list, { id = R.myId, total = R.kart.totalProgress, me = true })
	end
	for id, rk in R.remote do
		local s = rk.net
		if s then
			table.insert(list, { id = id, total = s.lapsDone * L + s.progress, me = false })
		end
	end
	table.sort(list, function(a, b)
		local fa, fb = R.finishPlace[a.id], R.finishPlace[b.id]
		if fa and fb then
			return fa < fb
		end
		if fa or fb then
			return fa ~= nil
		end
		if a.total ~= b.total then
			return a.total > b.total
		end
		return a.id < b.id
	end)
	return list
end

-- ---------------------------------------------------------------- камера

local function lerpAngle(a: number, b: number, t: number): number
	local d = (b - a + math.pi) % (2 * math.pi) - math.pi
	return a + d * t
end

local function chaseCam(dt: number, pos: Vector3, heading: number, speed: number, boosting: boolean)
	if not R.camHeading then
		R.camHeading = heading
	end
	R.camHeading = lerpAngle(R.camHeading, heading, 1 - math.exp(-dt * 6))
	local h = R.camHeading
	local fwd = Vector3.new(math.sin(h), 0, math.cos(h))
	local want = pos - fwd * 6.4 + Vector3.new(0, 2.5, 0)
	if not R.camPos or (R.camPos - want).Magnitude > 30 then
		R.camPos = want
	end
	R.camPos = R.camPos:Lerp(want, 1 - math.exp(-dt * 12))
	local look = pos + fwd * 3 + Vector3.new(0, 1.0, 0)
	camera.CameraType = Enum.CameraType.Scriptable
	camera.CFrame = CFrame.lookAt(R.camPos * SC, look * SC)
	local fov = 70 + math.clamp(math.abs(speed) / 40, 0, 1.4) * 10 + (if boosting then 8 else 0)
	camera.FieldOfView += (fov - camera.FieldOfView) * (1 - math.exp(-dt * 4))
end

local orbitT = 0
local function orbitCam(dt: number, center: Vector3, radius: number, height: number, speedRad: number)
	orbitT += dt * speedRad
	local p = center + Vector3.new(math.cos(orbitT) * radius, height, math.sin(orbitT) * radius)
	camera.CameraType = Enum.CameraType.Scriptable
	camera.CFrame = CFrame.lookAt(p * SC, center * SC)
	camera.FieldOfView = 70
end

-- ---------------------------------------------------------------- кнопки гаража

Hud.init({
	buy = function(id: string)
		local ok, res = pcall(function()
			return RF_Shop:InvokeServer("buy", id)
		end)
		if ok and res then
			if res.owned[id] then
				Audio.sfx("uiStart", 0.8)
			else
				Audio.sfx("uiBack", 0.8)
			end
			profile = res
			Hud.setProfile(res)
		end
	end,
	select = function(id: string)
		local ok, res = pcall(function()
			return RF_Shop:InvokeServer("select", id)
		end)
		if ok and res then
			Audio.sfx("uiSelect", 0.8)
			profile = res
			Hud.setProfile(res)
		end
	end,
})

-- фон лобби
World.build(Config.TRACK_ORDER[1])
Audio.playMusic("menu")
RE_Action:FireServer("hello")

-- ---------------------------------------------------------------- главный цикл

RunService.RenderStepped:Connect(function(dt: number)
	dt = math.min(dt, 0.1)
	local phase = ReplicatedStorage:GetAttribute("SD_Phase") or "lobby"
	local phaseStart = ReplicatedStorage:GetAttribute("SD_PhaseStart") or now()
	local t = now() - phaseStart
	World.update(dt)

	if phase == "lobby" or not R then
		if R then
			clearRace()
		end
		Audio.playMusic("menu")
		Hud.setMode("lobby")
		if phase == "lobby" then
			local left = math.max(0, math.ceil(Config.LOBBY_TIME - t))
			Hud.banner(
				"SAKURA DRIFT GP",
				string.format("Гран-при начнётся через %d с · выберите гонщика в гараже", left)
			)
		else
			Hud.banner("SAKURA DRIFT GP", "Подключаемся к гонке…")
		end
		local w = World.current()
		if w then
			local tr = w.track
			local c = (tr.boundsMin + tr.boundsMax) / 2
			local ext = (tr.boundsMax - tr.boundsMin).Magnitude
			orbitCam(dt, c, ext * 0.45, ext * 0.22, 0.05)
		end
		return
	end

	local inp = Input.read()
	local k = R.kart

	if k then
		stepMyKart(dt, phase, t, inp)
		myModelUpdate(dt)
		R.sendAcc += dt
		if R.sendAcc >= 1 / 20 and (phase == "intro" or phase == "countdown" or phase == "race") then
			R.sendAcc = 0
			sendState()
		end
	end
	updateRemotes(dt)

	-- место и HUD
	local order = computeOrder()
	local myPlace = 1
	local rows = {}
	for i, o in order do
		if o.me then
			myPlace = i
		end
		local e = R.roster[o.id]
		local c = e and CHAR_BY_ID[e.charId]
		table.insert(rows, { name = if e then e.name else "?", me = o.me, color = c and Color3.fromHex(c.kart) })
	end

	if phase == "intro" then
		Hud.setMode("intro")
		local d = R.track.data
		Hud.banner(d.name .. "  " .. d.jp, string.format("Гонка %d из %d · %s · %d круга", R.raceNum, R.raceCount, d.time, R.laps))
		local u = math.clamp(t / Config.INTRO_TIME, 0, 1)
		local L = R.track.length
		local e = 1 - (1 - u) ^ 2
		local camS = (L - 8) + 80 * (1 - e) - 30 * e
		local p = R.track:pointAt(camS, 12 * (1 - e), 3 + 26 * (1 - e))
		local look = R.track:pointAt(L - 22, 0, 1)
		camera.CameraType = Enum.CameraType.Scriptable
		camera.CFrame = CFrame.lookAt(p * SC, look * SC)
		camera.FieldOfView = 70
		World.setLights(0)
	elseif phase == "countdown" or phase == "race" then
		if k then
			Hud.setMode(phase, { onGrid = phase == "countdown" })
			Hud.rev(k.rev, k.revCharge, phase == "countdown")
			local raceTime = if phase == "race" then (R.myFinishTime or (now() - phaseStart)) else 0
			Hud.race({
				place = myPlace,
				total = #order,
				lap = k.lapsDone + 1,
				laps = R.laps,
				speed = k.speed,
				meter = k.boostMeter,
				coins = k.coins,
				item = R.item,
				roulette = R.roulette,
				draft = k.draft,
				time = raceTime,
				finished = R.finished,
				order = rows,
			})
			if R.wrongWay and not R.finished then
				Hud.big("НЕ ТУДА!", Color3.fromRGB(255, 60, 70), 0.3)
			end
			if phase == "race" and myPlace ~= R.lastPlace and R.lastPlace > 0 and not R.finished then
				if myPlace < R.lastPlace then
					Audio.sfx("uiMove", 0.4)
				end
			end
			R.lastPlace = myPlace
			chaseCam(dt, k.pos, k:camHeading(), k.speed, k.boost.time > 0)
			Audio.updateEngine({
				dt = dt,
				rpm = k.rev,
				load = if phase == "countdown" then inp.throttle elseif k.boost.time > 0 then 1 else inp.throttle,
				limiter = k.revLimit > 0 or k.launchSpin > 0,
				drifting = k.drift.active and not k.airborne,
				driftLevel = k.drift.level,
				boosting = k.boost.time > 0,
			})
		else
			-- зритель: камера за лидером
			Hud.setMode("spectate")
			Hud.banner("ВЫ ЗРИТЕЛЬ", "Присоединитесь со следующей гонки")
			local lead = order[1]
			local rk = lead and R.remote[lead.id]
			if rk and rk.disp and rk.net then
				chaseCam(dt, rk.disp, rk.net.moveHeading, rk.net.speed, rk.net.boostKind ~= "")
			end
		end
	elseif phase == "results" then
		Hud.setMode("results")
		Audio.stopEngine()
		local focus = if k then k.pos else R.track:pointAt(0, 0, 0)
		orbitCam(dt, focus, 9, 4, 0.25)
		if k and R.finished and R.autopilot then
			-- карт докатывается сам
			local drive = R.autopilot:think(dt, { karts = { k }, order = { k }, laps = R.laps })
			drive.throttle *= 0.5
			k:step(dt, drive)
			table.clear(k.events)
		end
	end
end)
