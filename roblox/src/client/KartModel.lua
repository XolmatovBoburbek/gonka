--!strict
-- Модель карта с пилотом в аниме-стиле из простых деталей (цвета гонщика из Shared/Characters).
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

function KartModel.new(char, name: string?, isMe: boolean?)
	local self = setmetatable({}, KartModel)
	local model = Instance.new("Model")
	model.Name = "Kart_" .. (name or char.name)
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

	local kartC = hex(char.kart)
	local accC = hex(char.kartAccent)
	local trimC = hex(char.trim)

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

	-- шасси и корпус
	add(nil, Vector3.new(1.7, 0.28, 2.5), Vector3.new(0, 0.42, 0), Color3.fromRGB(40, 40, 52))
	add(nil, Vector3.new(1.5, 0.42, 1.6), Vector3.new(0, 0.72, 0.15), kartC)
	add(nil, Vector3.new(1.3, 0.38, 0.9), Vector3.new(0, 0.68, -1.05), kartC, nil, nil, "Wedge")
	add(nil, Vector3.new(1.55, 0.14, 0.35), Vector3.new(0, 0.5, -1.45), accC) -- бампер
	add(nil, Vector3.new(1.62, 0.1, 1.7), Vector3.new(0, 0.95, 0.15), trimC) -- кант
	add(nil, Vector3.new(1.8, 0.1, 0.4), Vector3.new(0, 1.35, 1.25), accC) -- спойлер
	add(nil, Vector3.new(0.1, 0.4, 0.1), Vector3.new(-0.6, 1.15, 1.2), Color3.fromRGB(40, 40, 52))
	add(nil, Vector3.new(0.1, 0.4, 0.1), Vector3.new(0.6, 1.15, 1.2), Color3.fromRGB(40, 40, 52))
	-- колёса
	local wheels = {}
	for _, w in { { -0.85, -0.85 }, { 0.85, -0.85 }, { -0.88, 0.9 }, { 0.88, 0.9 } } do
		local big = w[2] > 0
		local r = if big then 0.42 else 0.36
		table.insert(
			wheels,
			add(Enum.PartType.Cylinder, Vector3.new(if big then 0.42 else 0.34, r * 2, r * 2), Vector3.new(w[1], r, w[2]), Color3.fromRGB(30, 30, 36))
		)
		add(
			Enum.PartType.Cylinder,
			Vector3.new(0.05, r * 1.1, r * 1.1),
			Vector3.new(w[1] + (if w[1] > 0 then 1 else -1) * (if big then 0.22 else 0.18), r, w[2]),
			trimC,
			Enum.Material.Metal
		)
	end
	-- выхлоп
	local exL = add(
		Enum.PartType.Cylinder,
		Vector3.new(0.35, 0.18, 0.18),
		Vector3.new(-0.35, 0.62, 1.35),
		Color3.fromRGB(150, 150, 160),
		Enum.Material.Metal,
		CFrame.Angles(0, math.pi / 2, 0)
	)
	add(
		Enum.PartType.Cylinder,
		Vector3.new(0.35, 0.18, 0.18),
		Vector3.new(0.35, 0.62, 1.35),
		Color3.fromRGB(150, 150, 160),
		Enum.Material.Metal,
		CFrame.Angles(0, math.pi / 2, 0)
	)

	-- пилот
	local skin = hex(char.skin)
	local hair = hex(char.hair)
	add(nil, Vector3.new(0.75, 0.6, 0.5), Vector3.new(0, 1.2, 0.35), hex(char.outfit)) -- торс
	add(nil, Vector3.new(0.77, 0.12, 0.52), Vector3.new(0, 1.05, 0.35), hex(char.outfitAccent))
	add(Enum.PartType.Ball, Vector3.new(0.78, 0.78, 0.78), Vector3.new(0, 1.82, 0.3), skin) -- голова
	add(Enum.PartType.Ball, Vector3.new(0.9, 0.86, 0.9), Vector3.new(0, 1.92, 0.42), hair, Enum.Material.SmoothPlastic) -- волосы
	add(nil, Vector3.new(0.86, 0.22, 0.3), Vector3.new(0, 2.12, 0.02), hair) -- чёлка
	add(Enum.PartType.Ball, Vector3.new(0.34, 0.5, 0.34), Vector3.new(-0.42, 1.7, 0.55), hair) -- хвостики
	add(Enum.PartType.Ball, Vector3.new(0.34, 0.5, 0.34), Vector3.new(0.42, 1.7, 0.55), hair)
	add(nil, Vector3.new(0.12, 0.2, 0.04), Vector3.new(-0.15, 1.84, -0.09), Color3.fromRGB(40, 30, 60)) -- глаза
	add(nil, Vector3.new(0.12, 0.2, 0.04), Vector3.new(0.15, 1.84, -0.09), Color3.fromRGB(40, 30, 60))
	add(nil, Vector3.new(0.05, 0.06, 0.045), Vector3.new(-0.13, 1.9, -0.1), Color3.new(1, 1, 1), Enum.Material.Neon)
	add(nil, Vector3.new(0.05, 0.06, 0.045), Vector3.new(0.17, 1.9, -0.1), Color3.new(1, 1, 1), Enum.Material.Neon)
	-- руль
	add(
		Enum.PartType.Cylinder,
		Vector3.new(0.06, 0.5, 0.5),
		Vector3.new(0, 1.18, -0.25),
		Color3.fromRGB(40, 40, 52),
		nil,
		CFrame.Angles(0, math.pi / 2, 0) * CFrame.Angles(0, 0, -0.5)
	)

	-- эффекты
	local flame = add(Enum.PartType.Ball, Vector3.new(0.4, 0.4, 1.2), Vector3.new(0, 0.62, 1.9), Color3.fromRGB(255, 160, 60), Enum.Material.Neon)
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
		bb.StudsOffsetWorldSpace = Vector3.new(0, 3.2 * SC, 0)
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
