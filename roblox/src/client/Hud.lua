--!strict
-- Интерфейс. Лобби: голосование за трассу, кошелёк и кубки, гараж (3D-превью машины, характеристики,
-- краска). Гонка: верхняя плашка «место · круг · время», предмет и монеты справа, таблица мест слева,
-- шкала буста и скорость снизу по центру, обороты на старте. Итоги заезда с кубками и монетами.
-- Всё рисуется в «холсте» 1280×720 и масштабируется под экран (UIScale).
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Cars = require(Shared:WaitForChild("Cars"))
local Layout = require(Shared:WaitForChild("Layout"))
local Kart = require(Shared:WaitForChild("Kart"))
local Tracks = require(Shared:WaitForChild("Tracks"))
local Config = require(Shared:WaitForChild("Config"))
local Input = require(script.Parent:WaitForChild("Input"))
local KartModel = require(script.Parent:WaitForChild("KartModel"))

local Hud = {}

local PINK = Color3.fromRGB(255, 93, 147)
local PINK2 = Color3.fromRGB(255, 150, 90)
local CYAN = Color3.fromRGB(57, 220, 255)
local NAVY = Color3.fromRGB(20, 16, 38)
local NAVY2 = Color3.fromRGB(44, 36, 78)
local WHITE = Color3.new(1, 1, 1)
local GOLD = Color3.fromRGB(255, 200, 40)
local GREEN = Color3.fromRGB(60, 210, 120)
local GREY = Color3.fromRGB(96, 90, 130)
local NUM = Enum.Font.FredokaOne
local TXT = Enum.Font.GothamBlack
local TXT2 = Enum.Font.GothamBold

local function new(class: string, props: { [string]: any }, children: { Instance }?): any
	local o = Instance.new(class)
	for k, v in props do
		if k ~= "Parent" then
			(o :: any)[k] = v
		end
	end
	for _, c in children or {} do
		c.Parent = o
	end
	if props.Parent then
		o.Parent = props.Parent
	end
	return o
end

local function corner(r: number): UICorner
	return new("UICorner", { CornerRadius = UDim.new(0, r) })
end

local function stroke(c: Color3, t: number, tr: number?): UIStroke
	return new("UIStroke", { Color = c, Thickness = t, Transparency = tr or 0, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })
end

local function gradient(a: Color3, b: Color3, rot: number?): UIGradient
	return new("UIGradient", { Color = ColorSequence.new(a, b), Rotation = rot or 90 })
end

local function label(props: { [string]: any }): TextLabel
	local p = {
		BackgroundTransparency = 1,
		TextColor3 = WHITE,
		Font = TXT,
		TextScaled = true,
		TextStrokeTransparency = 1,
	}
	for k, v in props do
		p[k] = v
	end
	return new("TextLabel", p)
end

--- Тёмная стеклянная панель со светлой кромкой.
local function panel(props: { [string]: any }, radius: number?): Frame
	local p = { BackgroundColor3 = NAVY, BackgroundTransparency = 0.18, BorderSizePixel = 0 }
	for k, v in props do
		p[k] = v
	end
	return new("Frame", p, { corner(radius or 14), stroke(WHITE, 1.5, 0.75) })
end

--- Кнопка с градиентом. UIGradient красит и текст самой кнопки, поэтому надпись — отдельным ярлыком.
local function button(props: { [string]: any }, onClick: () -> (), colA: Color3?, colB: Color3?): TextButton
	local p = {
		BackgroundColor3 = WHITE,
		AutoButtonColor = true,
		BorderSizePixel = 0,
	}
	local text = ""
	for k, v in props do
		if k == "Text" then
			text = v
		else
			p[k] = v
		end
	end
	p.Text = ""
	local b = new("TextButton", p, { corner(12), gradient(colA or PINK, colB or PINK2, 0) })
	label({ Name = "Label", Size = UDim2.new(1, -20, 1, -14), Position = UDim2.fromOffset(10, 7), Text = text, ZIndex = (props.ZIndex or 1) + 1, Parent = b })
	b.Activated:Connect(onClick)
	return b
end

local function setBtnText(b: Instance, text: string)
	local l = b:FindFirstChild("Label")
	if l and l:IsA("TextLabel") then
		l.Text = text
	end
end

local E: { [string]: any } = {}
local isTouch = UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled
local W, H = 1280, 720 -- размер холста

local function fmtTime(t: number?): string
	if not t then
		return "—"
	end
	local m = math.floor(t / 60)
	return string.format("%d:%05.2f", m, t - m * 60)
end
Hud.fmtTime = fmtTime

-- ---------------------------------------------------------------- построение

function Hud.init(callbacks)
	E.cb = callbacks
	local pg = Players.LocalPlayer:WaitForChild("PlayerGui")
	local gui = new("ScreenGui", { Name = "SakuraHud", ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Enum.ZIndexBehavior.Sibling, Parent = pg })
	-- холст 1280×720 по центру, масштаб под экран
	local canvas = new("Frame", { Name = "Canvas", AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(W, H), BackgroundTransparency = 1, Parent = gui })
	local scale = new("UIScale", { Parent = canvas })
	local function fit()
		local cam = workspace.CurrentCamera
		local vs = if cam then cam.ViewportSize else Vector2.new(W, H)
		local s = math.min(vs.X / W, vs.Y / H)
		scale.Scale = math.max(0.35, s)
		-- холст растягиваем на весь экран (в единицах холста), чтобы края прилипали к краям экрана
		canvas.Size = UDim2.fromOffset(vs.X / scale.Scale, vs.Y / scale.Scale)
	end
	fit()
	if workspace.CurrentCamera then
		workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(fit)
	end
	E.canvas = canvas

	Hud.buildRace(canvas)
	Hud.buildLobby(canvas)
	Hud.buildGarage(canvas)
	Hud.buildResults(canvas)

	-- центр: отсчёт и подсказки
	E.big = label({ AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(760, 120), Position = UDim2.new(0.5, 0, 0.2, 0), Font = NUM, Text = "", TextStrokeColor3 = PINK, TextStrokeTransparency = 0, Parent = canvas })
	E.callouts = new("Frame", { AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(560, 130), Position = UDim2.new(0.5, 0, 0, 96), BackgroundTransparency = 1, Parent = canvas }, {
		new("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 4) }),
	})
	-- баннер (облёт трассы, зритель)
	E.banner = panel({ AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(620, 104), Position = UDim2.new(0.5, 0, 0, 70), Visible = false, Parent = canvas }, 18)
	E.bannerTitle = label({ Size = UDim2.new(1, -30, 0, 52), Position = UDim2.fromOffset(15, 8), Text = "", Parent = E.banner })
	E.bannerSub = label({ Size = UDim2.new(1, -30, 0, 26), Position = UDim2.fromOffset(15, 66), Font = TXT2, Text = "", TextColor3 = Color3.fromRGB(210, 205, 235), Parent = E.banner })

	if isTouch then
		Hud.buildTouch(canvas)
	end
end

function Hud.buildRace(canvas: Frame)
	local race = new("Frame", { Name = "Race", Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false, Parent = canvas })
	E.race = race

	-- верхняя плашка: место · круг · время
	local bar = panel({ AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(430, 62), Position = UDim2.new(0.5, 0, 0, 14), Parent = race }, 31)
	local badge = new("Frame", { Size = UDim2.fromOffset(110, 50), Position = UDim2.fromOffset(6, 6), BackgroundColor3 = WHITE, BorderSizePixel = 0, Parent = bar }, { corner(25), gradient(PINK, PINK2, 0) })
	E.place = label({ Size = UDim2.fromOffset(52, 46), Position = UDim2.fromOffset(10, 2), Font = NUM, Text = "1", Parent = badge })
	E.placeOf = label({ Size = UDim2.fromOffset(40, 24), Position = UDim2.fromOffset(62, 20), Font = NUM, Text = "/8", TextXAlignment = Enum.TextXAlignment.Left, Parent = badge })
	E.lap = label({ Size = UDim2.fromOffset(150, 30), Position = UDim2.fromOffset(128, 16), Text = "КРУГ 1/3", Parent = bar })
	new("Frame", { Size = UDim2.fromOffset(2, 30), Position = UDim2.fromOffset(288, 16), BackgroundColor3 = WHITE, BackgroundTransparency = 0.7, BorderSizePixel = 0, Parent = bar })
	E.time = label({ Size = UDim2.fromOffset(120, 30), Position = UDim2.fromOffset(298, 16), Font = NUM, Text = "0:00.00", Parent = bar })

	-- справа: предмет, монеты, слипстрим
	local itemBox = panel({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(92, 92), Position = UDim2.new(1, -18, 0, 60), Parent = race }, 20)
	E.itemBox = itemBox
	E.itemIcon = label({ Size = UDim2.fromScale(0.74, 0.74), Position = UDim2.fromScale(0.13, 0.1), Font = NUM, Text = "", Parent = itemBox })
	E.itemName = label({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(170, 18), Position = UDim2.new(1, 0, 1, 4), Font = TXT2, Text = "", TextXAlignment = Enum.TextXAlignment.Right, TextStrokeTransparency = 0.5, Parent = itemBox })
	E.itemHint = label({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(60, 16), Position = UDim2.new(0, -6, 0, 38), Font = TXT2, Text = if isTouch then "" else "E", TextTransparency = 0.3, TextXAlignment = Enum.TextXAlignment.Right, Parent = itemBox })
	local coinP = panel({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(120, 34), Position = UDim2.new(1, -18, 0, 182), Parent = race }, 17)
	E.coins = label({ Size = UDim2.new(1, -16, 1, -8), Position = UDim2.fromOffset(8, 4), Font = NUM, Text = "● 0", TextColor3 = GOLD, Parent = coinP })
	E.draftBar = panel({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(150, 12), Position = UDim2.new(1, -18, 0, 248), Visible = false, Parent = race }, 6)
	E.draftFill = new("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = Color3.fromRGB(180, 240, 255), BorderSizePixel = 0, Parent = E.draftBar }, { corner(6) })
	label({ Size = UDim2.fromOffset(150, 16), Position = UDim2.fromOffset(0, -19), Font = TXT2, Text = "СЛИПСТРИМ", TextColor3 = Color3.fromRGB(180, 240, 255), TextStrokeTransparency = 0.5, Parent = E.draftBar })

	-- слева: таблица мест
	local board = new("Frame", { AnchorPoint = Vector2.new(0, 0.5), Size = UDim2.fromOffset(200, 8 * 27), Position = UDim2.new(0, 16, 0.52, 0), BackgroundTransparency = 1, Parent = race }, {
		new("UIListLayout", { Padding = UDim.new(0, 3), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	E.boardRows = {}
	for i = 1, 8 do
		local row = new("Frame", { Size = UDim2.fromOffset(200, 24), LayoutOrder = i, BackgroundColor3 = NAVY, BackgroundTransparency = 0.3, BorderSizePixel = 0, Parent = board }, { corner(12) })
		local chip = new("Frame", { Size = UDim2.fromOffset(24, 24), BackgroundColor3 = WHITE, BorderSizePixel = 0, Parent = row }, { corner(12) })
		label({ Size = UDim2.fromScale(1, 1), Font = NUM, Text = tostring(i), TextColor3 = NAVY, Parent = chip })
		local nm = label({ Size = UDim2.new(1, -38, 1, -6), Position = UDim2.fromOffset(32, 3), Font = TXT2, Text = "", TextXAlignment = Enum.TextXAlignment.Left, Parent = row })
		E.boardRows[i] = { row = row, chip = chip, name = nm }
	end

	-- снизу по центру: скорость и шкала буста
	local bottom = new("Frame", { AnchorPoint = Vector2.new(0.5, 1), Size = UDim2.fromOffset(330, 96), Position = UDim2.new(0.5, 0, 1, -14), BackgroundTransparency = 1, Parent = race })
	E.bottom = bottom
	E.speed = label({ Size = UDim2.fromOffset(150, 50), Position = UDim2.fromOffset(60, 0), Font = NUM, Text = "0", TextXAlignment = Enum.TextXAlignment.Right, TextStrokeTransparency = 0.3, TextStrokeColor3 = NAVY, Parent = bottom })
	label({ Size = UDim2.fromOffset(60, 20), Position = UDim2.fromOffset(216, 24), Font = TXT2, Text = "км/ч", TextXAlignment = Enum.TextXAlignment.Left, TextStrokeTransparency = 0.5, Parent = bottom })
	local meter = panel({ Size = UDim2.fromOffset(330, 36), Position = UDim2.fromOffset(0, 56), Parent = bottom }, 18)
	E.meterSegs = {}
	local segCol = { Color3.fromRGB(85, 184, 255), Color3.fromRGB(255, 165, 58), Color3.fromRGB(255, 85, 224) }
	for i = 1, 3 do
		local seg = new("Frame", { Size = UDim2.fromOffset(86, 20), Position = UDim2.fromOffset(8 + (i - 1) * 92, 8), BackgroundColor3 = NAVY2, BorderSizePixel = 0, ClipsDescendants = true, Parent = meter }, { corner(10) })
		local fill = new("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = segCol[i], BorderSizePixel = 0, Parent = seg }, { corner(10) })
		E.meterSegs[i] = { seg = seg, fill = fill }
	end
	E.meterKey = label({ Size = UDim2.fromOffset(38, 20), Position = UDim2.fromOffset(286, 8), Font = TXT, Text = if isTouch then "⚡" else "F", TextColor3 = GREY, Parent = meter })

	-- обороты на старте
	local rev = panel({ AnchorPoint = Vector2.new(0.5, 1), Size = UDim2.fromOffset(440, 50), Position = UDim2.new(0.5, 0, 1, -150), Visible = false, Parent = canvas }, 16)
	E.rev = rev
	local inner = new("Frame", { Size = UDim2.new(1, -20, 0, 22), Position = UDim2.fromOffset(10, 10), BackgroundColor3 = NAVY2, BorderSizePixel = 0, ClipsDescendants = true, Parent = rev }, { corner(8) })
	local Z = Kart.PHYS.revZones
	local function zone(a: number, b: number, c: Color3)
		new("Frame", { Size = UDim2.fromScale(b - a, 1), Position = UDim2.fromScale(a, 0), BackgroundColor3 = c, BorderSizePixel = 0, Parent = inner })
	end
	zone(Z.good, Z.perfect, Color3.fromRGB(70, 170, 100))
	zone(Z.perfect, Z.perfectTop, Color3.fromRGB(70, 255, 130))
	zone(Z.perfectTop, Z.red, Color3.fromRGB(70, 170, 100))
	zone(Z.red, 1, Color3.fromRGB(255, 60, 70))
	E.revNeedle = new("Frame", { AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(6, 34), Position = UDim2.new(0, 10, 0, 4), BackgroundColor3 = WHITE, BorderSizePixel = 0, Parent = rev }, { corner(3) })
	E.revInnerW = 420
	E.revCharge = new("Frame", { Size = UDim2.fromOffset(0, 5), Position = UDim2.fromOffset(10, 38), BackgroundColor3 = GOLD, BorderSizePixel = 0, Parent = rev }, { corner(2) })
	label({ AnchorPoint = Vector2.new(0.5, 1), Size = UDim2.fromOffset(520, 22), Position = UDim2.new(0.5, 0, 0, -6), Font = TXT2, Text = if isTouch then "Держите ГАЗ в зелёной зоне — рывок на старте!" else "Держите W в зелёной зоне — рывок на старте!", TextStrokeTransparency = 0.4, Parent = rev })
end

-- ---------------------------------------------------------------- лобби

function Hud.buildLobby(canvas: Frame)
	local lobby = new("Frame", { Name = "Lobby", Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false, Parent = canvas })
	E.lobby = lobby
	-- логотип
	label({ AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(620, 70), Position = UDim2.new(0.5, 0, 0, 56), Font = NUM, Text = "SAKURA DRIFT", TextStrokeColor3 = PINK, TextStrokeTransparency = 0, Parent = lobby })
	E.lobbySub = label({ AnchorPoint = Vector2.new(0.5, 0), Size = UDim2.fromOffset(620, 24), Position = UDim2.new(0.5, 0, 0, 128), Font = TXT2, Text = "ОНЛАЙН-ГОНКИ", TextStrokeTransparency = 0.4, Parent = lobby })

	-- кошелёк и кубки (справа сверху)
	local stat = panel({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(250, 44), Position = UDim2.new(1, -18, 0, 60), Parent = lobby }, 22)
	E.wallet = label({ Size = UDim2.fromOffset(110, 28), Position = UDim2.fromOffset(12, 8), Font = NUM, Text = "● 0", TextColor3 = GOLD, Parent = stat })
	E.trophies = label({ Size = UDim2.fromOffset(110, 28), Position = UDim2.fromOffset(128, 8), Font = NUM, Text = "🏆 0", TextColor3 = WHITE, Parent = stat })

	-- голосование
	local vote = panel({ AnchorPoint = Vector2.new(0.5, 0.5), Size = UDim2.fromOffset(880, 300), Position = UDim2.new(0.5, 0, 0.5, 10), Parent = lobby }, 22)
	E.voteTitle = label({ Size = UDim2.new(1, -40, 0, 32), Position = UDim2.fromOffset(20, 14), Text = "ГОЛОСУЙТЕ ЗА ТРАССУ", Parent = vote })
	E.voteCards = {}
	for i, id in Config.TRACK_ORDER do
		local d = Tracks.data[id]
		local card = new("TextButton", { Size = UDim2.fromOffset(200, 170), Position = UDim2.fromOffset(20 + (i - 1) * 213, 60), BackgroundColor3 = WHITE, Text = "", AutoButtonColor = true, BorderSizePixel = 0, Parent = vote }, {
			corner(16),
			gradient(Color3.fromHex(d.card[1]), Color3.fromHex(d.card[2]), 60),
		})
		local st = stroke(WHITE, 4, 1)
		st.Parent = card
		label({ Size = UDim2.new(1, -16, 0, 44), Position = UDim2.fromOffset(8, 14), Font = NUM, Text = d.jp, TextStrokeTransparency = 0.6, TextStrokeColor3 = NAVY, Parent = card })
		label({ Size = UDim2.new(1, -16, 0, 26), Position = UDim2.fromOffset(8, 66), Text = d.name, TextStrokeTransparency = 0.5, TextStrokeColor3 = NAVY, Parent = card })
		label({ Size = UDim2.new(1, -16, 0, 18), Position = UDim2.fromOffset(8, 96), Font = TXT2, Text = d.time, TextStrokeTransparency = 0.6, TextStrokeColor3 = NAVY, Parent = card })
		local badge = new("Frame", { AnchorPoint = Vector2.new(0.5, 1), Size = UDim2.fromOffset(120, 30), Position = UDim2.new(0.5, 0, 1, -10), BackgroundColor3 = NAVY, BackgroundTransparency = 0.25, BorderSizePixel = 0, Parent = card }, { corner(15) })
		local cnt = label({ Size = UDim2.new(1, -10, 1, -8), Position = UDim2.fromOffset(5, 4), Font = TXT2, Text = "0 голосов", Parent = badge })
		card.Activated:Connect(function()
			E.myVote = id
			E.cb.vote(id)
			Hud.refreshVotes()
		end)
		E.voteCards[id] = { card = card, stroke = st, count = cnt }
	end
	E.lobbyTimer = label({ Size = UDim2.new(1, -40, 0, 34), Position = UDim2.new(0, 20, 1, -52), Font = TXT, Text = "", TextColor3 = GOLD, Parent = vote })

	-- моя машина и гараж (снизу)
	local mine = panel({ AnchorPoint = Vector2.new(0.5, 1), Size = UDim2.fromOffset(520, 70), Position = UDim2.new(0.5, 0, 1, -22), Parent = lobby }, 22)
	E.myCarChip = new("Frame", { Size = UDim2.fromOffset(46, 46), Position = UDim2.fromOffset(12, 12), BackgroundColor3 = PINK, BorderSizePixel = 0, Parent = mine }, { corner(23), stroke(WHITE, 2, 0.3) })
	E.myCarName = label({ Size = UDim2.fromOffset(250, 28), Position = UDim2.fromOffset(70, 10), Text = "", TextXAlignment = Enum.TextXAlignment.Left, Parent = mine })
	E.myCarClass = label({ Size = UDim2.fromOffset(250, 18), Position = UDim2.fromOffset(70, 40), Font = TXT2, Text = "", TextColor3 = Color3.fromRGB(200, 195, 230), TextXAlignment = Enum.TextXAlignment.Left, Parent = mine })
	button({ AnchorPoint = Vector2.new(1, 0.5), Size = UDim2.fromOffset(170, 48), Position = UDim2.new(1, -12, 0.5, 0), Text = "ГАРАЖ", Parent = mine }, function()
		Hud.openGarage(true)
	end)
end

function Hud.refreshVotes()
	local counts = E.votes or {}
	for id, c in E.voteCards do
		local n = counts[id] or 0
		c.count.Text = string.format("%d %s", n, if n == 1 then "голос" elseif n >= 2 and n <= 4 then "голоса" else "голосов")
		c.stroke.Transparency = if E.myVote == id then 0 else 1
	end
end

function Hud.setVotes(counts)
	E.votes = counts
	Hud.refreshVotes()
end

--- Лобби каждый кадр: сколько до старта / кого ждём.
function Hud.lobby(left: number, players: number, need: number)
	if players < need then
		E.lobbyTimer.Text = string.format("Ждём игроков: %d / %d", players, need)
	else
		E.lobbyTimer.Text = string.format("Старт через %d с", left)
	end
	E.lobbySub.Text = if players >= 2 then string.format("ОНЛАЙН-ГОНКА · ИГРОКОВ: %d", players) elseif Config.BOTS_SOLO > 0 then "ВЫ ОДИН НА СЕРВЕРЕ — ЗАЕЗД С БОТАМИ (КУБКИ НЕ РАЗЫГРЫВАЮТСЯ)" else "ОНЛАЙН-ГОНКИ"
end

function Hud.resetVote()
	E.myVote = nil
	E.votes = {}
	Hud.refreshVotes()
end

-- ---------------------------------------------------------------- гараж

local function statBar(parent: Instance, y: number, name: string): Frame
	label({ Size = UDim2.fromOffset(110, 18), Position = UDim2.fromOffset(0, y), Font = TXT2, Text = name, TextXAlignment = Enum.TextXAlignment.Left, Parent = parent })
	local bar = new("Frame", { Size = UDim2.new(1, -120, 0, 12), Position = UDim2.fromOffset(120, y + 3), BackgroundColor3 = NAVY2, BorderSizePixel = 0, Parent = parent }, { corner(6) })
	return new("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = WHITE, BorderSizePixel = 0, Parent = bar }, { corner(6), gradient(CYAN, PINK, 0) })
end

function Hud.buildGarage(canvas: Frame)
	local g = new("Frame", { Name = "Garage", AnchorPoint = Vector2.new(0.5, 0.5), Size = UDim2.fromOffset(1000, 560), Position = UDim2.fromScale(0.5, 0.52), BackgroundColor3 = NAVY, BackgroundTransparency = 0.04, BorderSizePixel = 0, Visible = false, ZIndex = 20, Parent = canvas }, { corner(24), stroke(PINK, 3) })
	E.garage = g
	label({ Size = UDim2.fromOffset(300, 40), Position = UDim2.fromOffset(24, 16), Text = "ГАРАЖ", TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 21, Parent = g })
	E.garageWallet = label({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(200, 32), Position = UDim2.new(1, -90, 0, 20), Font = NUM, Text = "● 0", TextColor3 = GOLD, TextXAlignment = Enum.TextXAlignment.Right, ZIndex = 21, Parent = g })
	button({ AnchorPoint = Vector2.new(1, 0), Size = UDim2.fromOffset(46, 46), Position = UDim2.new(1, -18, 0, 14), Text = "✕", ZIndex = 21, Parent = g }, function()
		Hud.openGarage(false)
	end, GREY, GREY)

	-- слева: список машин
	local list = new("ScrollingFrame", { Size = UDim2.fromOffset(280, 470), Position = UDim2.fromOffset(20, 72), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 5, CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y, ZIndex = 21, Parent = g }, {
		new("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	E.carRows = {}
	for i, c in Cars.list do
		local row = new("TextButton", { Size = UDim2.fromOffset(268, 52), LayoutOrder = i, BackgroundColor3 = NAVY2, Text = "", AutoButtonColor = true, BorderSizePixel = 0, ZIndex = 21, Parent = list }, { corner(12) })
		local st = stroke(PINK, 3, 1)
		st.Parent = row
		label({ Size = UDim2.fromOffset(170, 24), Position = UDim2.fromOffset(12, 6), Text = c.name, TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 22, Parent = row })
		label({ Size = UDim2.fromOffset(170, 16), Position = UDim2.fromOffset(12, 31), Font = TXT2, Text = c.class, TextColor3 = Color3.fromRGB(190, 185, 225), TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 22, Parent = row })
		local tag = label({ AnchorPoint = Vector2.new(1, 0.5), Size = UDim2.fromOffset(80, 22), Position = UDim2.new(1, -10, 0.5, 0), Font = NUM, Text = "", TextXAlignment = Enum.TextXAlignment.Right, ZIndex = 22, Parent = row })
		row.Activated:Connect(function()
			E.viewCar = c.id
			Hud.refreshGarage()
		end)
		E.carRows[c.id] = { row = row, stroke = st, tag = tag }
	end

	-- центр: 3D-превью
	local vp = new("ViewportFrame", { Size = UDim2.fromOffset(400, 330), Position = UDim2.fromOffset(312, 72), BackgroundColor3 = NAVY2, BackgroundTransparency = 0.2, BorderSizePixel = 0, Ambient = Color3.fromRGB(170, 170, 190), LightColor = WHITE, LightDirection = Vector3.new(-1, -2, -1), ZIndex = 21, Parent = g }, { corner(18) })
	local cam = Instance.new("Camera")
	cam.FieldOfView = 35
	cam.Parent = vp
	vp.CurrentCamera = cam
	E.vp = vp
	E.vpCam = cam
	-- краски
	label({ Size = UDim2.fromOffset(400, 18), Position = UDim2.fromOffset(312, 412), Font = TXT2, Text = "ЦВЕТ", TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 21, Parent = g })
	E.swatches = {}
	for i, pt in Cars.paints do
		local sw = new("TextButton", { Size = UDim2.fromOffset(34, 34), Position = UDim2.fromOffset(312 + (i - 1) * 40, 436), BackgroundColor3 = Color3.fromHex(pt.color), Text = "", AutoButtonColor = true, BorderSizePixel = 0, ZIndex = 21, Parent = g }, { corner(17) })
		local st = stroke(WHITE, 3, 1)
		st.Parent = sw
		sw.Activated:Connect(function()
			E.cb.paint(i)
		end)
		E.swatches[i] = st
	end

	-- справа: характеристики и кнопка
	local info = new("Frame", { Size = UDim2.fromOffset(252, 470), Position = UDim2.fromOffset(728, 72), BackgroundTransparency = 1, ZIndex = 21, Parent = g })
	E.gName = label({ Size = UDim2.new(1, 0, 0, 36), Text = "", TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 21, Parent = info })
	E.gClass = label({ Size = UDim2.new(1, 0, 0, 20), Position = UDim2.fromOffset(0, 40), Font = TXT2, Text = "", TextColor3 = CYAN, TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 21, Parent = info })
	E.gDesc = label({ Size = UDim2.new(1, 0, 0, 44), Position = UDim2.fromOffset(0, 68), Font = TXT2, Text = "", TextScaled = false, TextSize = 16, TextWrapped = true, TextColor3 = Color3.fromRGB(210, 205, 235), TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 21, Parent = info })
	E.gStats = {
		speed = statBar(info, 130, "СКОРОСТЬ"),
		accel = statBar(info, 160, "РАЗГОН"),
		handling = statBar(info, 190, "УПРАВЛЕНИЕ"),
	}
	for _, d in info:GetDescendants() do
		if d:IsA("GuiObject") then
			d.ZIndex = 21
		end
	end
	E.gBtn = button({ AnchorPoint = Vector2.new(0, 1), Size = UDim2.new(1, 0, 0, 56), Position = UDim2.new(0, 0, 1, -40), Text = "", ZIndex = 21, Parent = info }, function()
		local prof = E.profile
		local id = E.viewCar
		if not prof or not id then
			return
		end
		if prof.cars[id] then
			E.cb.select(id)
		else
			E.cb.buy(id)
		end
	end)
	E.gBtnGrad = E.gBtn:FindFirstChildOfClass("UIGradient")
	E.gNote = label({ AnchorPoint = Vector2.new(0, 1), Size = UDim2.new(1, 0, 0, 20), Position = UDim2.new(0, 0, 1, -10), Font = TXT2, Text = "", TextColor3 = Color3.fromRGB(200, 195, 230), ZIndex = 21, Parent = info })
end

function Hud.openGarage(on: boolean)
	if on and E.profile then
		E.viewCar = E.profile.car
	end
	E.garage.Visible = on
	if on then
		Hud.refreshGarage()
	end
end

function Hud.refreshGarage()
	local prof = E.profile
	if not prof then
		return
	end
	local id = E.viewCar or prof.car
	local car = Cars.get(id)
	E.garageWallet.Text = "● " .. tostring(prof.coins)
	for cid, r in E.carRows do
		local c = Cars.get(cid)
		r.stroke.Transparency = if cid == car.id then 0 else 1
		if prof.car == cid then
			r.tag.Text = "ВЫБРАНА"
			r.tag.TextColor3 = GREEN
		elseif prof.cars[cid] then
			r.tag.Text = ""
		else
			r.tag.Text = "● " .. tostring(c.price)
			r.tag.TextColor3 = GOLD
		end
	end
	E.gName.Text = car.name
	E.gClass.Text = string.upper(car.class)
	E.gDesc.Text = car.desc
	for k, bar in E.gStats do
		bar.Size = UDim2.fromScale(car.stats[k] / 5, 1)
	end
	for i, st in E.swatches do
		st.Transparency = if i == prof.paint then 0 else 1
	end
	local grad = E.gBtnGrad
	if prof.car == car.id then
		setBtnText(E.gBtn, "ВЫБРАНА")
		E.gNote.Text = ""
		if grad then
			grad.Color = ColorSequence.new(GREEN, GREEN)
		end
	elseif prof.cars[car.id] then
		setBtnText(E.gBtn, "ВЫБРАТЬ")
		E.gNote.Text = ""
		if grad then
			grad.Color = ColorSequence.new(PINK, PINK2)
		end
	else
		setBtnText(E.gBtn, "КУПИТЬ  ● " .. tostring(car.price))
		local enough = prof.coins >= car.price
		E.gNote.Text = if enough then "" else string.format("Не хватает %d монет", car.price - prof.coins)
		if grad then
			grad.Color = if enough then ColorSequence.new(GOLD, PINK2) else ColorSequence.new(GREY, GREY)
		end
	end
	-- 3D-превью: пересобираем модель при смене машины или краски
	local key = car.id .. ":" .. tostring(prof.paint)
	if E.vpKey ~= key then
		E.vpKey = key
		if E.vpModel then
			E.vpModel:destroy()
		end
		local m = KartModel.new(car, Color3.fromHex(Cars.paint(prof.paint).color), nil, true)
		m.root.CFrame = CFrame.new(0, 0, 0)
		m:setParent(E.vp)
		E.vpModel = m
	end
end

function Hud.setProfile(prof)
	if not prof then
		return
	end
	E.profile = prof
	E.wallet.Text = "● " .. tostring(prof.coins)
	E.trophies.Text = "🏆 " .. tostring(prof.trophies or 0)
	local car = Cars.get(prof.car)
	E.myCarName.Text = car.name
	E.myCarClass.Text = car.class .. " · " .. Cars.paint(prof.paint).name
	E.myCarChip.BackgroundColor3 = Color3.fromHex(Cars.paint(prof.paint).color)
	if E.garage.Visible then
		Hud.refreshGarage()
	end
end

--- Раз в кадр: вращение машины в превью.
function Hud.tick(dt: number)
	if E.garage.Visible and E.vpCam then
		E.vpAngle = (E.vpAngle or 0) + dt * 0.6
		local a = E.vpAngle
		local sc = Config.SCALE
		local center = Vector3.new(0, 0.7 * sc, 0)
		local pos = center + Vector3.new(math.cos(a) * 7.2 * sc, 2.6 * sc, math.sin(a) * 7.2 * sc)
		E.vpCam.CFrame = CFrame.lookAt(pos, center)
	end
end

-- ---------------------------------------------------------------- итоги

function Hud.buildResults(canvas: Frame)
	local r = new("Frame", { Name = "Results", AnchorPoint = Vector2.new(0.5, 0.5), Size = UDim2.fromOffset(680, 500), Position = UDim2.fromScale(0.5, 0.5), BackgroundColor3 = NAVY, BackgroundTransparency = 0.06, BorderSizePixel = 0, Visible = false, ZIndex = 10, Parent = canvas }, { corner(24), stroke(PINK, 3) })
	E.results = r
	E.resTitle = label({ Size = UDim2.new(1, -40, 0, 44), Position = UDim2.fromOffset(20, 14), Text = "ИТОГИ ЗАЕЗДА", ZIndex = 11, Parent = r })
	E.resSub = label({ Size = UDim2.new(1, -40, 0, 20), Position = UDim2.fromOffset(20, 58), Font = TXT2, Text = "", TextColor3 = CYAN, ZIndex = 11, Parent = r })
	E.resList = new("Frame", { Size = UDim2.new(1, -40, 0, 8 * 37), Position = UDim2.fromOffset(20, 88), BackgroundTransparency = 1, ZIndex = 11, Parent = r }, {
		new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	E.resReward = label({ Size = UDim2.new(1, -40, 0, 30), Position = UDim2.new(0, 20, 1, -84), Font = TXT, Text = "", TextColor3 = GOLD, ZIndex = 11, Parent = r })
	E.resNext = label({ Size = UDim2.new(1, -40, 0, 20), Position = UDim2.new(0, 20, 1, -42), Font = TXT2, Text = "Возвращаемся в лобби…", TextColor3 = Color3.fromRGB(200, 195, 230), ZIndex = 11, Parent = r })
end

--- data: { list = {{id,name,carId,paint,place,time,finished,isBot,trophies}}, pvp, trackId }
function Hud.showResults(data, myId: number)
	for _, c in E.resList:GetChildren() do
		if c:IsA("Frame") then
			c:Destroy()
		end
	end
	local d = Tracks.data[data.trackId]
	E.resSub.Text = (if d then d.name else "") .. (if data.pvp then " · ОНЛАЙН-ЗАЕЗД" else " · ЗАЕЗД С БОТАМИ")
	for _, r in data.list do
		local me = r.id == myId
		local row = new("Frame", { Size = UDim2.new(1, 0, 0, 33), LayoutOrder = r.place, BackgroundColor3 = if me then PINK else NAVY2, BackgroundTransparency = if me then 0 else 0.2, BorderSizePixel = 0, ZIndex = 11, Parent = E.resList }, { corner(16) })
		local chip = new("Frame", { Size = UDim2.fromOffset(33, 33), BackgroundColor3 = if r.place == 1 then GOLD elseif r.place == 2 then Color3.fromRGB(205, 210, 225) elseif r.place == 3 then Color3.fromRGB(220, 150, 90) else WHITE, BorderSizePixel = 0, ZIndex = 12, Parent = row }, { corner(16) })
		label({ Size = UDim2.fromScale(1, 1), Font = NUM, Text = tostring(r.place), TextColor3 = NAVY, ZIndex = 13, Parent = chip })
		new("Frame", { Size = UDim2.fromOffset(14, 14), Position = UDim2.fromOffset(44, 10), BackgroundColor3 = Color3.fromHex(Cars.paint(r.paint).color), BorderSizePixel = 0, ZIndex = 12, Parent = row }, { corner(7) })
		label({ Size = UDim2.fromOffset(250, 22), Position = UDim2.fromOffset(66, 5), Font = TXT2, Text = r.name, TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 12, Parent = row })
		label({ Size = UDim2.fromOffset(120, 16), Position = UDim2.fromOffset(322, 9), Font = TXT2, Text = Cars.get(r.carId).name, TextColor3 = Color3.fromRGB(215, 210, 240), TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 12, Parent = row })
		label({ Size = UDim2.fromOffset(100, 22), Position = UDim2.new(1, -190, 0, 5), Font = NUM, Text = if r.finished then fmtTime(r.time) else "—", ZIndex = 12, Parent = row })
		local tr = ""
		if data.pvp and not r.isBot then
			tr = string.format("%s%d 🏆", if r.trophies >= 0 then "+" else "", r.trophies)
		end
		label({ Size = UDim2.fromOffset(78, 22), Position = UDim2.new(1, -86, 0, 5), Font = NUM, Text = tr, TextColor3 = if r.trophies >= 0 then WHITE else Color3.fromRGB(255, 190, 190), TextXAlignment = Enum.TextXAlignment.Right, ZIndex = 12, Parent = row })
	end
	E.resReward.Text = ""
end

function Hud.showReward(rw)
	local parts = { string.format("Монеты на трассе: %d", rw.collected), string.format("За место: +%d", rw.placeBonus) }
	local s = table.concat(parts, "   ·   ") .. string.format("   =   ● %d", rw.total)
	if rw.pvp then
		s ..= string.format("      %s%d 🏆", if rw.trophies >= 0 then "+" else "", rw.trophies)
	end
	E.resReward.Text = s
end

-- ---------------------------------------------------------------- сенсорные кнопки

function Hud.buildTouch(canvas: Frame)
	local t = new("Frame", { Name = "Touch", Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false, Parent = canvas })
	E.touch = t
	local function hold(text: string, anchor: Vector2, pos: UDim2, size: number, color: Color3, onDown: () -> (), onUp: () -> ())
		local b = new("TextButton", { AnchorPoint = anchor, Size = UDim2.fromOffset(size, size), Position = pos, Text = text, BackgroundColor3 = color, BackgroundTransparency = 0.25, TextColor3 = WHITE, Font = TXT, TextScaled = true, AutoButtonColor = false, Parent = t }, {
			new("UICorner", { CornerRadius = UDim.new(1, 0) }),
			stroke(WHITE, 2, 0.4),
			new("UIPadding", { PaddingTop = UDim.new(0.22, 0), PaddingBottom = UDim.new(0.22, 0), PaddingLeft = UDim.new(0.12, 0), PaddingRight = UDim.new(0.12, 0) }),
		})
		b.InputBegan:Connect(function(io)
			if io.UserInputType == Enum.UserInputType.Touch or io.UserInputType == Enum.UserInputType.MouseButton1 then
				onDown()
			end
		end)
		b.InputEnded:Connect(function(io)
			if io.UserInputType == Enum.UserInputType.Touch or io.UserInputType == Enum.UserInputType.MouseButton1 then
				onUp()
			end
		end)
	end
	local tch = Input.touch
	local left, right = false, false
	local function upd()
		tch.steer = (if right then 1 else 0) - (if left then 1 else 0)
	end
	local BL, BR = Vector2.new(0, 1), Vector2.new(1, 1)
	hold("◀", BL, UDim2.new(0, 28, 1, -30), 120, NAVY, function()
		left = true
		upd()
	end, function()
		left = false
		upd()
	end)
	hold("▶", BL, UDim2.new(0, 164, 1, -30), 120, NAVY, function()
		right = true
		upd()
	end, function()
		right = false
		upd()
	end)
	hold("ГАЗ", BR, UDim2.new(1, -28, 1, -30), 130, GREEN, function()
		tch.gas = true
	end, function()
		tch.gas = false
	end)
	hold("ТОРМ", BR, UDim2.new(1, -170, 1, -24), 90, GREY, function()
		tch.brake = true
	end, function()
		tch.brake = false
	end)
	hold("ДРИФТ", BR, UDim2.new(1, -150, 1, -150), 104, PINK, function()
		tch.drift = true
		Input.press("drift")
	end, function()
		tch.drift = false
	end)
	hold("⚡", BR, UDim2.new(1, -28, 1, -172), 90, Color3.fromRGB(85, 184, 255), function()
		Input.press("boost")
	end, function() end)
	hold("✦", BR, UDim2.new(1, -262, 1, -110), 86, Color3.fromRGB(160, 90, 255), function()
		Input.press("item")
	end, function() end)
end

-- ---------------------------------------------------------------- состояние экрана

--- mode: 'lobby' | 'intro' | 'countdown' | 'race' | 'results' | 'spectate'
function Hud.setMode(mode: string, info: { [string]: any }?)
	local i = info or {}
	if E.mode ~= mode then
		E.mode = mode
		if mode ~= "lobby" and mode ~= "spectate" then
			Hud.openGarage(false)
		end
		if mode == "lobby" then
			Hud.refreshVotes()
		end
	end
	local racing = mode == "countdown" or mode == "race"
	E.race.Visible = racing
	if E.touch then
		E.touch.Visible = racing
	end
	E.rev.Visible = mode == "countdown" and i.onGrid == true
	E.lobby.Visible = mode == "lobby" and not E.garage.Visible
	E.results.Visible = mode == "results"
	E.banner.Visible = mode == "intro" or mode == "spectate"
	if not racing then
		E.big.Text = ""
	end
end

function Hud.banner(title: string, sub: string)
	E.bannerTitle.Text = title
	E.bannerSub.Text = sub
end

function Hud.big(text: string, color: Color3?, dur: number?)
	E.big.Text = text
	E.big.TextStrokeColor3 = color or PINK
	E.big.TextTransparency = 0
	E.big.TextStrokeTransparency = 0
	local token = {}
	E.bigToken = token
	task.delay(dur or 0.9, function()
		if E.bigToken == token then
			TweenService:Create(E.big, TweenInfo.new(0.25), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
		end
	end)
end

function Hud.callout(text: string, color: Color3?, dur: number?)
	local holder = new("Frame", { Size = UDim2.fromOffset(360, 34), BackgroundColor3 = color or PINK, BackgroundTransparency = 0.1, BorderSizePixel = 0, Parent = E.callouts }, { corner(17) })
	local l = label({ Size = UDim2.new(1, -20, 1, -8), Position = UDim2.fromOffset(10, 4), Text = text, TextStrokeTransparency = 0.6, TextStrokeColor3 = NAVY, Parent = holder })
	local kids = E.callouts:GetChildren()
	if #kids > 4 then
		for _, k in kids do
			if k:IsA("Frame") then
				k:Destroy()
				break
			end
		end
	end
	task.delay(dur or 1.6, function()
		if holder.Parent then
			TweenService:Create(holder, TweenInfo.new(0.3), { BackgroundTransparency = 1 }):Play()
			TweenService:Create(l, TweenInfo.new(0.3), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
			task.wait(0.32)
			holder:Destroy()
		end
	end)
end

--- st: { place, total, lap, laps, speed (м/с), meter, coins, item, roulette, draft, time, finished, order = {{name, me, color}} }
function Hud.race(st)
	E.place.Text = tostring(st.place)
	E.placeOf.Text = "/" .. tostring(st.total)
	E.lap.Text = if st.finished then "ФИНИШ!" else string.format("КРУГ %d/%d", math.clamp(st.lap, 1, st.laps), st.laps)
	E.time.Text = fmtTime(st.time)
	E.speed.Text = tostring(math.floor(math.abs(st.speed) * 3.6 + 0.5))
	local full = math.floor(st.meter + 1e-6)
	for i, s in E.meterSegs do
		local f = math.clamp(st.meter - (i - 1), 0, 1)
		s.fill.Size = UDim2.fromScale(f, 1)
		s.fill.BackgroundTransparency = if f >= 1 then 0 else 0.45
	end
	E.meterKey.TextColor3 = if full >= 1 then WHITE else GREY
	E.coins.Text = "● " .. tostring(st.coins) .. (if st.coins >= 10 then " MAX" else "")
	if st.roulette and st.roulette > 0 then
		local ids = Layout.ITEM_IDS
		local k = ids[(math.floor(os.clock() * 14) % #ids) + 1]
		E.itemIcon.Text = Layout.ITEMS[k].icon
		E.itemName.Text = ""
	elseif st.item then
		E.itemIcon.Text = Layout.ITEMS[st.item].icon
		E.itemName.Text = Layout.ITEMS[st.item].name
	else
		E.itemIcon.Text = ""
		E.itemName.Text = ""
	end
	E.itemHint.Visible = st.item ~= nil
	E.draftBar.Visible = st.draft > 0.05
	E.draftFill.Size = UDim2.fromScale(math.clamp(st.draft / Kart.PHYS.draftTime, 0, 1), 1)
	for i, r in E.boardRows do
		local o = st.order[i]
		r.row.Visible = o ~= nil
		if o then
			r.name.Text = o.name
			r.row.BackgroundColor3 = if o.me then PINK else NAVY
			r.row.BackgroundTransparency = if o.me then 0.05 else 0.3
			r.chip.BackgroundColor3 = o.color or WHITE
		end
	end
end

function Hud.rev(rev: number, charge: number, visible: boolean)
	E.rev.Visible = visible
	E.revNeedle.Position = UDim2.new(0, 10 + math.clamp(rev, 0, 1) * E.revInnerW, 0, 4)
	E.revCharge.Size = UDim2.fromOffset(math.clamp(charge, 0, 1) * E.revInnerW, 5)
end

return Hud
