-- 8 ботов на каждой трассе, 3 круга: все должны финишировать, без застреваний.
local Track = require("Track")
local Kart = require("Kart")
local Bot = require("Bot")
local seed = 12345
local function rnd() seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 end
for _, id in { "Sakura", "Neon", "Sunset", "Momiji" } do
	for _, dname in { "easy", "normal", "hard" } do
		local tr = Track.new(require(id))
		local karts, bots = {}, {}
		for i = 0, 7 do
			local k = Kart.new(tr, { stats = { speed = 3, accel = 3, handling = 3 } })
			local row, col = math.floor(i / 2), i % 2
			local fr0 = tr:frameAtProgress(tr.length - 8)
			k:placeAt(tr.length - 8 - row * 6.5 - col * 3, (if col == 0 then -1 else 1) * fr0.hw * 0.42)
			k.botSpeed = Bot.DIFFICULTY[dname].speed * (0.985 + rnd() * 0.03)
			table.insert(karts, k)
			table.insert(bots, Bot.new(k, Bot.DIFFICULTY[dname], rnd))
		end
		local race = { karts = karts, order = karts, laps = 3 }
		local dt = 1 / 60
		-- отсчёт 3 с
		for f = 1, 180 do for i, k in karts do k:revOnGrid(dt, bots[i]:revThrottle(dt, f * dt)) end end
		local launches = {}
		for _, k in karts do table.insert(launches, k:launch()) end
		local t, times = 0, {}
		while t < 240 do
			t += dt
			local inputs = {}
			for i, k in karts do inputs[i] = bots[i]:think(dt, race) end
			for i, k in karts do
				if inputs[i].useBoost then k:useBoost() end
				for _ = 1, 2 do k:step(dt / 2, inputs[i]); inputs[i].driftPressed = false end
				if k.lapsDone >= 3 and not times[i] then times[i] = t; k.finished = true end
				table.clear(k.events)
			end
			for i, k in karts do
				for j, o in karts do
					if i ~= j then local vx, vz = o:velocityXZ(); k:collideWith(o.pos.X, o.pos.Y, o.pos.Z, vx, vz) end
				end
				local others = {}
				for j, o in karts do if i ~= j then table.insert(others, { progress = o.progress, lateral = o.lateral, y = o.pos.Y, speed = o.speed }) end end
				k:updateDraft(dt, others)
			end
			local done = 0
			for i in karts do if times[i] then done += 1 end end
			if done == 8 then break end
		end
		local parts, resp = {}, 0
		for i, k in karts do table.insert(parts, if times[i] then string.format("%.1f", times[i]) else "DNF") resp += k.respawns end
		print(string.format("%-7s %-6s %s  respawns=%d  launches=%s", id, dname, table.concat(parts, " "), resp, table.concat(launches, ",")))
	end
end
