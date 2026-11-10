--!strict
-- Трасса: замкнутая ось из сэмплов (выгружена из веб-версии) с локальными базисами.
-- Нужна и физике (проекция карта на трассу), и постройке геометрии. Всё в метрах; в мир Роблокса
-- переводит Config.SCALE.

local Track = {}
Track.__index = Track

export type Frame = {
	pos: Vector3,
	tan: Vector3,
	right: Vector3,
	up: Vector3,
	hw: number,
	wall: number,
	curv: number,
	f: number,
	index: number,
	progress: number,
	lateral: number?,
	height: number?,
	nearest: number?,
}

local Y = Vector3.new(0, 1, 0)

function Track.new(data)
	local self = setmetatable({}, Track)
	self.data = data
	local S = data.samples
	local N = #S
	self.count = N
	self.length = data.length
	self.spacing = data.spacing
	self.pos = table.create(N)
	self.tan = table.create(N)
	self.right = table.create(N)
	self.up = table.create(N)
	self.hw = table.create(N)
	self.wall = table.create(N)
	self.bank = table.create(N)
	self.curv = table.create(N)
	self.flags = table.create(N)
	-- индексы 0..N-1 (как в веб-версии), хранение — в [i + 1]
	for i = 1, N do
		local s = S[i]
		self.pos[i] = Vector3.new(s[1], s[2], s[3])
		self.hw[i] = s[4]
		self.wall[i] = s[5]
		self.bank[i] = s[6]
		self.curv[i] = s[7]
		self.flags[i] = s[8]
	end
	for i = 1, N do
		local a = self.pos[((i - 2) % N) + 1]
		local b = self.pos[(i % N) + 1]
		local t = (b - a).Unit
		self.tan[i] = t
		local r = t:Cross(Y).Unit
		local u0 = r:Cross(t).Unit
		local phi = self.bank[i]
		local rb = (r * math.cos(phi) + u0 * math.sin(phi)).Unit
		self.right[i] = rb
		self.up[i] = rb:Cross(t).Unit
	end
	-- габариты и сетка для запросов "расстояние до трассы"
	local minV, maxV = self.pos[1], self.pos[1]
	self.cell = 24
	self.grid = {}
	for i = 1, N do
		local p = self.pos[i]
		minV = minV:Min(p)
		maxV = maxV:Max(p)
		local key = self:_key(math.floor(p.X / self.cell), math.floor(p.Z / self.cell))
		local arr = self.grid[key]
		if not arr then
			arr = {}
			self.grid[key] = arr
		end
		table.insert(arr, i - 1)
	end
	self.boundsMin = minV
	self.boundsMax = maxV
	-- зоны бустеров и трамплинов (прогресс s0..s1, поперечный центр и полуширина)
	self.boostZones = {}
	for _, p in data.pads do
		table.insert(self.boostZones, { s0 = p.s0, s1 = p.s0 + p.len, lat = p.lat, halfW = p.halfW })
	end
	self.rampZones = {}
	for _, r in data.ramps do
		table.insert(self.rampZones, { s0 = r.s0, s1 = r.s0 + r.len, len = r.len, lat = r.lat, halfW = r.halfW, height = r.height })
	end
	return self
end

function Track:_key(cx: number, cz: number): number
	return cx * 73856093 + cz * 19349663
end

function Track:wrapIndex(i: number): number
	return i % self.count
end

function Track:wrapF(f: number): number
	return f % self.count
end

--- Разница прогресса b - a по кратчайшему пути вдоль петли.
function Track:deltaProgress(a: number, b: number): number
	local L = self.length
	local d = b - a
	if d > L / 2 then
		d -= L
	elseif d < -L / 2 then
		d += L
	end
	return d
end

--- Интерполированный базис в дробном индексе f (0-based, как в веб-версии).
function Track:frameAt(f: number, out: any?): Frame
	local o = out or {}
	local N = self.count
	f = f % N
	local i = math.floor(f)
	local j = (i + 1) % N
	local t = f - i
	local a, b = i + 1, j + 1
	o.pos = self.pos[a]:Lerp(self.pos[b], t)
	o.tan = self.tan[a]:Lerp(self.tan[b], t).Unit
	o.right = self.right[a]:Lerp(self.right[b], t).Unit
	o.up = self.up[a]:Lerp(self.up[b], t).Unit
	o.hw = self.hw[a] + (self.hw[b] - self.hw[a]) * t
	o.wall = self.wall[a] + (self.wall[b] - self.wall[a]) * t
	o.curv = self.curv[a] + (self.curv[b] - self.curv[a]) * t
	o.f = f
	o.index = i
	o.progress = f * self.spacing
	return o
end

function Track:frameAtProgress(s: number, out: any?): Frame
	return self:frameAt(s / self.spacing, out)
end

--- Точка на трассе: прогресс s, поперечное смещение lat, высота h над дорогой.
function Track:pointAt(s: number, lat: number?, h: number?): Vector3
	local fr = self:frameAt(s / self.spacing)
	return fr.pos + fr.right * (lat or 0) + fr.up * (h or 0)
end

local function dist2(p: Vector3, q: Vector3): number
	local dx = p.X - q.X
	local dy = (p.Y - q.Y) * 1.5
	local dz = p.Z - q.Z
	return dx * dx + dy * dy + dz * dz
end

function Track:nearestGlobal(p: Vector3): number
	local best, bestD = 0, math.huge
	for i = 1, self.count do
		local d = dist2(p, self.pos[i])
		if d < bestD then
			bestD = d
			best = i - 1
		end
	end
	return best
end

function Track:nearestLocal(p: Vector3, hint: number): number
	local N = self.count
	local P = self.pos
	local i = hint % N
	local d = dist2(p, P[i + 1])
	-- окно ±6 для надёжности, потом градиентный спуск
	for k = -6, 6 do
		local j = (i + k) % N
		local dj = dist2(p, P[j + 1])
		if dj < d then
			d = dj
			i = j
		end
	end
	for _ = 1, 400 do
		local a = (i + 1) % N
		local b = (i - 1) % N
		local da = dist2(p, P[a + 1])
		local db = dist2(p, P[b + 1])
		if da < d and da <= db then
			i, d = a, da
		elseif db < d then
			i, d = b, db
		else
			break
		end
	end
	return i
end

--- Проекция точки на трассу: поля frameAt + lateral, height, nearest.
function Track:project(p: Vector3, hint: number?, out: any?): Frame
	local i0 = if hint == nil or hint < 0 then self:nearestGlobal(p) else self:nearestLocal(p, hint)
	local a = self.pos[i0 + 1]
	local t = self.tan[i0 + 1]
	local along = (p - a):Dot(t)
	local f = i0 + math.clamp(along / self.spacing, -1, 1)
	local o = self:frameAt(f, out)
	local v = p - o.pos
	o.lateral = v:Dot(o.right)
	o.height = v:Dot(o.up)
	o.nearest = i0
	return o
end

--- Горизонтальное расстояние от (x, z) до оси (по сэмплам) и индекс ближайшего сэмпла.
function Track:distanceTo(x: number, z: number, maxDist: number?): (number, number)
	local c = self.cell
	local cx, cz = math.floor(x / c), math.floor(z / c)
	local reach = math.ceil((maxDist or 80) / c)
	local best, bestI = math.huge, -1
	for dx = -reach, reach do
		for dz = -reach, reach do
			local arr = self.grid[self:_key(cx + dx, cz + dz)]
			if arr then
				for _, i in arr do
					local q = self.pos[i + 1]
					local ddx, ddz = x - q.X, z - q.Z
					local d = ddx * ddx + ddz * ddz
					if d < best then
						best = d
						bestI = i
					end
				end
			end
		end
	end
	return math.sqrt(best), bestI
end

--- Максимальная |кривизна| на отрезке прогресса [s, s + len].
function Track:maxCurvatureAhead(s: number, len: number): number
	local i0 = math.floor(s / self.spacing)
	local n = math.ceil(len / self.spacing)
	local m = 0
	for k = 0, n do
		local c = math.abs(self.curv[((i0 + k) % self.count) + 1])
		if c > m then
			m = c
		end
	end
	return m
end

--- Средняя кривизна на отрезке [s, s + len] (для ботов).
function Track:avgCurv(s: number, len: number): number
	local i0 = math.floor(s / self.spacing)
	local n = math.max(1, math.ceil(len / self.spacing))
	local sum = 0
	for k = 0, n do
		sum += self.curv[((i0 + k) % self.count) + 1]
	end
	return sum / (n + 1)
end

--- Высота трамплина в доле u ∈ [0, 1] его длины (как rampHeightAt в веб-версии).
function Track.rampHeightAt(zone, u: number): number
	u = math.clamp(u, 0, 1)
	return zone.height * u * u * (1.2 - 0.2 * u)
end

return Track
