--!strict
-- Реестр трасс: данные (TrackData) и готовые объекты Track, по одному на трассу.
local Track = require(script.Parent.Track)
local folder = script.Parent.TrackData

local Tracks = {}
Tracks.data = {
	sakura = require(folder.Sakura),
	neon = require(folder.Neon),
	sunset = require(folder.Sunset),
	momiji = require(folder.Momiji),
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
