--!strict
-- Сеть: ремоуты и упаковка состояния карта в buffer (UnreliableRemoteEvent ограничен ~900 байт).
--
--   KartState  (Unreliable, клиент → сервер): свой карт, ~20 раз в секунду
--   Snapshot   (Unreliable, сервер → клиенты): все карты + летящие сферы
--   Race       (RemoteEvent, сервер → клиент): фазы гонки, предметы, попадания, итоги — (kind, data)
--   Action     (RemoteEvent, клиент → сервер): подобрал монету/кристалл, применил предмет, наехал на лёд
--   Shop       (RemoteFunction): купить / выбрать гонщика
local RunService = game:GetService("RunService")

local Net = {}

local NAMES = {
	KartState = "UnreliableRemoteEvent",
	Snapshot = "UnreliableRemoteEvent",
	Race = "RemoteEvent",
	Action = "RemoteEvent",
	Shop = "RemoteFunction",
}

local folder: Folder? = nil

function Net.folder(): Folder
	if folder then
		return folder
	end
	local RS = game:GetService("ReplicatedStorage")
	if RunService:IsServer() then
		local f = RS:FindFirstChild("SakuraRemotes") :: Folder?
		if not f then
			local nf = Instance.new("Folder")
			nf.Name = "SakuraRemotes"
			for name, class in NAMES do
				local r = Instance.new(class)
				r.Name = name
				r.Parent = nf
			end
			nf.Parent = RS
			f = nf
		end
		folder = f
	else
		folder = RS:WaitForChild("SakuraRemotes") :: Folder
	end
	return folder :: Folder
end

function Net.get(name: string): any
	local f = Net.folder()
	return if RunService:IsServer() then f:FindFirstChild(name) else f:WaitForChild(name)
end

-- ---------------------------------------------------------------- упаковка карта

local BOOST_KINDS = { "", "pad", "boost1", "boost2", "boost3", "item", "draft", "rocket", "trick" }
local BOOST_CODE = {}
for i, k in BOOST_KINDS do
	BOOST_CODE[k] = i - 1
end
Net.BOOST_KINDS = BOOST_KINDS

Net.KART_BYTES = 38

--- Состояние карта для сети: то, что нужно соседям для отрисовки, столкновений, слипстрима и ботам сервера.
export type KartNet = {
	id: number,
	x: number,
	y: number,
	z: number,
	heading: number,
	moveHeading: number,
	speed: number,
	progress: number,
	lateral: number,
	lapsDone: number,
	airborne: boolean,
	drifting: boolean,
	driftDir: number,
	finished: boolean,
	shield: boolean,
	frozen: boolean,
	spinning: boolean,
	offroad: boolean,
	driftLevel: number,
	boostKind: string,
	coins: number,
	trick: boolean,
}

function Net.fromKart(id: number, k): KartNet
	return {
		id = id,
		x = k.pos.X,
		y = k.pos.Y,
		z = k.pos.Z,
		heading = k.heading,
		moveHeading = k.moveHeading,
		speed = k.speed,
		progress = k.progress,
		lateral = k.lateral,
		lapsDone = k.lapsDone,
		airborne = k.airborne,
		drifting = k.drift.active,
		driftDir = k.drift.dir,
		finished = k.finished == true,
		shield = k.shieldTimer > 0,
		frozen = k.frozenTimer > 0,
		spinning = k.spinTimer > 0 or k.launchSpin > 0,
		offroad = k.offroad,
		driftLevel = if k.drift.active then k.drift.level else 0,
		boostKind = if k.boost.time > 0 then k.boost.kind else "",
		coins = k.coins,
		trick = k.trick.active,
	}
end

local function bit(b: boolean, n: number): number
	return if b then 2 ^ n else 0
end

function Net.writeKart(b: buffer, o: number, s: KartNet)
	buffer.writeu8(b, o, s.id)
	buffer.writef32(b, o + 1, s.x)
	buffer.writef32(b, o + 5, s.y)
	buffer.writef32(b, o + 9, s.z)
	buffer.writef32(b, o + 13, s.heading)
	buffer.writef32(b, o + 17, s.moveHeading)
	buffer.writef32(b, o + 21, s.speed)
	buffer.writef32(b, o + 25, s.progress)
	buffer.writef32(b, o + 29, s.lateral)
	buffer.writei8(b, o + 33, math.clamp(s.lapsDone, -100, 100))
	local flags = bit(s.airborne, 0)
		+ bit(s.drifting, 1)
		+ bit(s.driftDir > 0, 2)
		+ bit(s.finished, 3)
		+ bit(s.shield, 4)
		+ bit(s.frozen, 5)
		+ bit(s.spinning, 6)
		+ bit(s.offroad, 7)
	buffer.writeu8(b, o + 34, flags)
	buffer.writeu8(b, o + 35, math.clamp(s.driftLevel, 0, 3) + (BOOST_CODE[s.boostKind] or 0) * 4)
	buffer.writeu8(b, o + 36, math.clamp(s.coins, 0, 255))
	buffer.writeu8(b, o + 37, bit(s.trick, 0))
end

function Net.readKart(b: buffer, o: number): KartNet
	local flags = buffer.readu8(b, o + 34)
	local function has(n: number): boolean
		return math.floor(flags / 2 ^ n) % 2 == 1
	end
	local lv = buffer.readu8(b, o + 35)
	return {
		id = buffer.readu8(b, o),
		x = buffer.readf32(b, o + 1),
		y = buffer.readf32(b, o + 5),
		z = buffer.readf32(b, o + 9),
		heading = buffer.readf32(b, o + 13),
		moveHeading = buffer.readf32(b, o + 17),
		speed = buffer.readf32(b, o + 21),
		progress = buffer.readf32(b, o + 25),
		lateral = buffer.readf32(b, o + 29),
		lapsDone = buffer.readi8(b, o + 33),
		airborne = has(0),
		drifting = has(1),
		driftDir = if has(2) then 1 else -1,
		finished = has(3),
		shield = has(4),
		frozen = has(5),
		spinning = has(6),
		offroad = has(7),
		driftLevel = lv % 4,
		boostKind = BOOST_KINDS[math.floor(lv / 4) + 1] or "",
		coins = buffer.readu8(b, o + 36),
		trick = buffer.readu8(b, o + 37) % 2 == 1,
	}
end

--- Снимок: серверное время, карты, сферы { id, x, y, z }.
function Net.packSnapshot(t: number, karts: { KartNet }, orbs: { { id: number, x: number, y: number, z: number } }): buffer
	local n = #karts
	local m = #orbs
	local b = buffer.create(8 + 1 + n * Net.KART_BYTES + 1 + m * 13)
	buffer.writef64(b, 0, t)
	buffer.writeu8(b, 8, n)
	local o = 9
	for _, s in karts do
		Net.writeKart(b, o, s)
		o += Net.KART_BYTES
	end
	buffer.writeu8(b, o, m)
	o += 1
	for _, orb in orbs do
		buffer.writeu8(b, o, orb.id % 256)
		buffer.writef32(b, o + 1, orb.x)
		buffer.writef32(b, o + 5, orb.y)
		buffer.writef32(b, o + 9, orb.z)
		o += 13
	end
	return b
end

function Net.unpackSnapshot(b: buffer)
	local t = buffer.readf64(b, 0)
	local n = buffer.readu8(b, 8)
	local karts = table.create(n)
	local o = 9
	for _ = 1, n do
		table.insert(karts, Net.readKart(b, o))
		o += Net.KART_BYTES
	end
	local m = buffer.readu8(b, o)
	o += 1
	local orbs = table.create(m)
	for _ = 1, m do
		table.insert(orbs, { id = buffer.readu8(b, o), x = buffer.readf32(b, o + 1), y = buffer.readf32(b, o + 5), z = buffer.readf32(b, o + 9) })
		o += 13
	end
	return t, karts, orbs
end

return Net
