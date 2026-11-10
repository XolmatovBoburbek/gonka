-- Сервер + клиент вместе на заглушках Роблокса: Гран-при из двух гонок, игрок едет «автопилотом» через
-- обычный ввод клиента. Проверяем фазы, финиш, итоги, награды, кристаллы/монеты и отсутствие ошибок.
require("rbx_mock")
local Config = require("Config")
Config.LOBBY_TIME = 2
Config.RESULTS_TIME = 3
Config.TRACK_ORDER = { "sakura", "momiji" }

-- перехват карта игрока: ввод клиента будет решать бот (сложный) — так игрок реально проходит круги
local Kart = require("Kart")
local Bot = require("Bot")
local myKart = nil
local origNew = Kart.new
Kart.new = function(track, opts)
	local k = origNew(track, opts)
	if opts.isPlayer then myKart = k end
	return k
end

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local RS = game:GetService("ReplicatedStorage")
require("Main.server")
Players.PlayerAdded:Fire(__localPlayer)
local Input = require("Input")
local origRead = Input.read
local pilot, pilotKart = nil, nil
local revAim = 0
Input.read = function()
	local out = { steer = 0, throttle = 0, brake = 0, driftHeld = false, driftPressed = false, item = false, boost = false }
	if not myKart then return out end
	if pilotKart ~= myKart then pilotKart = myKart; pilot = Bot.new(myKart, Bot.DIFFICULTY.hard, math.random) end
	local phase = RS:GetAttribute("SD_Phase")
	if phase == "countdown" then
		out.throttle = pilot:revThrottle(1 / 30, __clock - RS:GetAttribute("SD_PhaseStart"))
		return out
	end
	if phase ~= "race" then return out end
	local d = pilot:think(1 / 30, { karts = { myKart }, order = { myKart }, laps = Config.LAPS })
	out.steer, out.throttle, out.brake, out.driftHeld, out.driftPressed = d.steer, d.throttle, d.brake, d.driftHeld, d.driftPressed
	out.boost = d.useBoost
	out.item = math.random() < 0.02
	return out
end

local Net = require("Net")
local log = { results = 0, rewards = 0, finishes = {}, phases = {}, items = 0, boxes = 0, coins = 0, setups = 0, snaps = 0 }
Net.get("Race").OnClientEvent:Connect(function(kind, d)
	if kind == "results" then log.results += 1; log.lastResults = d
	elseif kind == "reward" then log.rewards += 1; log.reward = d
	elseif kind == "finish" then table.insert(log.finishes, d)
	elseif kind == "item" then log.items += 1
	elseif kind == "boxTaken" then log.boxes += 1
	elseif kind == "coinTaken" then log.coins += 1
	elseif kind == "setup" then log.setups += 1
	end
end)
Net.get("Snapshot").OnClientEvent:Connect(function() log.snaps += 1 end)
require("Main.client")
__keys[Enum.KeyCode.W] = true
local r0 = origRead()
assert(r0.throttle == 1 and r0.steer == 0, "клавиатура: газ")
__keys[Enum.KeyCode.W] = nil

local dt = 1 / 30
local lastPhase = nil
local profileCoins = nil
Net.get("Race").OnClientEvent:Connect(function(kind, d) if kind == "profile" then profileCoins = d.coins end end)
for frame = 1, 30 * 600 do
	__clock += dt
	__runTasks()
	RunService.Heartbeat:Fire(dt)
	RunService.RenderStepped:Fire(dt)
	local ph = RS:GetAttribute("SD_Phase")
	if ph ~= lastPhase then
		table.insert(log.phases, string.format("%s@%.0f", ph, __clock))
		lastPhase = ph
	end
	if log.results >= 2 and ph == "lobby" then break end
end
print("phases:", table.concat(log.phases, " "))
print("setups", log.setups, "results", log.results, "rewards", log.rewards, "snapshots", log.snaps)
print("boxes taken", log.boxes, "items to player", log.items, "coins taken", log.coins)
local mine = 0
for _, f in log.finishes do if f.id then mine += 1 end end
print("finishes", #log.finishes)
if log.lastResults then
	for _, r in log.lastResults.list do
		print(string.format("  %d. %-8s %s %s +%d (%d)", r.place, r.name, r.isBot and "bot" or "YOU", r.finished and string.format("%.1f", r.time) or "DNF", r.gain, r.total))
	end
	print("final:", tostring(log.lastResults.final), "standings top:", log.lastResults.standings[1].name, log.lastResults.standings[1].total)
end
if log.reward then print("reward:", log.reward.collected, log.reward.placeBonus, log.reward.cupBonus, "total", log.reward.total, "wallet", profileCoins) end
assert(log.results == 2, "должно быть 2 итоговых таблицы")
assert(log.rewards == 2, "награды за обе гонки")
assert(#log.finishes >= 8, "все финишировали хотя бы в одной гонке")
print("GAME OK")
