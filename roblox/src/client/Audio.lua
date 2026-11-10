--!strict
-- Звук: музыка трассы, мотор (петля, высота — от оборотов через PlaybackSpeed), визг дрифта,
-- реактивный шум буста и короткие эффекты. ID берутся из Shared/Config.Sounds; пустой ID — тишина.
local SoundService = game:GetService("SoundService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared").Config)

local Audio = {}
local SND = Config.Sounds

local IDLE_HZ, MAX_HZ = 32, 200 -- как в веб-версии: частота вспышек от холостых до отсечки
local function loopHz(v: number, rpm: number): number
	return if v and v > 0 then v else IDLE_HZ + (MAX_HZ - IDLE_HZ) * rpm
end

local group = Instance.new("SoundGroup")
group.Name = "SakuraSfx"
group.Volume = 0.8
group.Parent = SoundService
local musicGroup = Instance.new("SoundGroup")
musicGroup.Name = "SakuraMusic"
musicGroup.Volume = 0.45
musicGroup.Parent = SoundService

local function mk(id: string, looped: boolean, vol: number, g: SoundGroup): Sound?
	if not id or id == "" then
		return nil
	end
	local s = Instance.new("Sound")
	s.SoundId = id
	s.Looped = looped
	s.Volume = vol
	s.SoundGroup = g
	s.Parent = SoundService
	return s
end

local engine = mk(SND.engine.loop, true, 0, group)
local engineIdle = mk(SND.engine.idle, true, 0, group)
local engineLim = mk(SND.engine.limiter, true, 0, group)
local drift = mk(SND.loop.drift, true, 0, group)
local jet = mk(SND.loop.boost, true, 0, group)
local loops = { engine, engineIdle, engineLim, drift, jet }

local music: Sound? = nil
local musicKey = ""

function Audio.playMusic(key: string)
	if key == musicKey then
		return
	end
	musicKey = key
	if music then
		music:Stop()
		music:Destroy()
		music = nil
	end
	local s = mk(SND.music[key] or "", true, 1, musicGroup)
	if s then
		s:Play()
		music = s
	end
end

function Audio.setMusicSpeed(x: number)
	if music then
		music.PlaybackSpeed = x
	end
end

local cache: { [string]: Sound } = {}
function Audio.sfx(key: string, vol: number?, pitch: number?)
	local id = SND.sfx[key]
	if not id or id == "" then
		return
	end
	local s = cache[key]
	if not s then
		local ns = Instance.new("Sound")
		ns.SoundId = id
		ns.SoundGroup = group
		ns.Parent = SoundService
		cache[key] = ns
		s = ns
	end
	local snd = s :: Sound
	snd.Volume = vol or 0.8
	snd.PlaybackSpeed = pitch or 1
	SoundService:PlayLocalSound(snd)
end

local running = false
function Audio.startEngine()
	if running then
		return
	end
	running = true
	for _, s in loops do
		if s then
			s.Volume = 0
			s:Play()
		end
	end
end

function Audio.stopEngine()
	running = false
	for _, s in loops do
		if s then
			s:Stop()
		end
	end
end

local function approach(s: Sound?, prop: string, v: number, k: number)
	if s then
		local cur = (s :: any)[prop];
		(s :: any)[prop] = cur + (v - cur) * k
	end
end

--- st: { rpm 0..1, load 0..1, limiter, drifting, driftLevel, boosting, speed01, dt }
function Audio.updateEngine(st)
	if not running then
		return
	end
	local k = 1 - math.exp(-(st.dt or 1 / 60) * 18)
	local rpm = math.clamp(st.rpm, 0, 1.05)
	local f = IDLE_HZ + (MAX_HZ - IDLE_HZ) * rpm
	local idleMix = math.clamp(1 - rpm / 0.18, 0, 1)
	local lvl = 0.55 * (0.72 + 0.28 * st.load) * (0.75 + 0.35 * rpm)
	if engine then
		engine.PlaybackSpeed = math.clamp(f / loopHz(SND.engineLoopHz, 0.45), 0.25, 3)
		approach(engine, "Volume", if st.limiter then 0 else lvl * (1 - idleMix * (if engineIdle then 1 else 0)), k)
	end
	if engineIdle then
		engineIdle.PlaybackSpeed = math.clamp(f / loopHz(SND.engineIdleHz, 0), 0.5, 2)
		approach(engineIdle, "Volume", if st.limiter then 0 else lvl * idleMix, k)
	end
	if engineLim then
		engineLim.PlaybackSpeed = math.clamp(f / loopHz(SND.engineLimiterHz, 0.96), 0.5, 2)
		approach(engineLim, "Volume", if st.limiter then lvl else 0, k)
	elseif engine and st.limiter then
		approach(engine, "Volume", lvl * 0.7, k)
	end
	approach(drift, "Volume", if st.drifting then 0.35 + 0.1 * (st.driftLevel or 0) else 0, k)
	if drift then
		drift.PlaybackSpeed = 0.9 + 0.08 * (st.driftLevel or 0)
	end
	approach(jet, "Volume", if st.boosting then 0.4 else 0, k)
end

-- события карта → звуки (как в веб-версии)
local EVENT_SFX = {
	driftStart = "driftStart",
	meterSegment = "driftLevel",
	boostFire = nil,
	hop = nil,
	jump = "jump",
	land = "land",
	trick = "trick",
	trickBoost = "boost",
	wallHit = "wallHit",
	bump = "bump",
	coin = "coin",
	shieldBreak = "shieldBreak",
	slipstream = "boost",
	wrongWay = nil,
	respawn = "uiBack",
}

function Audio.kartEvent(e)
	local t = e.type
	if t == "boostFire" then
		Audio.sfx("miniturbo" .. tostring(math.clamp(e.level or 1, 1, 3)), 0.9)
	elseif t == "boost" and e.added and e.kind == "pad" then
		Audio.sfx("boost", 0.8)
	elseif t == "hit" then
		Audio.sfx(if e.kind == "freeze" then "freeze" else "spin", 0.9)
	elseif t == "unfreeze" then
		Audio.sfx("shatter", 0.8)
	elseif t == "wrongWay" and e.on then
		Audio.sfx("wrongWay", 0.7)
	elseif t == "launch" then
		if e.result == "perfect" or e.result == "good" then
			Audio.sfx("boost", 1)
		elseif e.result == "spin" then
			Audio.sfx("backfire", 0.9)
		end
	else
		local key = EVENT_SFX[t]
		if key then
			local vol = 0.7
			if t == "wallHit" or t == "bump" then
				vol = math.clamp((e.strength or 6) / 14, 0.25, 0.9)
			end
			Audio.sfx(key, vol)
		end
	end
end

return Audio
