--!strict
-- Профили игроков в DataStore: кошелёк монет, купленные гонщики, выбранный гонщик, лучшие кубки.
-- В Studio без включённого "Enable Studio Access to API Services" работает в памяти (с предупреждением).
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Config"))
local Cars = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Cars"))

local Profiles = {}

local store: DataStore? = nil
do
	local ok, res = pcall(function()
		return DataStoreService:GetDataStore(Config.DATASTORE)
	end)
	if ok then
		store = res
	else
		print("[SakuraDrift] DataStore недоступен (место не опубликовано?), прогресс пока хранится только до выхода:", res)
	end
end

local profiles: { [Player]: any } = {}
local dirty: { [Player]: boolean } = {}

local function defaults()
	local cars = {}
	for _, c in Cars.list do
		if c.price == 0 then
			cars[c.id] = true
		end
	end
	return { coins = 0, cars = cars, car = Cars.list[1].id, paint = 1, trophies = 0, races = 0, wins = 0 }
end

local function key(p: Player): string
	return "u" .. p.UserId
end

function Profiles.load(p: Player)
	local data = nil
	if store then
		for attempt = 1, 3 do
			local ok, res = pcall(function()
				return (store :: DataStore):GetAsync(key(p))
			end)
			if ok then
				data = res
				break
			end
			warn("[SakuraDrift] загрузка профиля, попытка", attempt, res)
			task.wait(1.5 * attempt)
		end
	end
	local prof = defaults()
	if type(data) == "table" then
		for k, v in data do
			prof[k] = v
		end
		if type(prof.cars) ~= "table" then
			prof.cars = {}
		end
		for id, v in defaults().cars do
			prof.cars[id] = v
		end
	end
	profiles[p] = prof
	-- таблица лидеров Роблокса (список игроков): кубки и победы
	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	local tr = Instance.new("IntValue")
	tr.Name = "Кубки"
	tr.Value = prof.trophies
	tr.Parent = ls
	local w = Instance.new("IntValue")
	w.Name = "Победы"
	w.Value = prof.wins
	w.Parent = ls
	if p:FindFirstChild("leaderstats") then
		(p:FindFirstChild("leaderstats") :: Instance):Destroy()
	end
	ls.Parent = p
	return prof
end

--- Обновить значения в списке игроков.
function Profiles.syncStats(p: Player)
	local prof = profiles[p]
	local ls = p:FindFirstChild("leaderstats")
	if prof and ls then
		local a = ls:FindFirstChild("Кубки")
		local b = ls:FindFirstChild("Победы")
		if a and a:IsA("IntValue") then
			a.Value = prof.trophies
		end
		if b and b:IsA("IntValue") then
			b.Value = prof.wins
		end
	end
end

function Profiles.get(p: Player)
	return profiles[p]
end

function Profiles.save(p: Player)
	local prof = profiles[p]
	if not prof or not store then
		return
	end
	dirty[p] = nil
	local ok, err = pcall(function()
		(store :: DataStore):SetAsync(key(p), prof)
	end)
	if not ok then
		warn("[SakuraDrift] сохранение профиля:", err)
		dirty[p] = true
	end
end

function Profiles.markDirty(p: Player)
	dirty[p] = true
end

function Profiles.release(p: Player)
	Profiles.save(p)
	profiles[p] = nil
	dirty[p] = nil
end

--- То, что видит клиент.
function Profiles.view(p: Player)
	local prof = profiles[p]
	if not prof then
		return nil
	end
	return { coins = prof.coins, cars = prof.cars, car = prof.car, paint = prof.paint, trophies = prof.trophies, races = prof.races, wins = prof.wins }
end

function Profiles.addCoins(p: Player, n: number)
	local prof = profiles[p]
	if prof then
		prof.coins += n
		dirty[p] = true
	end
end

-- периодическое сохранение и при выключении сервера
task.spawn(function()
	while true do
		task.wait(60)
		for p in dirty do
			if p.Parent then
				Profiles.save(p)
			end
		end
	end
end)

game:BindToClose(function()
	for _, p in Players:GetPlayers() do
		Profiles.save(p)
	end
end)

return Profiles
