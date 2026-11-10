-- Порт физики против эталона из веб-версии: тот же сценарий, сравнение позиции/скорости/шкалы каждые 0.5 с.
local Track = require("Track")
local Kart = require("Kart")
local ids = { "Sakura", "Neon", "Sunset", "Momiji" }
for _, id in ids do
	local tr = Track.new(require(id))
	local k = Kart.new(tr, { stats = { speed = 3, accel = 4, handling = 3 }, isPlayer = true })
	k:placeAt(tr.length - 8, -3)
	local dt = 1 / 120
	local on = false
	for _ = 1, 360 do
		local pred = k.rev + k.revVel * 0.08
		if pred < 0.68 then on = true elseif pred > 0.74 then on = false end
		k:revOnGrid(dt, if on then 1 else 0)
	end
	local launch = k:launch()
	local prevDrift = false
	local rows = {}
	for i = 0, 3599 do
		local t = i * dt
		local fr = tr:frameAtProgress(k.progress + 14)
		local desired = math.atan2(fr.pos.X - k.pos.X, fr.pos.Z - k.pos.Z)
		local dh = desired - k.moveHeading
		while dh > math.pi do dh -= 2 * math.pi end
		while dh < -math.pi do dh += 2 * math.pi end
		local steer = math.clamp(-dh * 2.8, -1, 1)
		local m = t % 6
		local driftHeld = m > 2 and m < 4.2
		local inp = { steer = steer, throttle = 1, brake = 0, driftHeld = driftHeld, driftPressed = driftHeld and not prevDrift }
		prevDrift = driftHeld
		if math.abs(t - 9) < dt / 2 or math.abs(t - 21) < dt / 2 then
			k.boostMeter = math.max(k.boostMeter, 2.2)
			k:useBoost()
		end
		k:step(dt, inp)
		table.clear(k.events)
		if i % 60 == 59 then
			table.insert(rows, string.format("%.3f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%d,%d,%d", t, k.pos.X, k.pos.Y, k.pos.Z, k.heading, k.speed, k.boostMeter, k.progress, k.lateral, k.lapsDone, if k.drift.active then 1 else 0, if k.airborne then 1 else 0))
		end
	end
	__out(id:lower() .. "|" .. launch .. "|" .. table.concat(rows, ";"))
end
