-- Упаковка состояния карта и снимка, расстановка монет/кристаллов, реестр трасс.
game = { GetService = function(_, n) return { IsServer = function() return true end } end }
local Tracks = require("Tracks")
local Kart = require("Kart")
local Net = require("Net")
local Layout = require("Layout")
local tr = Tracks.get("sakura")
assert(Tracks.get("sakura") == tr)
local k = Kart.new(tr, { stats = { speed = 3, accel = 3, handling = 3 } })
k:placeAt(123.4, 2.5)
k.speed = 31.25; k.lapsDone = 2; k.coins = 7; k.airborne = true
k.drift.active = true; k.drift.dir = -1; k.drift.level = 2
k:addBoost(1, 1.3, "boost2")
k.shieldTimer = 3
local s = Net.fromKart(5, k)
local b = buffer.create(Net.KART_BYTES)
Net.writeKart(b, 0, s)
local r = Net.readKart(b, 0)
for _, f in { "id", "lapsDone", "coins", "driftLevel", "boostKind", "airborne", "drifting", "shield", "frozen", "finished" } do
	assert(r[f] == s[f], "field " .. f .. ": " .. tostring(r[f]) .. " vs " .. tostring(s[f]))
end
assert(r.driftDir == -1)
for _, f in { "x", "y", "z", "heading", "speed", "progress", "lateral" } do
	assert(math.abs(r[f] - s[f]) < 1e-3, "float " .. f)
end
local karts = {}
for i = 1, 8 do local c = table.clone(s); c.id = i; table.insert(karts, c) end
local snap = Net.packSnapshot(1234.5, karts, { { id = 3, x = 1, y = 2, z = 3 } })
print("snapshot bytes", buffer.len(snap))
assert(buffer.len(snap) < 900)
local t, ks, orbs = Net.unpackSnapshot(snap)
assert(t == 1234.5 and #ks == 8 and ks[8].id == 8 and #orbs == 1 and orbs[1].z == 3)
for _, id in { "sakura", "neon", "sunset", "momiji" } do
	local T = Tracks.get(id)
	print(id, "boxes", #Layout.boxes(T), "coins", #Layout.coins(T))
end
local seed = 1
local function rnd() seed = (seed * 16807) % 2147483647; return seed / 2147483647 end
local cnt = {}
for i = 1, 2000 do local it = Layout.rollItem(i % 2 == 0 and 0 or 1, rnd); cnt[it] = (cnt[it] or 0) + 1 end
print("items", cnt.turbo, cnt.orb, cnt.shield, cnt.ice)
print("NET OK")
