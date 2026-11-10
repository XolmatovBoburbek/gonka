--!strict
-- Настройки Роблокс-версии. Физика считается в метрах; в мир Роблокса переводим через SCALE (студов на метр).
local Config = {}

Config.SCALE = 3
Config.LAPS = 3
Config.MAX_KARTS = 8
Config.BOT_DIFFICULTY = "normal" -- easy | normal | hard
Config.TRACK_ORDER = { "sakura", "neon", "sunset", "momiji" } -- Гран-при: четыре гонки подряд

-- Время фаз (секунды)
Config.LOBBY_TIME = 12 -- ожидание перед Гран-при (пока хоть один игрок на сервере)
Config.INTRO_TIME = 4 -- облёт трассы перед стартом
Config.COUNT_TIME = 3 -- светофор (газ на старте!)
Config.RESULTS_TIME = 10 -- таблица после гонки
Config.GP_RESULTS_TIME = 14 -- итог Гран-при
Config.FINISH_TIMEOUT = 35 -- после финиша первого игрока остальные успевают доехать
Config.RACE_TIMEOUT = 420 -- предохранитель

-- Награды (как в веб-версии)
Config.GP_POINTS = { 15, 12, 10, 8, 6, 4, 2, 1 }
Config.PLACE_COINS = { 60, 45, 35, 25, 20, 15, 10, 5 }
Config.CUP_COINS = { 300, 200, 120 }

Config.DATASTORE = "SakuraDriftProfiles_v1"

-- Звуки: вставьте сюда ID загруженных аудио ("rbxassetid://123..."). Пустая строка — звука нет.
-- Файлы для загрузки лежат в roblox/assets/audio (см. README).
Config.Sounds = {
	music = {
		menu = "",
		sakura = "",
		neon = "",
		sunset = "",
		momiji = "",
		results = "",
	},
	engine = {
		loop = "",
		idle = "",
		limiter = "",
	},
	loop = {
		drift = "",
		boost = "",
	},
	sfx = {
		countdown = "",
		go = "",
		boost = "",
		miniturbo1 = "",
		miniturbo2 = "",
		miniturbo3 = "",
		driftStart = "",
		driftLevel = "",
		itemBox = "",
		roulette = "",
		itemGet = "",
		orbFire = "",
		hit = "",
		spin = "",
		shieldUp = "",
		shieldBreak = "",
		trapDrop = "",
		freeze = "",
		shatter = "",
		wallHit = "",
		bump = "",
		jump = "",
		land = "",
		trick = "",
		lap = "",
		finalLap = "",
		finishWin = "",
		finishLose = "",
		wrongWay = "",
		coin = "",
		backfire = "",
		uiSelect = "",
		uiBack = "",
		uiMove = "",
		uiStart = "",
	},
	-- частота вспышек в записанной петле мотора (Гц), чтобы считать PlaybackSpeed
	engineLoopHz = 0,
	engineIdleHz = 0,
	engineLimiterHz = 0,
}

return Config
