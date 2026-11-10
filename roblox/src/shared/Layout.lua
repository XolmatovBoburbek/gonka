--!strict
-- Расстановка кристаллов с предметами и монет — одинаковая на сервере и клиенте (как в веб-версии),
-- поэтому по сети ходят только номера. Плюс выбор предмета по месту.
local Layout = {}

Layout.ITEMS = {
	turbo = { name = "Турбо", desc = "Мощный рывок вперёд", icon = "⚡" },
	orb = { name = "Звёздная сфера", desc = "Самонаводится на соперника впереди", icon = "✦" },
	shield = { name = "Барьер", desc = "Защищает от одного попадания", icon = "◈" },
	ice = { name = "Ледяная ловушка", desc = "Замораживает того, кто наедет", icon = "❄" },
}
Layout.ITEM_IDS = { "turbo", "orb", "shield", "ice" }

Layout.BOX_RESPAWN = 2.6
Layout.COIN_RESPAWN = 3.5

--- Кристаллы: ряды по 5 поперёк дороги. { s, lat, pos (м) }
function Layout.boxes(track)
	local out = {}
	for _, row in track.data.itemRows or {} do
		local s = row * track.length
		local fr = track:frameAtProgress(s)
		local n = 5
		for i = 0, n - 1 do
			local lat = (i / (n - 1) - 0.5) * 2 * fr.hw * 0.62
			table.insert(out, { s = s, lat = lat, pos = fr.pos + fr.right * lat + fr.up * 1.25 })
		end
	end
	return out
end

--- Монеты: цепочки по 5, детерминированно от длины трассы. { s, lat, pos (м) }
function Layout.coins(track)
	local L = track.length
	local seed = bit32.bxor(math.floor(L * 7 + 0.5), 0x5bd1e995)
	local function rnd(): number
		seed = (seed * 1664525 + 1013904223) % 4294967296
		return seed / 4294967296
	end
	local busy = {}
	for _, z in track.boostZones do
		table.insert(busy, { z.s0 - 10, z.s1 + 10 })
	end
	for _, z in track.rampZones do
		table.insert(busy, { z.s0 - 14, z.s1 + 30 })
	end
	for _, f in track.data.itemRows or {} do
		table.insert(busy, { f * L - 9, f * L + 9 })
	end
	local function free(a: number, b: number): boolean
		for _, r in busy do
			if not (b < r[1] or a > r[2]) then
				return false
			end
		end
		return true
	end
	local out = {}
	local s = 45
	while s < L - 40 do
		local len = 4 * 3.6
		if free(s, s + len) then
			local fr = track:frameAtProgress(s)
			local lim = fr.hw - 2.2
			local lat0 = (rnd() * 2 - 1) * lim
			local slope = 0
			if rnd() < 0.4 then
				slope = (if rnd() < 0.5 then -1 else 1) * (0.5 + rnd() * 0.5)
			end
			for i = 0, 4 do
				local cs = s + i * 3.6
				local lat = math.clamp(lat0 + slope * (i - 2) * 1.4, -lim, lim)
				table.insert(out, { s = cs, lat = lat, pos = track:pointAt(cs, lat, 0.95) })
			end
		end
		s += 70 + rnd() * 30
	end
	return out
end

--- Предмет по месту: лидерам — защита, отстающим — атака и турбо. placeFrac 0 (первый) .. 1 (последний).
function Layout.rollItem(placeFrac: number, rnd: () -> number): string
	local f = math.clamp(placeFrac, 0, 1)
	local w = {
		{ "turbo", 0.12 + 0.34 * f },
		{ "orb", 0.05 + 0.36 * f },
		{ "shield", 0.4 - 0.28 * f },
		{ "ice", 0.43 - 0.32 * f },
	}
	local total = 0
	for _, e in w do
		total += e[2]
	end
	local r = rnd() * total
	for _, e in w do
		r -= e[2]
		if r <= 0 then
			return e[1]
		end
	end
	return "turbo"
end

return Layout
