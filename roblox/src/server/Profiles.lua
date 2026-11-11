--!strict
-- Профили игроков в DataStore: кошелёк монет, купленные гонщики, выбранный гонщик, лучшие кубки.
-- В Studio без включённого "Enable Studio Access to API Services" работает в памяти (с предупреждением).
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Config"))
local Characters = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Characters"))

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
	local owned = {}
	for _, c in Characters do
		if c.price == 0 then
			owned[c.id] = true
		end
	end
	return { coins = 0, owned = owned, selected = "sakura", cups = 0, races = 0, wins = 0 }
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
		for id, v in defaults().owned do
			prof.owned[id] = v
		end
	end
	profiles[p] = prof
	return prof
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
	return { coins = prof.coins, owned = prof.owned, selected = prof.selected, cups = prof.cups, races = prof.races, wins = prof.wins }
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
