-- Заглушки движка Роблокса для прогона сервера и клиента вместе в одном Luau-состоянии (без Studio).
warn = function(...) print("WARN", ...) end
-- Инстансы — таблицы со свойствами, детьми, атрибутами и сигналами; значения (CFrame, Color3, UDim2…) —
-- «пустышки», которые принимают любые операции. Время — ручное (__clock), task.* — свой планировщик.
local STUB_MT = {}
local function stub() return setmetatable({}, STUB_MT) end
STUB_MT.__index = function() return stub() end
STUB_MT.__call = function() return stub() end
for _, op in { "__add", "__sub", "__mul", "__div", "__unm", "__mod", "__pow" } do STUB_MT[op] = function() return stub() end end
STUB_MT.__lt = function() return false end
STUB_MT.__le = function() return false end

local function newSignal()
	local s = { conns = {} }
	function s:Connect(f) table.insert(self.conns, f); return { Disconnect = function() end } end
	function s:Fire(...) for _, f in self.conns do f(...) end end
	function s:Wait() end
	return s
end

__clock = 0
local queue = {}
task = {}
function task.spawn(f, ...)
	local co = type(f) == "thread" and f or coroutine.create(f)
	local ok, res = coroutine.resume(co, ...)
	if not ok then error(res) end
	if coroutine.status(co) ~= "dead" then table.insert(queue, { co = co, at = __clock + (res or 0) }) end
end
function task.delay(t, f, ...)
	local args = table.pack(...)
	table.insert(queue, { co = coroutine.create(function() f(table.unpack(args, 1, args.n)) end), at = __clock + t })
end
function task.wait(t) local start = __clock; coroutine.yield(t or 0); return __clock - start end
function task.defer(f, ...) task.delay(0, f, ...) end
function __runTasks()
	local due = {}
	for i = #queue, 1, -1 do if queue[i].at <= __clock then table.insert(due, table.remove(queue, i)) end end
	for _, e in due do
		local ok, res = coroutine.resume(e.co)
		if not ok then error(res) end
		if coroutine.status(e.co) ~= "dead" then table.insert(queue, { co = e.co, at = __clock + (res or 0) }) end
	end
end

local SIGNALS = { Activated = true, InputBegan = true, InputEnded = true, InputChanged = true, OnServerEvent = true, OnClientEvent = true,
	PlayerAdded = true, PlayerRemoving = true, Heartbeat = true, RenderStepped = true, Changed = true, Stepped = true }

local Inst = {}
local InstMT = {}
local function newInst(class, name)
	local o = { ClassName = class, _props = { Name = name or class }, _children = {}, _attrs = {} }
	return setmetatable(o, InstMT)
end
InstMT.__index = function(t, k)
	local m = Inst[k]
	if m then return m end
	local props = rawget(t, "_props")
	local v = props[k]
	if v ~= nil then return v end
	for _, c in rawget(t, "_children") do if c.Name == k then return c end end
	if SIGNALS[k] then local s = newSignal(); props[k] = s; return s end
	-- незаданное свойство движка (Position, Size…) — пустышка, как значение по умолчанию
	if type(k) == "string" and k ~= "Parent" and k:match("^%u") then return stub() end
	return nil
end
InstMT.__newindex = function(t, k, v)
	local props = rawget(t, "_props")
	if k == "Parent" then
		local old = props.Parent
		if old then local ch = rawget(old, "_children"); local i = table.find(ch, t); if i then table.remove(ch, i) end end
		props.Parent = v
		if v then table.insert(rawget(v, "_children"), t) end
	else
		props[k] = v
	end
end
function Inst:FindFirstChild(n) for _, c in rawget(self, "_children") do if c.Name == n then return c end end return nil end
function Inst:WaitForChild(n) local v = self[n]; assert(v ~= nil, "WaitForChild: нет " .. tostring(n)); return v end
function Inst:GetDescendants() local out = {}; local function walk(o) for _, c in rawget(o, "_children") do table.insert(out, c); walk(c) end end; walk(self); return out end
function Inst:FindFirstChildOfClass(c) for _, ch in rawget(self, "_children") do if rawget(ch, "ClassName") == c then return ch end end return nil end
function Inst:GetPropertyChangedSignal() return { Connect = function() end } end
function Inst:GetChildren() return table.clone(rawget(self, "_children")) end
function Inst:Destroy() self.Parent = nil end
function Inst:SetAttribute(k, v) rawget(self, "_attrs")[k] = v end
function Inst:GetAttribute(k) return rawget(self, "_attrs")[k] end
function Inst:IsA(c) return rawget(self, "ClassName") == c or c == "Instance" or (c == "BasePart" and (rawget(self, "ClassName") == "Part" or rawget(self, "ClassName") == "WedgePart")) end
function Inst:FireServer(...) self.OnServerEvent:Fire(__localPlayer, ...) end
function Inst:FireClient(p, ...) self.OnClientEvent:Fire(...) end
function Inst:FireAllClients(...) self.OnClientEvent:Fire(...) end
function Inst:InvokeServer(...) return self.OnServerInvoke(__localPlayer, ...) end
function Inst:Play() end
function Inst:Stop() end
function Inst:FillBlock() end
function Inst:Clear() end
function Inst:SetMaterialColor() end
function Inst:BulkMoveTo() end
function Inst:PlayLocalSound() end
function Inst:GetServerTimeNow() return __clock end
function Inst:IsServer() return true end
function Inst:IsKeyDown(k) return __keys[k] == true end
function Inst:IsGamepadButtonDown() return false end
function Inst:GetFocusedTextBox() return nil end
function Inst:GetPlayers() return { __localPlayer } end
function Inst:SetCoreGuiEnabled() end
function Inst:BindToClose() end
function Inst:Create() return newInst("Tween") end
function Inst:GetDataStore() error("DataStore недоступен в тесте") end
__keys = {}

Instance = { new = function(c) return newInst(c) end }

game = newInst("DataModel", "game")
local services = {}
function Inst:GetService(n)
	local s = services[n]
	if not s then s = newInst(n, n); s.Parent = game; services[n] = s end
	return s
end
workspace = game:GetService("Workspace")
workspace.CurrentCamera = newInst("Camera")
workspace.CurrentCamera.FieldOfView = 70
workspace.CurrentCamera.ViewportSize = { X = 1280, Y = 720 }
workspace.Terrain = newInst("Terrain")
local RS = game:GetService("ReplicatedStorage")
-- папка Shared: обращение к модулю по имени даёт ссылку для require
rawget(RS, "_props").Shared = setmetatable({ __module = "Shared" }, { __index = function(_, k) if k == "WaitForChild" then return function(_, c) return { __module = c } end end return { __module = k } end })

__localPlayer = newInst("Player", "Tester")
__localPlayer.UserId = 1001
__localPlayer.DisplayName = "Tester"
__localPlayer.Parent = game:GetService("Players")
local pg = newInst("PlayerGui", "PlayerGui"); pg.Parent = __localPlayer
rawget(game:GetService("Players"), "_props").LocalPlayer = __localPlayer
game:GetService("UserInputService").TouchEnabled = false
game:GetService("UserInputService").KeyboardEnabled = true

-- Enum: любая цепочка → стабильная пустышка (одна и та же для одного пути)
local enumCache = {}
local function enumNode(path)
	local n = enumCache[path]
	if not n then n = setmetatable({ __path = path }, { __index = function(t, k) if k == "Name" then return path:match("[^.]+$") end return enumNode(path .. "." .. k) end }); enumCache[path] = n end
	return n
end
Enum = enumNode("Enum")

local function valueType() return setmetatable({}, { __index = function() return function() return stub() end end }) end
CFrame = valueType(); CFrame.identity = stub()
Color3 = { new = function() return stub() end, fromRGB = function() return stub() end, fromHex = function() return stub() end, fromHSV = function() return stub() end }
UDim2 = valueType(); UDim = valueType(); Vector2 = valueType(); NumberRange = valueType(); NumberSequence = valueType(); NumberSequenceKeypoint = valueType(); ColorSequence = valueType(); TweenInfo = valueType()
Random = { new = function(seed)
	local s = (seed or 7) % 2147483647; if s <= 0 then s = 7 end
	local r = {}
	function r:NextNumber(a, b) s = (s * 16807) % 2147483647; local u = s / 2147483647; if a then return a + (b - a) * u end return u end
	function r:NextInteger(a, b) return a + math.floor(self:NextNumber() * (b - a + 1)) end
	return r
end }
