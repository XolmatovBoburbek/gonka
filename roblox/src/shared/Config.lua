--!strict
-- Настройки Роблокс-версии. Физика считается в метрах; в мир Роблокса переводим через SCALE (студов на метр).
local Config = {}

Config.SCALE = 3
Config.LAPS = 3
Config.MAX_KARTS = 8
Config.BOT_DIFFICULTY = "normal" -- easy | normal | hard
Config.TRACK_ORDER = { "sakura", "neon", "sunset", "momiji" } -- трассы для голосования

-- Игроки против игроков: при двух и более игроках ботов нет (BOTS_PVP), одному игроку
-- добавляются соперники-боты (BOTS_SOLO; 0 — ждать второго игрока).
Config.BOTS_PVP = 0
Config.BOTS_SOLO = 5
Config.MIN_PLAYERS = 1 -- сколько игроков нужно для старта, если BOTS_SOLO = 0, ставьте 2

-- Время фаз (секунды)
Config.LOBBY_TIME = 18 -- лобби: голосование за трассу и гараж
Config.INTRO_TIME = 4 -- облёт трассы перед стартом
Config.COUNT_TIME = 3 -- светофор (газ на старте!)
Config.RESULTS_TIME = 9 -- таблица после гонки
Config.FINISH_TIMEOUT = 35 -- после финиша первого игрока остальные успевают доехать
Config.RACE_TIMEOUT = 420 -- предохранитель

-- Награды: монеты за место и кубки рейтинга (только в заездах с двумя и более игроками)
Config.PLACE_COINS = { 60, 45, 35, 25, 20, 15, 10, 5 }
Config.TROPHY_WIN = 30 -- первому среди игроков
Config.TROPHY_LOSE = -15 -- последнему среди игроков; остальные — между ними

Config.DATASTORE = "SakuraDriftProfiles_v2"

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
		-- финальный круг (темп ×1.07, плотнее аранжировка); если пусто — играет обычная тема чуть быстрее
		sakura_final = "",
		neon_final = "",
		sunset_final = "",
		momiji_final = "",
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
	engineLoopHz = 112,
	engineIdleHz = 32,
	engineLimiterHz = 192,
}

return Config
