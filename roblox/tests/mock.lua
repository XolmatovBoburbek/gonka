-- Минимальные заглушки API Роблокса для запуска чистых модулей вне Роблокса (тесты в Node через luau-web).
local V = {}
V.__index = function(v, k)
	if k == "X" then return rawget(v, 1) elseif k == "Y" then return rawget(v, 2) elseif k == "Z" then return rawget(v, 3)
	elseif k == "Magnitude" then return math.sqrt(v[1] * v[1] + v[2] * v[2] + v[3] * v[3])
	elseif k == "Unit" then local m = math.sqrt(v[1] * v[1] + v[2] * v[2] + v[3] * v[3]); if m == 0 then return v end return Vector3.new(v[1] / m, v[2] / m, v[3] / m)
	end
	return V[k]
end
local function new(x, y, z) return setmetatable({ x or 0, y or 0, z or 0 }, V) end
V.__add = function(a, b) return new(a[1] + b[1], a[2] + b[2], a[3] + b[3]) end
V.__sub = function(a, b) return new(a[1] - b[1], a[2] - b[2], a[3] - b[3]) end
V.__mul = function(a, b) if type(a) == "number" then return new(b[1] * a, b[2] * a, b[3] * a) elseif type(b) == "number" then return new(a[1] * b, a[2] * b, a[3] * b) end return new(a[1] * b[1], a[2] * b[2], a[3] * b[3]) end
V.__div = function(a, b) return new(a[1] / b, a[2] / b, a[3] / b) end
V.__unm = function(a) return new(-a[1], -a[2], -a[3]) end
function V.Dot(a, b) return a[1] * b[1] + a[2] * b[2] + a[3] * b[3] end
function V.Cross(a, b) return new(a[2] * b[3] - a[3] * b[2], a[3] * b[1] - a[1] * b[3], a[1] * b[2] - a[2] * b[1]) end
function V.Lerp(a, b, t) return new(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t) end
function V.Min(a, b) return new(math.min(a[1], b[1]), math.min(a[2], b[2]), math.min(a[3], b[3])) end
function V.Max(a, b) return new(math.max(a[1], b[1]), math.max(a[2], b[2]), math.max(a[3], b[3])) end
Vector3 = { new = new, zero = new(0, 0, 0), one = new(1, 1, 1), xAxis = new(1, 0, 0), yAxis = new(0, 1, 0), zAxis = new(0, 0, 1) }
