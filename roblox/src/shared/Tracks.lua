--!strict
-- Реестр трасс: данные (TrackData) и готовые объекты Track, по одному на трассу.
local Track = require(script.Parent:WaitForChild("Track"))
local folder = script.Parent:WaitForChild("TrackData")

local Tracks = {}
Tracks.data = {
	sakura = require(folder:WaitForChild("Sakura")),
	neon = require(folder:WaitForChild("Neon")),
	sunset = require(folder:WaitForChild("Sunset")),
	momiji = require(folder:WaitForChild("Momiji")),
}

local cache = {}
function Tracks.get(id: string)
	local t = cache[id]
	if not t then
		local d = Tracks.data[id]
		assert(d, "нет трассы " .. tostring(id))
		t = Track.new(d)
		cache[id] = t
	end
	return t
end

return Tracks
