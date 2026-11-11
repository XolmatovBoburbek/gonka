--!strict
-- Модель машины из простых деталей: восемь кузовов (Shared/Cars), краска на выбор.
-- Корень якорный, остальные детали приварены — двигаем одну деталь за кадр.
-- Эффекты: искры дрифта по уровню, пламя буста, щит, лёд, кручение после попадания, табличка с именем.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local SC = Config.SCALE
local KartModel = {}
KartModel.__index = KartModel

local DRIFT_COLORS = {
	[0] = Color3.fromRGB(255, 255, 255),
	[1] = Color3.fromRGB(85, 184, 255),
	[2] = Color3.fromRGB(255, 165, 58),
	[3] = Color3.fromRGB(255, 85, 224),
}
KartModel.DRIFT_COLORS = DRIFT_COLORS

local BOOST_COLORS = {
	pad = Color3.fromRGB(57, 243, 255),
	boost1 = Color3.fromRGB(85, 184, 255),
	boost2 = Color3.fromRGB(255, 165, 58),
	boost3 = Color3.fromRGB(255, 85, 224),
	item = Color3.fromRGB(255, 120, 40),
	draft = Color3.fromRGB(180, 240, 255),
	rocket = Color3.fromRGB(255, 220, 80),
	trick = Color3.fromRGB(120, 255, 170),
}

local function hex(h: string): Color3
	return Color3.fromHex(h)
end

-- параметры кузовов (метры): ширина, длина, высота борта, кабина, стёкла, колёса, антикрыло
local BODIES = {
	coupe = { w = 1.8, len = 3.3, bh = 0.45, cab = { 1.5, 1.2, 0.42, 0.2 }, ws = 0.6, rw = 0.7, wr = 0.36, spoiler = "lip" },
	sport = { w = 1.9, len = 3.5, bh = 0.36, cab = { 1.45, 1.0, 0.36, 0.25 }, ws = 0.8, rw = 0.9, wr = 0.36, spoiler = "wing" },
	kei = { w = 1.6, len = 2.7, bh = 0.5, cab = { 1.5, 1.3, 0.55, 0.15 }, ws = 0.35, rw = 0.2, wr = 0.32, spoiler = "none" },
	muscle = { w = 1.95, len = 3.6, bh = 0.5, cab = { 1.55, 1.1, 0.4, 0.45 }, ws = 0.55, rw = 0.8, wr = 0.4, spoiler = "lip", scoop = true },
	drift = { w = 1.85, len = 3.4, bh = 0.42, cab = { 1.5, 1.15, 0.4, 0.2 }, ws = 0.65, rw = 0.75, wr = 0.36, spoiler = "big", skirts = true },
	pickup = { w = 1.9, len = 3.6, bh = 0.6, cab = { 1.7, 1.1, 0.6, -0.35 }, ws = 0.4, rw = 0.1, wr = 0.44, spoiler = "none", bed = true },
	buggy = { w = 1.8, len = 3.0, bh = 0.35, wr = 0.46, spoiler = "none", cage = true },
	formula = { w = 0.9, len = 3.6, bh = 0.4, wr = 0.4, spoiler = "none", formula = true },
}

--- car — запись из Shared/Cars, paint — цвет кузова, name — подпись над машиной (не для своей).
function KartModel.new(car, paint: Color3, name: string?, isMe: boolean?)
	local self = setmetatable({}, KartModel)
	local model = Instance.new("Model")
	model.Name = "Car_" .. (name or car.name)
	self.model = model

	local root = Instance.new("Part")
	root.Name = "Root"
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Transparency = 1
	root.Size = Vector3.new(1, 1, 1)
	root.Parent = model
	model.PrimaryPart = root
	self.root = root

	local B = BODIES[car.body] or BODIES.coupe
	local DARK = Color3.fromRGB(34, 34, 44)
	local GLASS = Color3.fromRGB(40, 60, 90)
	local accent = paint:Lerp(Color3.new(1, 1, 1), 0.75)

	-- локальные координаты в метрах: X вправо, Y вверх, −Z вперёд (как LookVector)
	local function add(shape: Enum.PartType?, size: Vector3, pos: Vector3, color: Color3, mat: Enum.Material?, rot: CFrame?, cls: string?): BasePart
		local p: BasePart
		if cls == "Wedge" then
			p = Instance.new("WedgePart")
		else
			local pp = Instance.new("Part")
			if shape then
				pp.Shape = shape
			end
			p = pp
		end
		p.Anchored = false
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.Massless = true
		p.CastShadow = true
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Material = mat or Enum.Material.SmoothPlastic
		p.Size = size * SC
		p.Color = color
		p.CFrame = root.CFrame * CFrame.new(pos * SC) * (rot or CFrame.identity)
		local w = Instance.new("WeldConstraint")
		w.Part0 = root
		w.Part1 = p
		w.Parent = p
		p.Parent = model
		return p
	end
	local function body(size: Vector3, pos: Vector3, color: Color3?): BasePart
		local p = add(nil, size, pos, color or paint, Enum.Material.SmoothPlastic)
		p.Reflectance = 0.18
		return p
	end
	local FLIP = CFrame.Angles(0, math.pi, 0)

	local wr = B.wr
	local ride = wr * 0.55 -- просвет
	local half = B.len / 2
	local top = ride + B.bh -- верх борта

	-- колёса с дисками
	local tx = if B.formula then 0.98 elseif B.cage then B.w / 2 + 0.05 else B.w / 2 - 0.1
	local wheels = {}
	for _, w in { { -tx, -half + 0.65 }, { tx, -half + 0.65 }, { -tx, half - 0.65 }, { tx, half - 0.65 } } do
		local wide = if B.formula or B.cage then 0.42 else 0.3
		table.insert(wheels, add(Enum.PartType.Cylinder, Vector3.new(wide, wr * 2, wr * 2), Vector3.new(w[1], wr, w[2]), Color3.fromRGB(26, 26, 30), Enum.Material.Rubber))
		add(Enum.PartType.Cylinder, Vector3.new(0.04, wr * 1.15, wr * 1.15), Vector3.new(w[1] + (if w[1] > 0 then 1 else -1) * (wide / 2 + 0.005), wr, w[2]), Color3.fromRGB(215, 218, 230), Enum.Material.Metal)
	end

	if B.formula then
		-- болид: узкий монокок, носовой обтекатель, крылья, шлем пилота
		body(Vector3.new(0.9, 0.4, 2.2), Vector3.new(0, ride + 0.2, 0.3))
		local nose = add(nil, Vector3.new(0.6, 0.3, 1.3), Vector3.new(0, ride + 0.15, -1.3), paint, nil, nil, "Wedge")
		nose.Reflectance = 0.18
		add(nil, Vector3.new(1.9, 0.06, 0.45), Vector3.new(0, ride - 0.02, -half + 0.25), accent)
		add(nil, Vector3.new(0.06, 0.3, 0.45), Vector3.new(-0.95, ride + 0.1, -half + 0.25), DARK)
		add(nil, Vector3.new(0.06, 0.3, 0.45), Vector3.new(0.95, ride + 0.1, -half + 0.25), DARK)
		body(Vector3.new(1.5, 0.3, 0.9), Vector3.new(0, ride + 0.15, 0.4), accent) -- понтоны
		add(nil, Vector3.new(1.5, 0.08, 0.5), Vector3.new(0, ride + 0.95, half - 0.2), accent) -- заднее крыло
		add(nil, Vector3.new(0.06, 0.6, 0.5), Vector3.new(-0.72, ride + 0.68, half - 0.2), DARK)
		add(nil, Vector3.new(0.06, 0.6, 0.5), Vector3.new(0.72, ride + 0.68, half - 0.2), DARK)
		add(Enum.PartType.Ball, Vector3.new(0.5, 0.5, 0.5), Vector3.new(0, ride + 0.62, 0.15), Color3.fromRGB(245, 245, 250)) -- шлем
		add(nil, Vector3.new(0.36, 0.14, 0.05), Vector3.new(0, ride + 0.64, -0.08), DARK, Enum.Material.Glass)
		add(nil, Vector3.new(0.5, 0.5, 0.6), Vector3.new(0, ride + 0.62, 0.75), paint) -- воздухозаборник
	elseif B.cage then
		-- багги: открытая рама, каркас безопасности, сиденье
		body(Vector3.new(1.3, B.bh, B.len - 0.2), Vector3.new(0, ride + B.bh / 2, 0))
		local hood = add(nil, Vector3.new(1.3, 0.3, 0.9), Vector3.new(0, top + 0.15, -half + 0.6), paint, nil, nil, "Wedge")
		hood.Reflectance = 0.18
		for _, x in { -0.62, 0.62 } do
			add(nil, Vector3.new(0.08, 0.95, 0.08), Vector3.new(x, top + 0.47, -0.2), DARK, Enum.Material.Metal)
			add(nil, Vector3.new(0.08, 0.95, 0.08), Vector3.new(x, top + 0.47, 0.9), DARK, Enum.Material.Metal)
			add(nil, Vector3.new(0.08, 0.08, 1.2), Vector3.new(x, top + 0.95, 0.35), DARK, Enum.Material.Metal)
		end
		add(nil, Vector3.new(1.32, 0.08, 0.08), Vector3.new(0, top + 0.95, -0.2), DARK, Enum.Material.Metal)
		add(nil, Vector3.new(1.32, 0.08, 0.08), Vector3.new(0, top + 0.95, 0.9), DARK, Enum.Material.Metal)
		add(nil, Vector3.new(0.6, 0.7, 0.2), Vector3.new(0, top + 0.35, 0.6), accent) -- сиденье
		add(nil, Vector3.new(1.0, 0.5, 0.6), Vector3.new(0, top + 0.25, half - 0.4), DARK, Enum.Material.Metal) -- мотор
		add(Enum.PartType.Ball, Vector3.new(0.3, 0.3, 0.3), Vector3.new(-0.4, top + 1.05, -0.2), Color3.fromRGB(255, 240, 180), Enum.Material.Neon)
		add(Enum.PartType.Ball, Vector3.new(0.3, 0.3, 0.3), Vector3.new(0.4, top + 1.05, -0.2), Color3.fromRGB(255, 240, 180), Enum.Material.Neon)
	else
		-- кузов, кабина со стёклами
		body(Vector3.new(B.w, B.bh, B.len), Vector3.new(0, ride + B.bh / 2, 0))
		add(nil, Vector3.new(B.w + 0.04, 0.1, B.len + 0.04), Vector3.new(0, ride + 0.05, 0), DARK) -- юбка
		local cw, cl, ch, cz = B.cab[1], B.cab[2], B.cab[3], B.cab[4]
		body(Vector3.new(cw, ch, cl), Vector3.new(0, top + ch / 2, cz))
		add(nil, Vector3.new(cw + 0.02, ch * 0.62, cl - 0.16), Vector3.new(0, top + ch * 0.55, cz), GLASS, Enum.Material.Glass) -- боковые окна
		add(nil, Vector3.new(cw - 0.08, ch, B.ws), Vector3.new(0, top + ch / 2, cz - cl / 2 - B.ws / 2), GLASS, Enum.Material.Glass, nil, "Wedge") -- лобовое
		add(nil, Vector3.new(cw - 0.08, ch, B.rw), Vector3.new(0, top + ch / 2, cz + cl / 2 + B.rw / 2), GLASS, Enum.Material.Glass, FLIP, "Wedge") -- заднее
		-- бамперы
		add(nil, Vector3.new(B.w + 0.02, 0.16, 0.14), Vector3.new(0, ride + 0.12, -half - 0.03), DARK)
		add(nil, Vector3.new(B.w + 0.02, 0.16, 0.14), Vector3.new(0, ride + 0.12, half + 0.03), DARK)
		-- полоса по капоту и крыше
		add(nil, Vector3.new(0.34, 0.02, B.len - 0.1), Vector3.new(0, top + 0.01, 0), accent)
		if B.scoop then
			add(nil, Vector3.new(0.6, 0.16, 0.7), Vector3.new(0, top + 0.08, -half + 0.9), DARK)
		end
		if B.skirts then
			add(nil, Vector3.new(0.06, 0.14, B.len - 1.5), Vector3.new(-B.w / 2 - 0.02, ride + 0.1, 0), accent)
			add(nil, Vector3.new(0.06, 0.14, B.len - 1.5), Vector3.new(B.w / 2 + 0.02, ride + 0.1, 0), accent)
		end
		if B.bed then
			-- кузов пикапа: борта и тёмный пол
			add(nil, Vector3.new(B.w - 0.2, 0.04, 1.4), Vector3.new(0, top + 0.02, half - 0.8), DARK)
			add(nil, Vector3.new(0.1, 0.32, 1.5), Vector3.new(-B.w / 2 + 0.05, top + 0.16, half - 0.78), paint)
			add(nil, Vector3.new(0.1, 0.32, 1.5), Vector3.new(B.w / 2 - 0.05, top + 0.16, half - 0.78), paint)
			add(nil, Vector3.new(B.w, 0.32, 0.1), Vector3.new(0, top + 0.16, half - 0.05), paint)
		end
		if B.spoiler == "lip" then
			add(nil, Vector3.new(B.w - 0.1, 0.08, 0.3), Vector3.new(0, top + 0.1, half - 0.15), paint)
		elseif B.spoiler == "wing" or B.spoiler == "big" then
			local h = if B.spoiler == "big" then 0.6 else 0.36
			add(nil, Vector3.new(B.w + (if B.spoiler == "big" then 0.1 else -0.2), 0.07, 0.42), Vector3.new(0, top + h, half - 0.2), if B.spoiler == "big" then DARK else paint)
			add(nil, Vector3.new(0.07, h, 0.3), Vector3.new(-B.w / 2 + 0.35, top + h / 2, half - 0.2), DARK)
			add(nil, Vector3.new(0.07, h, 0.3), Vector3.new(B.w / 2 - 0.35, top + h / 2, half - 0.2), DARK)
		end
	end
	-- фары и стоп-сигналы
	if not B.cage then
		local lx = if B.formula then 0.2 else B.w / 2 - 0.3
		local ly = ride + B.bh * 0.62
		for _, x in { -lx, lx } do
			add(nil, Vector3.new(0.36, 0.14, 0.06), Vector3.new(x, ly, -half - (if B.formula then -1.0 else 0.0) - 0.01), Color3.fromRGB(255, 244, 200), Enum.Material.Neon)
			add(nil, Vector3.new(0.4, 0.12, 0.06), Vector3.new(x, ly, half + 0.01), Color3.fromRGB(255, 40, 50), Enum.Material.Neon)
		end
	end
	-- выхлоп
	local exL = add(Enum.PartType.Cylinder, Vector3.new(0.3, 0.14, 0.14), Vector3.new(-0.4, ride + 0.1, half + 0.08), Color3.fromRGB(150, 150, 160), Enum.Material.Metal, CFrame.Angles(0, math.pi / 2, 0))
	add(Enum.PartType.Cylinder, Vector3.new(0.3, 0.14, 0.14), Vector3.new(0.4, ride + 0.1, half + 0.08), Color3.fromRGB(150, 150, 160), Enum.Material.Metal, CFrame.Angles(0, math.pi / 2, 0))
	local kartC = paint
	local flameZ = half + 0.7

	-- эффекты
	local flame = add(Enum.PartType.Ball, Vector3.new(0.4, 0.4, 1.2), Vector3.new(0, ride + 0.2, flameZ), Color3.fromRGB(255, 160, 60), Enum.Material.Neon)
	flame.CastShadow = false
	flame.Transparency = 1
	self.flame = flame
	local shield = add(Enum.PartType.Ball, Vector3.new(4.1, 4.1, 4.1), Vector3.new(0, 1.0, 0), Color3.fromRGB(73, 216, 255), Enum.Material.ForceField)
	shield.CastShadow = false
	shield.Transparency = 1
	self.shield = shield
	local ice = add(nil, Vector3.new(2.6, 2.4, 3.3), Vector3.new(0, 1.0, 0), Color3.fromRGB(159, 232, 255), Enum.Material.Ice)
	ice.CastShadow = false
	ice.Transparency = 1
	self.ice = ice

	-- искры дрифта у задних колёс
	local sparks = {}
	for _, x in { -0.9, 0.9 } do
		local att = Instance.new("Attachment")
		att.Position = Vector3.new(x, 0.1, 1.0) * SC
		att.Parent = root
		local pe = Instance.new("ParticleEmitter")
		pe.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		pe.Rate = 0
		pe.Lifetime = NumberRange.new(0.2, 0.4)
		pe.Speed = NumberRange.new(6, 14)
		pe.SpreadAngle = Vector2.new(35, 35)
		pe.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1.1), NumberSequenceKeypoint.new(1, 0) })
		pe.LightEmission = 1
		pe.Acceleration = Vector3.new(0, -30, 0)
		pe.EmissionDirection = Enum.NormalId.Back
		pe.Parent = att
		local smoke = Instance.new("ParticleEmitter")
		smoke.Texture = "rbxasset://textures/particles/smoke_main.dds"
		smoke.Rate = 0
		smoke.Lifetime = NumberRange.new(0.4, 0.8)
		smoke.Speed = NumberRange.new(1, 3)
		smoke.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1.5), NumberSequenceKeypoint.new(1, 4) })
		smoke.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.5), NumberSequenceKeypoint.new(1, 1) })
		smoke.Color = ColorSequence.new(Color3.fromRGB(232, 228, 240))
		smoke.Parent = att
		table.insert(sparks, { pe = pe, smoke = smoke })
	end
	self.sparks = sparks
	self.exhaust = exL

	-- табличка с именем
	if not isMe then
		local bb = Instance.new("BillboardGui")
		bb.Size = UDim2.fromOffset(160, 34)
		bb.StudsOffsetWorldSpace = Vector3.new(0, 2.5 * SC, 0)
		bb.AlwaysOnTop = false
		bb.MaxDistance = 250
		bb.LightInfluence = 0
		local tl = Instance.new("TextLabel")
		tl.Size = UDim2.fromScale(1, 1)
		tl.BackgroundTransparency = 1
		tl.Text = name or char.name
		tl.Font = Enum.Font.FredokaOne
		tl.TextScaled = true
		tl.TextColor3 = Color3.new(1, 1, 1)
		tl.TextStrokeColor3 = kartC
		tl.TextStrokeTransparency = 0
		tl.Parent = bb
		bb.Parent = root
		self.tag = tl
	end

	self.wheels = wheels
	self.spin = 0
	self.wheelRot = 0
	return self
end

function KartModel:setParent(p: Instance?)
	self.model.Parent = p
end

function KartModel:destroy()
	self.model:Destroy()
end

--- s: { pos (м), heading, moveHeading, surfaceUp, speed, airborne, drifting, driftDir, driftLevel,
---      boostKind, shield, frozen, spinning, trick, hop }
function KartModel:update(dt: number, s)
	local up: Vector3 = s.surfaceUp or Vector3.yAxis
	local h = s.heading
	if s.spinning then
		self.spin += dt * 13
	else
		self.spin = 0
	end
	h += self.spin
	local fwd = Vector3.new(math.sin(h), 0, math.cos(h))
	local right = fwd:Cross(up)
	if right.Magnitude < 1e-3 then
		right = Vector3.xAxis
	end
	right = right.Unit
	fwd = up:Cross(right).Unit
	local back = right:Cross(up)
	local cf = CFrame.fromMatrix(s.pos * SC, right, up, back)
	if s.trick then
		self.trickT = (self.trickT or 0) + dt
		cf *= CFrame.Angles(-math.min(1, self.trickT / 0.45) * math.pi * 2, 0, 0)
	else
		self.trickT = 0
	end
	-- крен в заносе
	if s.drifting then
		cf *= CFrame.Angles(0, 0, -0.08 * (s.driftDir or 0))
	end
	self.root.CFrame = cf

	-- эффекты
	local bk = s.boostKind or ""
	if bk ~= "" then
		self.flame.Transparency = 0.1 + math.random() * 0.25
		self.flame.Color = BOOST_COLORS[bk] or Color3.fromRGB(255, 160, 60)
	else
		self.flame.Transparency = 1
	end
	self.shield.Transparency = if s.shield then 0.25 else 1
	self.ice.Transparency = if s.frozen then 0.35 else 1
	local lvl = if s.drifting then (s.driftLevel or 0) else -1
	for _, sp in self.sparks do
		if lvl >= 1 and not s.airborne then
			sp.pe.Rate = 40 + lvl * 25
			sp.pe.Color = ColorSequence.new(DRIFT_COLORS[lvl])
		else
			sp.pe.Rate = 0
		end
		sp.smoke.Rate = if lvl >= 0 and not s.airborne then 18 else 0
	end
end

return KartModel
