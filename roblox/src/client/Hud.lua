--!strict
-- Интерфейс: место и круг, скорость, шкала буста (3 деления), предмет с рулеткой, монеты, слипстрим,
-- обороты на старте с зелёной зоной, отсчёт и подсказки, мини-таблица мест, лобби и гараж гонщиков,
-- итоги гонки и Гран-при, сенсорные кнопки на телефоне.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Characters = require(Shared:WaitForChild("Characters"))
local Layout = require(Shared:WaitForChild("Layout"))
local Kart = require(Shared:WaitForChild("Kart"))
local Input = require(script.Parent:WaitForChild("Input"))

local Hud = {}

local PINK = Color3.fromRGB(255, 93, 147)
local CYAN = Color3.fromRGB(57, 243, 255)
local DARK = Color3.fromRGB(26, 20, 44)
local WHITE = Color3.new(1, 1, 1)
local GOLD = Color3.fromRGB(255, 200, 40)
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

local function stroke(c: Color3, t: number): UIStroke
	return new("UIStroke", { Color = c, Thickness = t, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })
end

local function label(props: { [string]: any }): TextLabel
	local p = {
		BackgroundTransparency = 1,
		TextColor3 = WHITE,
		Font = TXT,
		TextScaled = true,
		TextStrokeTransparency = 0.4,
		TextStrokeColor3 = DARK,
	}
	for k, v in props do
		p[k] = v
	end
	return new("TextLabel", p)
end

local function panel(props: { [string]: any }): Frame
	local p = { BackgroundColor3 = DARK, BackgroundTransparency = 0.25, BorderSizePixel = 0 }
	for k, v in props do
		p[k] = v
	end
	local f = new("Frame", p, { corner(12) })
	return f
end

local function button(props: { [string]: any }, onClick: () -> ()): TextButton
	local p = {
		BackgroundColor3 = PINK,
		AutoButtonColor = true,
		TextColor3 = WHITE,
		Font = TXT,
		TextScaled = true,
		BorderSizePixel = 0,
	}
	for k, v in props do
		p[k] = v
	end
	local b = new(
		"TextButton",
		p,
		{
			corner(10),
			new("UIPadding", { PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6), PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8) }),
		}
	)
	b.Activated:Connect(onClick)
	return b
end

local gui: ScreenGui
local E: { [string]: any } = {}
local charById = {}
for _, c in Characters do
	charById[c.id] = c
end

local isTouch = UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled

function Hud.init(callbacks)
	local pg = Players.LocalPlayer:WaitForChild("PlayerGui")
	gui = new("ScreenGui", { Name = "SakuraHud", ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Enum.ZIndexBehavior.Sibling, Parent = pg })
	E.callbacks = callbacks

	-- ---- гонка
	local race = new("Frame", { Name = "Race", Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false, Parent = gui })
	E.race = race
	E.place = label({
		Size = UDim2.fromOffset(150, 96),
		Position = UDim2.fromOffset(18, 18),
		Font = NUM,
		Text = "1",
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = WHITE,
		TextStrokeColor3 = PINK,
		TextStrokeTransparency = 0,
		Parent = race,
	})
	E.placeOf = label({
		Size = UDim2.fromOffset(80, 34),
		Position = UDim2.fromOffset(84, 66),
		Font = NUM,
		Text = "/8",
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = race,
	})
	E.lap = label({
		Size = UDim2.fromOffset(220, 30),
		Position = UDim2.fromOffset(20, 116),
		Text = "КРУГ 1/3",
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = race,
	})
	E.time = label({
		Size = UDim2.fromOffset(220, 24),
		Position = UDim2.fromOffset(20, 146),
		Font = NUM,
		Text = "0:00.00",
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = race,
	})

	-- мини-таблица мест
	local board = new(
		"Frame",
		{ Size = UDim2.fromOffset(190, 8 * 22), Position = UDim2.fromOffset(18, 182), BackgroundTransparency = 1, Parent = race },
		{ new("UIListLayout", { Padding = UDim.new(0, 2), SortOrder = Enum.SortOrder.LayoutOrder }) }
	)
	E.board = board
	E.boardRows = {}
	for i = 1, 8 do
		local row = panel({ Size = UDim2.fromOffset(190, 20), LayoutOrder = i, BackgroundTransparency = 0.45, Parent = board })
		local num = label({ Size = UDim2.fromOffset(22, 20), Font = NUM, Text = tostring(i), Parent = row })
		local nm = label({
			Size = UDim2.new(1, -30, 1, -4),
			Position = UDim2.fromOffset(28, 2),
			Font = TXT2,
			Text = "",
			TextXAlignment = Enum.TextXAlignment.Left,
			Parent = row,
		})
		E.boardRows[i] = { row = row, num = num, name = nm }
	end

	-- предмет и монеты (справа сверху)
	local itemBox = panel({ Size = UDim2.fromOffset(96, 96), Position = UDim2.new(1, -116, 0, 18), Parent = race }, {})
	stroke(WHITE, 3).Parent = itemBox
	E.itemBox = itemBox
	E.itemIcon = label({ Size = UDim2.fromScale(0.8, 0.8), Position = UDim2.fromScale(0.1, 0.05), Font = NUM, Text = "", Parent = itemBox })
	E.itemName = label({ Size = UDim2.new(1, 0, 0, 18), Position = UDim2.new(0, 0, 1, 2), Font = TXT2, Text = "", Parent = itemBox })
	E.coins = label({
		Size = UDim2.fromOffset(160, 32),
		Position = UDim2.new(1, -180, 0, 140),
		Font = NUM,
		Text = "● 0",
		TextColor3 = GOLD,
		TextXAlignment = Enum.TextXAlignment.Right,
		Parent = race,
	})
	E.draftBar =
		panel({ Size = UDim2.fromOffset(150, 10), Position = UDim2.new(1, -170, 0, 178), BackgroundTransparency = 0.4, Visible = false, Parent = race })
	E.draftFill = new(
		"Frame",
		{ Size = UDim2.fromScale(0, 1), BackgroundColor3 = Color3.fromRGB(180, 240, 255), BorderSizePixel = 0, Parent = E.draftBar },
		{ corner(5) }
	)
	E.draftLabel = label({
		Size = UDim2.fromOffset(150, 18),
		Position = UDim2.fromOffset(0, -20),
		Font = TXT2,
		Text = "СЛИПСТРИМ",
		TextColor3 = Color3.fromRGB(180, 240, 255),
		Parent = E.draftBar,
	})

	-- скорость и шкала буста (внизу слева)
	E.speed = label({
		Size = UDim2.fromOffset(200, 58),
		Position = UDim2.new(0, 22, 1, -150),
		Font = NUM,
		Text = "0",
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = race,
	})
	E.speedUnit = label({
		Size = UDim2.fromOffset(80, 22),
		Position = UDim2.new(0, 24, 1, -94),
		Font = TXT2,
		Text = "км/ч",
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = race,
	})
	local meter = new(
		"Frame",
		{ Size = UDim2.fromOffset(234, 24), Position = UDim2.new(0, 22, 1, -66), BackgroundTransparency = 1, Parent = race },
		{ new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 6) }) }
	)
	E.meterSegs = {}
	local segCol = { Color3.fromRGB(85, 184, 255), Color3.fromRGB(255, 165, 58), Color3.fromRGB(255, 85, 224) }
	for i = 1, 3 do
		local seg = panel({ Size = UDim2.fromOffset(74, 24), BackgroundTransparency = 0.35, Parent = meter })
		stroke(WHITE, 2).Parent = seg
		local fill = new("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = segCol[i], BorderSizePixel = 0, Parent = seg }, { corner(12) })
		E.meterSegs[i] = { seg = seg, fill = fill }
	end
	E.meterHint = label({
		Size = UDim2.fromOffset(234, 18),
		Position = UDim2.new(0, 22, 1, -38),
		Font = TXT2,
		Text = if isTouch then "БУСТ — кнопка ⚡" else "БУСТ — F / X",
		TextTransparency = 0.2,
		Parent = race,
	})

	-- обороты на старте
	local rev = panel({ Size = UDim2.fromOffset(420, 44), Position = UDim2.new(0.5, -210, 1, -170), Visible = false, Parent = gui })
	E.rev = rev
	local Z = Kart.PHYS.revZones
	local function zone(a: number, b: number, c: Color3)
		new("Frame", { Size = UDim2.new(b - a, 0, 1, -16), Position = UDim2.new(a, 0, 0, 8), BackgroundColor3 = c, BorderSizePixel = 0, Parent = rev })
	end
	zone(0, Z.good, Color3.fromRGB(70, 70, 90))
	zone(Z.good, Z.perfect, Color3.fromRGB(80, 200, 110))
	zone(Z.perfect, Z.perfectTop, Color3.fromRGB(60, 255, 120))
	zone(Z.perfectTop, Z.red, Color3.fromRGB(80, 200, 110))
	zone(Z.red, 1, Color3.fromRGB(255, 60, 70))
	E.revNeedle = new(
		"Frame",
		{ Size = UDim2.new(0, 6, 1, 6), Position = UDim2.new(0, -3, 0, -3), BackgroundColor3 = WHITE, BorderSizePixel = 0, Parent = rev },
		{ corner(3) }
	)
	E.revCharge = new("Frame", { Size = UDim2.new(0, 0, 0, 5), Position = UDim2.new(0, 0, 1, 2), BackgroundColor3 = GOLD, BorderSizePixel = 0, Parent = rev })
	E.revHint = label({
		Size = UDim2.new(1, 0, 0, 22),
		Position = UDim2.new(0, 0, 0, -26),
		Font = TXT2,
		Text = if isTouch
			then "Держите ГАЗ в зелёной зоне — рывок на старте!"
			else "Держите ↑/W в зелёной зоне — рывок на старте!",
		Parent = rev,
	})

	-- центр: отсчёт и подсказки
	E.big = label({
		Size = UDim2.fromOffset(600, 140),
		Position = UDim2.new(0.5, -300, 0.22, 0),
		Font = NUM,
		Text = "",
		TextColor3 = WHITE,
		TextStrokeColor3 = PINK,
		TextStrokeTransparency = 0,
		Parent = gui,
	})
	E.callouts = new(
		"Frame",
		{ Size = UDim2.fromOffset(520, 120), Position = UDim2.new(0.5, -260, 0, 14), BackgroundTransparency = 1, Parent = gui },
		{ new("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 4) }) }
	)

	-- баннер фазы (лобби/облёт/зритель)
	E.banner = panel({ Size = UDim2.fromOffset(560, 110), Position = UDim2.new(0.5, -280, 0, 70), Visible = false, Parent = gui })
	E.bannerTitle = label({
		Size = UDim2.new(1, -20, 0, 54),
		Position = UDim2.fromOffset(10, 8),
		Text = "",
		TextColor3 = WHITE,
		TextStrokeColor3 = PINK,
		TextStrokeTransparency = 0,
		Parent = E.banner,
	})
	E.bannerSub = label({ Size = UDim2.new(1, -20, 0, 32), Position = UDim2.fromOffset(10, 66), Font = TXT2, Text = "", Parent = E.banner })

	-- кошелёк и гараж
	E.wallet = label({
		Size = UDim2.fromOffset(200, 30),
		Position = UDim2.new(1, -220, 1, -48),
		Font = NUM,
		Text = "● 0",
		TextColor3 = GOLD,
		TextXAlignment = Enum.TextXAlignment.Right,
		Visible = false,
		Parent = gui,
	})
	E.garageBtn = button(
		{ Size = UDim2.fromOffset(200, 50), Position = UDim2.new(1, -220, 1, -110), Text = "ГАРАЖ", Visible = false, Parent = gui },
		function()
			Hud.openGarage(not E.garage.Visible)
		end
	)
	Hud.buildGarage()

	-- итоги
	E.results =
		panel({ Size = UDim2.fromOffset(620, 470), Position = UDim2.new(0.5, -310, 0.5, -235), Visible = false, BackgroundTransparency = 0.12, Parent = gui })
	stroke(PINK, 3).Parent = E.results
	E.resTitle = label({
		Size = UDim2.new(1, -20, 0, 46),
		Position = UDim2.fromOffset(10, 10),
		Text = "ИТОГИ",
		TextColor3 = WHITE,
		TextStrokeColor3 = PINK,
		TextStrokeTransparency = 0,
		Parent = E.results,
	})
	E.resList = new(
		"Frame",
		{ Size = UDim2.new(1, -30, 0, 8 * 34), Position = UDim2.fromOffset(15, 62), BackgroundTransparency = 1, Parent = E.results },
		{ new("UIListLayout", { Padding = UDim.new(0, 3), SortOrder = Enum.SortOrder.LayoutOrder }) }
	)
	E.resReward = label({ Size = UDim2.new(1, -30, 0, 28), Position = UDim2.new(0, 15, 1, -96), Font = TXT2, Text = "", TextColor3 = GOLD, Parent = E.results })
	E.resNext = label({ Size = UDim2.new(1, -30, 0, 24), Position = UDim2.new(0, 15, 1, -60), Font = TXT2, Text = "", Parent = E.results })

	if isTouch then
		Hud.buildTouch()
	end
end

-- ---------------------------------------------------------------- сенсорные кнопки

function Hud.buildTouch()
	local t = new("Frame", { Name = "Touch", Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false, Parent = gui })
	E.touch = t
	local function hold(text: string, pos: UDim2, size: number, color: Color3, onDown: () -> (), onUp: () -> ())
		local b = new(
			"TextButton",
			{
				Size = UDim2.fromOffset(size, size),
				Position = pos,
				Text = text,
				BackgroundColor3 = color,
				BackgroundTransparency = 0.25,
				TextColor3 = WHITE,
				Font = TXT,
				TextScaled = true,
				AutoButtonColor = false,
				Parent = t,
			},
			{ new("UICorner", { CornerRadius = UDim.new(1, 0) }), stroke(WHITE, 2) }
		)
		b.InputBegan:Connect(function(io)
			if io.UserInputType == Enum.UserInputType.Touch then
				onDown()
			end
		end)
		b.InputEnded:Connect(function(io)
			if io.UserInputType == Enum.UserInputType.Touch then
				onUp()
			end
		end)
	end
	local tch = Input.touch
	local left, right = false, false
	local function upd()
		tch.steer = (if right then 1 else 0) - (if left then 1 else 0)
	end
	hold("◀", UDim2.new(0, 24, 1, -130), 100, DARK, function()
		left = true
		upd()
	end, function()
		left = false
		upd()
	end)
	hold("▶", UDim2.new(0, 140, 1, -130), 100, DARK, function()
		right = true
		upd()
	end, function()
		right = false
		upd()
	end)
	hold("ГАЗ", UDim2.new(1, -130, 1, -140), 110, Color3.fromRGB(60, 200, 110), function()
		tch.gas = true
	end, function()
		tch.gas = false
	end)
	hold("ТОРМ", UDim2.new(1, -230, 1, -100), 80, Color3.fromRGB(120, 120, 140), function()
		tch.brake = true
	end, function()
		tch.brake = false
	end)
	hold("ДРИФТ", UDim2.new(1, -240, 1, -200), 90, PINK, function()
		tch.drift = true
		Input.press("drift")
	end, function()
		tch.drift = false
	end)
	hold("⚡", UDim2.new(1, -120, 1, -240), 80, Color3.fromRGB(85, 184, 255), function()
		Input.press("boost")
	end, function() end)
	hold("✦", UDim2.new(1, -330, 1, -170), 80, Color3.fromRGB(160, 90, 255), function()
		Input.press("item")
	end, function() end)
	-- на телефоне шкала и скорость — повыше, чтобы не мешали кнопки
	E.speed.Position = UDim2.new(0, 22, 1, -260)
	E.speedUnit.Position = UDim2.new(0, 24, 1, -204)
	E.meterSegs[1].seg.Parent.Position = UDim2.new(0, 22, 1, -176)
	E.meterHint.Visible = false
end

-- ---------------------------------------------------------------- гараж

function Hud.buildGarage()
	local g =
		panel({ Size = UDim2.fromOffset(720, 440), Position = UDim2.new(0.5, -360, 0.5, -220), Visible = false, BackgroundTransparency = 0.08, Parent = gui })
	stroke(PINK, 3).Parent = g
	E.garage = g
	label({
		Size = UDim2.new(1, -20, 0, 42),
		Position = UDim2.fromOffset(10, 8),
		Text = "ГАРАЖ — ВЫБОР ГОНЩИКА",
		TextColor3 = WHITE,
		TextStrokeColor3 = PINK,
		TextStrokeTransparency = 0,
		Parent = g,
	})
	E.garageWallet = label({
		Size = UDim2.fromOffset(200, 26),
		Position = UDim2.new(1, -220, 0, 14),
		Font = NUM,
		Text = "● 0",
		TextColor3 = GOLD,
		TextXAlignment = Enum.TextXAlignment.Right,
		Parent = g,
	})
	local grid = new(
		"ScrollingFrame",
		{
			Size = UDim2.new(1, -24, 1, -110),
			Position = UDim2.fromOffset(12, 56),
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			ScrollBarThickness = 6,
			CanvasSize = UDim2.new(),
			AutomaticCanvasSize = Enum.AutomaticSize.Y,
			Parent = g,
		},
		{
			new("UIGridLayout", { CellSize = UDim2.fromOffset(164, 150), CellPadding = UDim2.fromOffset(8, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
		}
	)
	E.cards = {}
	for i, c in Characters do
		local card = new("Frame", { BackgroundColor3 = Color3.fromRGB(44, 36, 70), BorderSizePixel = 0, LayoutOrder = i, Parent = grid }, { corner(10) })
		local st = stroke(Color3.fromHex(c.kart), 2)
		st.Parent = card
		new("Frame", { Size = UDim2.new(1, 0, 0, 8), BackgroundColor3 = Color3.fromHex(c.kart), BorderSizePixel = 0, Parent = card }, { corner(4) })
		label({
			Size = UDim2.new(1, -10, 0, 24),
			Position = UDim2.fromOffset(5, 12),
			Text = c.emblem .. " " .. c.name,
			TextXAlignment = Enum.TextXAlignment.Left,
			Parent = card,
		})
		label({
			Size = UDim2.new(1, -10, 0, 16),
			Position = UDim2.fromOffset(5, 36),
			Font = TXT2,
			Text = c.title,
			TextTransparency = 0.2,
			TextXAlignment = Enum.TextXAlignment.Left,
			Parent = card,
		})
		local y = 56
		for _, s in { { "СКОР", c.stats.speed }, { "РАЗГ", c.stats.accel }, { "УПР", c.stats.handling } } do
			label({
				Size = UDim2.fromOffset(44, 14),
				Position = UDim2.fromOffset(6, y),
				Font = TXT2,
				Text = s[1],
				TextXAlignment = Enum.TextXAlignment.Left,
				Parent = card,
			})
			local bar = new(
				"Frame",
				{
					Size = UDim2.new(1, -62, 0, 8),
					Position = UDim2.fromOffset(52, y + 3),
					BackgroundColor3 = Color3.fromRGB(70, 60, 100),
					BorderSizePixel = 0,
					Parent = card,
				},
				{ corner(4) }
			)
			new("Frame", { Size = UDim2.fromScale(s[2] / 5, 1), BackgroundColor3 = Color3.fromHex(c.kart), BorderSizePixel = 0, Parent = bar }, { corner(4) })
			y += 17
		end
		local btn = button({ Size = UDim2.new(1, -12, 0, 32), Position = UDim2.new(0, 6, 1, -38), Text = "", Parent = card }, function()
			local cb = E.callbacks
			local prof = E.profile
			if not prof or not cb then
				return
			end
			if prof.owned[c.id] then
				cb.select(c.id)
			else
				cb.buy(c.id)
			end
		end)
		E.cards[c.id] = { card = card, btn = btn, stroke = st }
	end
	button(
		{
			Size = UDim2.fromOffset(160, 40),
			Position = UDim2.new(0.5, -80, 1, -50),
			Text = "ЗАКРЫТЬ",
			BackgroundColor3 = Color3.fromRGB(90, 80, 130),
			Parent = g,
		},
		function()
			Hud.openGarage(false)
		end
	)
end

function Hud.openGarage(on: boolean)
	E.garage.Visible = on
end

function Hud.setProfile(prof)
	if not prof then
		return
	end
	E.profile = prof
	E.wallet.Text = "● " .. tostring(prof.coins)
	E.garageWallet.Text = "● " .. tostring(prof.coins)
	for id, card in E.cards do
		local c = charById[id]
		if prof.selected == id then
			card.btn.Text = "ВЫБРАН"
			card.btn.BackgroundColor3 = Color3.fromRGB(60, 200, 110)
			card.stroke.Thickness = 4
		elseif prof.owned[id] then
			card.btn.Text = "ВЫБРАТЬ"
			card.btn.BackgroundColor3 = PINK
			card.stroke.Thickness = 2
		else
			card.btn.Text = "● " .. tostring(c.price)
			card.btn.BackgroundColor3 = if prof.coins >= c.price then GOLD else Color3.fromRGB(90, 80, 110)
			card.stroke.Thickness = 2
		end
	end
end

-- ---------------------------------------------------------------- состояние экрана

--- mode: 'lobby' | 'intro' | 'countdown' | 'race' | 'results' | 'spectate'
function Hud.setMode(mode: string, info: { [string]: any }?)
	local i = info or {}
	E.mode = mode
	local racing = mode == "countdown" or mode == "race"
	E.race.Visible = racing
	if E.touch then
		E.touch.Visible = racing
	end
	E.rev.Visible = mode == "countdown" and i.onGrid == true
	E.wallet.Visible = mode == "lobby" or mode == "results" or mode == "intro" or mode == "spectate"
	E.garageBtn.Visible = mode == "lobby" or mode == "results" or mode == "spectate"
	if not E.garageBtn.Visible then
		Hud.openGarage(false)
	end
	E.results.Visible = mode == "results"
	E.banner.Visible = mode == "lobby" or mode == "intro" or mode == "spectate"
	if mode ~= "countdown" and mode ~= "race" then
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
	local l = label({
		Size = UDim2.fromOffset(520, 36),
		Text = text,
		TextColor3 = WHITE,
		TextStrokeColor3 = color or PINK,
		TextStrokeTransparency = 0,
		Parent = E.callouts,
	})
	local kids = E.callouts:GetChildren()
	if #kids > 4 then
		for _, k in kids do
			if k:IsA("TextLabel") then
				k:Destroy()
				break
			end
		end
	end
	task.delay(dur or 1.6, function()
		if l.Parent then
			TweenService:Create(l, TweenInfo.new(0.3), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
			task.wait(0.32)
			l:Destroy()
		end
	end)
end

local function fmtTime(t: number?): string
	if not t then
		return "—"
	end
	local m = math.floor(t / 60)
	local s = t - m * 60
	return string.format("%d:%05.2f", m, s)
end
Hud.fmtTime = fmtTime

--- st: { place, total, lap, laps, speed (м/с), meter, coins, item, roulette, draft, time, wrongWay, order = {{name, me, color}} }
function Hud.race(st)
	E.place.Text = tostring(st.place)
	E.placeOf.Text = "/" .. tostring(st.total)
	E.lap.Text = if st.finished then "ФИНИШ!" else string.format("КРУГ %d/%d", math.clamp(st.lap, 1, st.laps), st.laps)
	E.time.Text = fmtTime(st.time)
	E.speed.Text = tostring(math.floor(math.abs(st.speed) * 3.6 + 0.5))
	for i, s in E.meterSegs do
		local f = math.clamp(st.meter - (i - 1), 0, 1)
		s.fill.Size = UDim2.fromScale(f, 1)
		s.fill.BackgroundTransparency = if f >= 1 then 0 else 0.35
	end
	E.coins.Text = "● " .. tostring(st.coins) .. (if st.coins >= 10 then " MAX" else "")
	-- предмет
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
	E.draftBar.Visible = st.draft > 0.05
	E.draftFill.Size = UDim2.fromScale(math.clamp(st.draft / Kart.PHYS.draftTime, 0, 1), 1)
	for i, r in E.boardRows do
		local o = st.order[i]
		r.row.Visible = o ~= nil
		if o then
			r.name.Text = o.name
			r.row.BackgroundColor3 = if o.me then PINK else DARK
			r.row.BackgroundTransparency = if o.me then 0.1 else 0.45
			r.num.TextColor3 = o.color or WHITE
		end
	end
end

function Hud.rev(rev: number, charge: number, visible: boolean)
	E.rev.Visible = visible
	E.revNeedle.Position = UDim2.new(math.clamp(rev, 0, 1), -3, 0, -3)
	E.revCharge.Size = UDim2.new(math.clamp(charge, 0, 1), 0, 0, 5)
end

--- data: { list = {{id,name,charId,place,time,finished,gain,total,isBot}}, final, standings, raceNum, raceCount }
function Hud.showResults(data, myId: number, myKey: string?)
	for _, c in E.resList:GetChildren() do
		if c:IsA("Frame") then
			c:Destroy()
		end
	end
	if data.final then
		E.resTitle.Text = "ИТОГ ГРАН-ПРИ"
		for i, st in data.standings do
			if i > 8 then
				break
			end
			local me = st.key == myKey
			local row = panel({
				Size = UDim2.new(1, 0, 0, 31),
				LayoutOrder = i,
				BackgroundColor3 = if me then PINK else Color3.fromRGB(50, 40, 80),
				BackgroundTransparency = 0.15,
				Parent = E.resList,
			})
			label({
				Size = UDim2.fromOffset(40, 27),
				Position = UDim2.fromOffset(6, 2),
				Font = NUM,
				Text = tostring(i),
				TextColor3 = if i <= 3 then GOLD else WHITE,
				Parent = row,
			})
			label({
				Size = UDim2.new(1, -170, 0, 25),
				Position = UDim2.fromOffset(52, 3),
				Font = TXT2,
				Text = st.name,
				TextXAlignment = Enum.TextXAlignment.Left,
				Parent = row,
			})
			label({
				Size = UDim2.fromOffset(100, 25),
				Position = UDim2.new(1, -110, 0, 3),
				Font = NUM,
				Text = tostring(st.total) .. " оч.",
				TextXAlignment = Enum.TextXAlignment.Right,
				Parent = row,
			})
		end
	else
		E.resTitle.Text = string.format("ГОНКА %d/%d — ИТОГИ", data.raceNum, data.raceCount)
		for _, r in data.list do
			local me = r.id == myId
			local row = panel({
				Size = UDim2.new(1, 0, 0, 31),
				LayoutOrder = r.place,
				BackgroundColor3 = if me then PINK else Color3.fromRGB(50, 40, 80),
				BackgroundTransparency = 0.15,
				Parent = E.resList,
			})
			label({
				Size = UDim2.fromOffset(40, 27),
				Position = UDim2.fromOffset(6, 2),
				Font = NUM,
				Text = tostring(r.place),
				TextColor3 = if r.place <= 3 then GOLD else WHITE,
				Parent = row,
			})
			local c = charById[r.charId]
			new(
				"Frame",
				{
					Size = UDim2.fromOffset(8, 22),
					Position = UDim2.fromOffset(46, 4),
					BackgroundColor3 = if c then Color3.fromHex(c.kart) else WHITE,
					BorderSizePixel = 0,
					Parent = row,
				},
				{ corner(3) }
			)
			label({
				Size = UDim2.new(1, -300, 0, 25),
				Position = UDim2.fromOffset(62, 3),
				Font = TXT2,
				Text = r.name .. (if r.isBot then "" else " ★"),
				TextXAlignment = Enum.TextXAlignment.Left,
				Parent = row,
			})
			label({
				Size = UDim2.fromOffset(110, 25),
				Position = UDim2.new(1, -230, 0, 3),
				Font = NUM,
				Text = if r.finished then fmtTime(r.time) else "—",
				Parent = row,
			})
			label({
				Size = UDim2.fromOffset(110, 25),
				Position = UDim2.new(1, -116, 0, 3),
				Font = NUM,
				Text = string.format("+%d (%d)", r.gain, r.total),
				TextXAlignment = Enum.TextXAlignment.Right,
				Parent = row,
			})
		end
	end
	E.resReward.Text = ""
	E.resNext.Text = if data.final
		then "Новый Гран-при скоро начнётся"
		else "Следующая трасса через несколько секунд…"
end

function Hud.showReward(rw)
	local parts = { string.format("Собрано монет: %d", rw.collected), string.format("За место: +%d", rw.placeBonus) }
	if rw.cupBonus and rw.cupBonus > 0 then
		table.insert(parts, string.format("Кубок (%d место): +%d", rw.cupPlace, rw.cupBonus))
	end
	E.resReward.Text = table.concat(parts, "   ·   ") .. string.format("   =  ● %d", rw.total)
end

return Hud
