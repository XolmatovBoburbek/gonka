--!strict
-- Мир трассы на клиенте: дорога, бордюры, обочины, стены, бустеры, трамплины, старт с табло и светофором,
-- насыпь из Terrain, опоры мостов, декор по теме, освещение. Плюс кристаллы, монеты и ловушки.
-- Всё только визуальное (физика — в Shared/Kart), поэтому детали якорные и без коллизий.
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared.Config)
local Tracks = require(Shared.Tracks)
local Layout = require(Shared.Layout)

local SC = Config.SCALE
local World = {}

local function hex(h: string): Color3
	return Color3.fromHex(h)
end

-- тема окружения по трассе
local ENV = {
	sakura = {
		clock = 13.2,
		ground = Enum.Material.Grass,
		groundColor = Color3.fromRGB(126, 196, 120),
		shoulder = Color3.fromRGB(150, 205, 128),
		ambient = Color3.fromRGB(150, 130, 150),
		outdoor = Color3.fromRGB(170, 160, 185),
		haze = Color3.fromRGB(255, 220, 238),
		density = 0.28,
		bright = 2.6,
		decor = "sakura",
	},
	neon = {
		clock = 0.2,
		ground = Enum.Material.Asphalt,
		groundColor = Color3.fromRGB(28, 26, 48),
		shoulder = Color3.fromRGB(40, 36, 70),
		ambient = Color3.fromRGB(90, 70, 140),
		outdoor = Color3.fromRGB(110, 90, 170),
		haze = Color3.fromRGB(60, 30, 110),
		density = 0.35,
		bright = 1.2,
		decor = "neon",
	},
	sunset = {
		clock = 17.6,
		ground = Enum.Material.Sand,
		groundColor = Color3.fromRGB(236, 196, 140),
		shoulder = Color3.fromRGB(226, 186, 130),
		ambient = Color3.fromRGB(170, 120, 110),
		outdoor = Color3.fromRGB(200, 140, 120),
		haze = Color3.fromRGB(255, 170, 120),
		density = 0.32,
		bright = 2.2,
		decor = "sunset",
	},
	momiji = {
		clock = 15.4,
		ground = Enum.Material.LeafyGrass,
		groundColor = Color3.fromRGB(150, 140, 80),
		shoulder = Color3.fromRGB(170, 140, 80),
		ambient = Color3.fromRGB(150, 120, 100),
		outdoor = Color3.fromRGB(180, 150, 120),
		haze = Color3.fromRGB(255, 205, 160),
		density = 0.3,
		bright = 2.4,
		decor = "momiji",
	},
}

-- ---------------------------------------------------------------- детали

local root: Folder? = nil

local function part(props: { [string]: any }, parent: Instance): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in props do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

local function m2s(v: Vector3): Vector3
	return v * SC
end

--- Полоса между поперечными смещениями l0..l1 от сэмпла i до сэмпла j, толщиной th (м), верх на высоте top (м над дорогой).
local function strip(track, i: number, j: number, l0: number, l1: number, top: number, th: number, color: Color3, parent: Instance, mat: Enum.Material?)
	local N = track.count
	local ia, ib = (i % N) + 1, (j % N) + 1
	local lm = (l0 + l1) / 2
	local ra, rb = track.right[ia], track.right[ib]
	local ua, ub = track.up[ia], track.up[ib]
	local a = track.pos[ia] + ra * lm + ua * (top - th / 2)
	local b = track.pos[ib] + rb * lm + ub * (top - th / 2)
	local d = b - a
	local len = d.Magnitude
	if len < 1e-3 then
		return nil
	end
	local fwd = d / len
	local up = (ua + ub).Unit
	local right = fwd:Cross(up).Unit
	up = right:Cross(fwd).Unit
	local back = right:Cross(up)
	local mid = (a + b) / 2
	local p = part({
		Size = Vector3.new(math.abs(l1 - l0) * SC, th * SC, (len + 0.35) * SC),
		CFrame = CFrame.fromMatrix(m2s(mid), right, up, back),
		Color = color,
		Material = mat or Enum.Material.SmoothPlastic,
	}, parent)
	return p
end

-- ---------------------------------------------------------------- освещение

local function applyLighting(trackId: string)
	local env = ENV[trackId] or ENV.sakura
	Lighting.ClockTime = env.clock
	Lighting.Brightness = env.bright
	Lighting.Ambient = env.ambient
	Lighting.OutdoorAmbient = env.outdoor
	Lighting.GlobalShadows = true
	Lighting.EnvironmentDiffuseScale = 0.5
	Lighting.EnvironmentSpecularScale = 0.4
	for _, c in Lighting:GetChildren() do
		if c:GetAttribute("SakuraFx") then
			c:Destroy()
		end
	end
	local atm = Instance.new("Atmosphere")
	atm.Density = env.density
	atm.Haze = 1.2
	atm.Color = env.haze
	atm.Decay = env.haze:Lerp(Color3.new(1, 1, 1), 0.3)
	atm.Glare = if trackId == "sunset" then 0.6 else 0.1
	atm:SetAttribute("SakuraFx", true)
	atm.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Intensity = if trackId == "neon" then 1.1 else 0.55
	bloom.Size = 28
	bloom.Threshold = if trackId == "neon" then 0.85 else 1.6
	bloom:SetAttribute("SakuraFx", true)
	bloom.Parent = Lighting
	local cc = Instance.new("ColorCorrectionEffect")
	cc.Saturation = 0.18
	cc.Contrast = 0.06
	cc:SetAttribute("SakuraFx", true)
	cc.Parent = Lighting
	local sky = Instance.new("Sky")
	sky.CelestialBodiesShown = true
	sky.StarCount = if trackId == "neon" then 3000 else 500
	sky:SetAttribute("SakuraFx", true)
	sky.Parent = Lighting
end

-- ---------------------------------------------------------------- декор

local function tree(parent: Instance, pos: Vector3, scale: number, trunk: Color3, leaves: { Color3 }, rnd: Random)
	local h = (4 + rnd:NextNumber() * 3) * scale
	part(
		{
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(h * SC, 0.7 * scale * SC, 0.7 * scale * SC),
			CFrame = CFrame.new(m2s(pos + Vector3.new(0, h / 2, 0))) * CFrame.Angles(0, 0, math.pi / 2),
			Color = trunk,
			Material = Enum.Material.Wood,
		},
		parent
	)
	for i = 1, 3 do
		local r = (1.8 + rnd:NextNumber() * 1.2) * scale
		local off = Vector3.new((rnd:NextNumber() - 0.5) * 2.4, h + (i - 2) * 0.8 * scale, (rnd:NextNumber() - 0.5) * 2.4) * Vector3.new(scale, 1, scale)
		part(
			{
				Shape = Enum.PartType.Ball,
				Size = Vector3.one * r * 2 * SC,
				CFrame = CFrame.new(m2s(pos + off)),
				Color = leaves[rnd:NextInteger(1, #leaves)],
				Material = Enum.Material.SmoothPlastic,
				CastShadow = true,
			},
			parent
		)
	end
end

local function palm(parent: Instance, pos: Vector3, rnd: Random)
	local h = 7 + rnd:NextNumber() * 4
	local lean = (rnd:NextNumber() - 0.5) * 0.3
	local top = pos + Vector3.new(lean * h, h, 0)
	part(
		{
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(h * SC, 0.6 * SC, 0.6 * SC),
			CFrame = CFrame.lookAt(m2s((pos + top) / 2), m2s(top)) * CFrame.Angles(0, math.pi / 2, 0),
			Color = Color3.fromRGB(150, 110, 70),
			Material = Enum.Material.Wood,
		},
		parent
	)
	for i = 1, 6 do
		local a = i / 6 * math.pi * 2
		local dir = Vector3.new(math.cos(a), -0.35, math.sin(a))
		local c = top + dir * 2
		part(
			{
				Size = Vector3.new(1.2 * SC, 0.15 * SC, 4.2 * SC),
				CFrame = CFrame.lookAt(m2s(c), m2s(c + dir)),
				Color = Color3.fromRGB(70, 170, 80),
				CastShadow = true,
			},
			parent
		)
	end
end

local NEON_COLS = { Color3.fromRGB(57, 243, 255), Color3.fromRGB(255, 80, 210), Color3.fromRGB(160, 90, 255), Color3.fromRGB(255, 200, 60) }

local function building(parent: Instance, pos: Vector3, rnd: Random)
	local w = 8 + rnd:NextNumber() * 10
	local d = 8 + rnd:NextNumber() * 10
	local h = 14 + rnd:NextNumber() * 40
	local cf = CFrame.new(m2s(pos + Vector3.new(0, h / 2, 0))) * CFrame.Angles(0, rnd:NextNumber() * math.pi, 0)
	part(
		{
			Size = Vector3.new(w, h, d) * SC,
			CFrame = cf,
			Color = Color3.fromRGB(28 + rnd:NextInteger(0, 20), 26, 50 + rnd:NextInteger(0, 30)),
			Material = Enum.Material.Glass,
			Reflectance = 0.1,
			CastShadow = true,
		},
		parent
	)
	local col = NEON_COLS[rnd:NextInteger(1, #NEON_COLS)]
	local bands = rnd:NextInteger(1, 3)
	for i = 1, bands do
		local y = -h / 2 + h * (i / (bands + 1))
		part({ Size = Vector3.new(w + 0.2, 0.4, d + 0.2) * SC, CFrame = cf * CFrame.new(0, y * SC, 0), Color = col, Material = Enum.Material.Neon }, parent)
	end
end

local function rock(parent: Instance, pos: Vector3, rnd: Random, color: Color3)
	local s = 1.5 + rnd:NextNumber() * 3
	part(
		{
			Size = Vector3.new(s * 1.4, s, s * 1.2) * SC,
			CFrame = CFrame.new(m2s(pos + Vector3.new(0, s * 0.35, 0))) * CFrame.Angles(rnd:NextNumber(), rnd:NextNumber() * 6, rnd:NextNumber() * 0.5),
			Color = color,
			Material = Enum.Material.Slate,
			CastShadow = true,
		},
		parent
	)
end

local function decorate(track, trackId: string, parent: Instance, groundY: number)
	local env = ENV[trackId] or ENV.sakura
	local rnd = Random.new(#trackId * 977 + math.floor(track.length))
	local mn, mx = track.boundsMin, track.boundsMax
	local placed = 0
	local tries = 0
	while placed < 170 and tries < 3000 do
		tries += 1
		local x = mn.X - 90 + rnd:NextNumber() * (mx.X - mn.X + 180)
		local z = mn.Z - 90 + rnd:NextNumber() * (mx.Z - mn.Z + 180)
		local dist, idx = track:distanceTo(x, z, 120)
		if idx >= 0 then
			local i = idx + 1
			local lim = track.hw[i] + track.wall[i]
			if dist > lim + 4 then
				local y
				if dist < lim + 15 then
					y = track.pos[i].Y - 0.3 -- на насыпи у дороги
				elseif dist > lim + 26 then
					y = groundY
				end
				if y and not (track.flags[i] == 1 and dist < lim + 26) then
					local p = Vector3.new(x, y, z)
					local kind = env.decor
					if kind == "sakura" then
						if rnd:NextNumber() < 0.85 then
							tree(
								parent,
								p,
								1 + rnd:NextNumber() * 0.4,
								Color3.fromRGB(110, 70, 60),
								{ Color3.fromRGB(255, 170, 205), Color3.fromRGB(255, 196, 222), Color3.fromRGB(255, 140, 186) },
								rnd
							)
						else
							rock(parent, p, rnd, Color3.fromRGB(170, 170, 180))
						end
					elseif kind == "neon" then
						if dist > lim + 18 then
							building(parent, p, rnd)
						end
					elseif kind == "sunset" then
						if rnd:NextNumber() < 0.7 then
							palm(parent, p, rnd)
						else
							rock(parent, p, rnd, Color3.fromRGB(200, 150, 110))
						end
					else
						tree(
							parent,
							p,
							1 + rnd:NextNumber() * 0.5,
							Color3.fromRGB(100, 70, 50),
							{ Color3.fromRGB(230, 80, 40), Color3.fromRGB(255, 140, 40), Color3.fromRGB(200, 50, 40), Color3.fromRGB(250, 190, 60) },
							rnd
						)
					end
					placed += 1
				end
			end
		end
	end
end

-- ---------------------------------------------------------------- постройка

export type Built = {
	trackId: string,
	track: any,
	folder: Folder,
	lights: { Part },
	boxes: { any },
	coins: { any },
	traps: { [number]: any },
	time: number,
}

local current: Built? = nil

function World.current(): Built?
	return current
end

function World.build(trackId: string): Built
	if current and current.trackId == trackId then
		return current
	end
	if root then
		root:Destroy()
	end
	workspace.Terrain:Clear()
	local track = Tracks.get(trackId)
	local data = track.data
	local theme = data.theme
	local env = ENV[trackId] or ENV.sakura
	applyLighting(trackId)

	local folder = Instance.new("Folder")
	folder.Name = "SakuraWorld"
	root = folder
	local roadF = Instance.new("Folder")
	roadF.Name = "Road"
	roadF.Parent = folder
	local decoF = Instance.new("Folder")
	decoF.Name = "Decor"
	decoF.Parent = folder

	local N = track.count
	local mn, mx = track.boundsMin, track.boundsMax
	local groundY = mn.Y - 0.6

	-- земля (Terrain) и насыпь под дорогой
	local T = workspace.Terrain
	T:SetMaterialColor(env.ground, env.groundColor)
	local cx, cz = (mn.X + mx.X) / 2, (mn.Z + mx.Z) / 2
	local sx, sz = (mx.X - mn.X) + 500, (mx.Z - mn.Z) + 500
	-- заливаем кусками: у операций с Terrain есть предел объёма за один вызов
	local TILE = 300 -- м
	local nx, nz = math.ceil(sx / TILE), math.ceil(sz / TILE)
	for ix = 0, nx - 1 do
		for iz = 0, nz - 1 do
			local x0 = cx - sx / 2 + (ix + 0.5) * TILE
			local z0 = cz - sz / 2 + (iz + 0.5) * TILE
			T:FillBlock(CFrame.new(x0 * SC, (groundY - 4) * SC, z0 * SC), Vector3.new(TILE * SC, 8 * SC, TILE * SC), env.ground)
		end
	end
	if trackId == "sunset" then
		-- море за пляжем
		T:FillBlock(CFrame.new(cx * SC, (groundY - 0.6) * SC, (mn.Z - 220) * SC), Vector3.new(sx * SC, 1.2 * SC, 300 * SC), Enum.Material.Water)
	end
	local STEP = 2
	for i = 0, N - 1, STEP do
		local ia = i + 1
		local ib = ((i + STEP) % N) + 1
		local a, b = track.pos[ia], track.pos[ib]
		local hgt = math.min(a.Y, b.Y) - groundY
		local lim = track.hw[ia] + track.wall[ia]
		if track.flags[ia] ~= 1 and hgt > 0.4 then
			local mid = (a + b) / 2
			local tan = (b - a)
			tan = Vector3.new(tan.X, 0, tan.Z)
			if tan.Magnitude > 1e-3 then
				local w = 2 * (lim + 16)
				local top = math.min(a.Y, b.Y) - 0.35
				local h = top - groundY + 1
				local cf = CFrame.lookAt(Vector3.new(mid.X, top - h / 2, mid.Z) * SC, (Vector3.new(mid.X, top - h / 2, mid.Z) + tan) * SC)
				T:FillBlock(cf, Vector3.new(w * SC, h * SC, (tan.Magnitude + 3) * SC), env.ground)
			end
		elseif track.flags[ia] == 1 and i % 10 == 0 and hgt > 1.5 then
			-- опоры моста
			for _, side in { -1, 1 } do
				local p = a + track.right[ia] * (side * (track.hw[ia] * 0.7))
				local h = p.Y - groundY
				part(
					{
						Size = Vector3.new(1.4 * SC, h * SC, 1.4 * SC),
						CFrame = CFrame.new(Vector3.new(p.X, groundY + h / 2 - 0.4, p.Z) * SC),
						Color = Color3.fromRGB(190, 190, 205),
						Material = Enum.Material.Concrete,
						CastShadow = true,
					},
					roadF
				)
			end
		end
	end

	-- дорога: асфальт, белые кромки, бордюры, обочины, стены
	local roadC = hex(theme.road)
	local edgeC = hex(theme.edge)
	local centerC = hex(theme.center)
	local curbA, curbB = hex(theme.curbA), hex(theme.curbB)
	local wallA, wallB = hex(theme.wallA), hex(theme.wallB)
	local wallMat = if theme.wallStyle == "neon" then Enum.Material.Neon else Enum.Material.SmoothPlastic
	local shoulderC = env.shoulder
	local CURB = 1.5
	local seg = 0
	for i = 0, N - 1, STEP do
		seg += 1
		local j = i + STEP
		local ia = i + 1
		local hw = track.hw[ia]
		local wall = track.wall[ia]
		strip(track, i, j, -hw + 0.35, hw - 0.35, 0.02, 0.5, roadC, roadF, Enum.Material.Asphalt)
		strip(track, i, j, -hw, -hw + 0.35, 0.03, 0.5, edgeC, roadF)
		strip(track, i, j, hw - 0.35, hw, 0.03, 0.5, edgeC, roadF)
		if seg % 3 == 0 then
			strip(track, i, j, -0.18, 0.18, 0.04, 0.2, centerC, roadF)
		end
		local cc = if seg % 2 == 0 then curbA else curbB
		strip(track, i, j, -hw - CURB, -hw, 0.06, 0.5, cc, roadF)
		strip(track, i, j, hw, hw + CURB, 0.06, 0.5, cc, roadF)
		if wall > CURB + 0.05 then
			strip(track, i, j, -hw - wall, -hw - CURB, 0.0, 0.5, shoulderC, roadF, Enum.Material.Grass)
			strip(track, i, j, hw + CURB, hw + wall, 0.0, 0.5, shoulderC, roadF, Enum.Material.Grass)
		end
		local wc = if (seg // 2) % 2 == 0 then wallA else wallB
		local wh = if theme.wallStyle == "neon" then 0.9 else 1.1
		strip(track, i, j, -hw - wall - 0.6, -hw - wall, wh, wh + 0.5, wc, roadF, wallMat)
		strip(track, i, j, hw + wall, hw + wall + 0.6, wh, wh + 0.5, wc, roadF, wallMat)
		if track.flags[ia] == 1 then
			-- низ моста
			strip(track, i, j, -hw - wall - 0.6, hw + wall + 0.6, -0.5, 0.8, Color3.fromRGB(170, 170, 185), roadF, Enum.Material.Concrete)
		end
	end

	-- бустеры
	local boostC = hex(theme.boost)
	for _, z in track.boostZones do
		local len = z.s1 - z.s0
		local fr = track:frameAtProgress(z.s0 + len / 2)
		local c = fr.pos + fr.right * z.lat + fr.up * 0.07
		local back = fr.right:Cross(fr.up)
		local cf = CFrame.fromMatrix(c * SC, fr.right, fr.up, back)
		part(
			{ Size = Vector3.new(z.halfW * 2 * SC, 0.12 * SC, len * SC), CFrame = cf, Color = boostC, Material = Enum.Material.Neon, Transparency = 0.15 },
			roadF
		)
		for k = -1, 1 do
			part(
				{
					Size = Vector3.new(z.halfW * 1.2 * SC, 0.14 * SC, 0.5 * SC),
					CFrame = cf * CFrame.new(0, 0.02 * SC, k * len / 3.5 * SC) * CFrame.Angles(0, 0, 0),
					Color = Color3.new(1, 1, 1),
					Material = Enum.Material.Neon,
				},
				roadF
			)
		end
	end

	-- трамплины: несколько наклонных плит по профилю высоты
	local gateC = hex(theme.gateA)
	for _, z in track.rampZones do
		local n = 6
		for k = 0, n - 1 do
			local u0, u1 = k / n, (k + 1) / n
			local s0, s1 = z.s0 + z.len * u0, z.s0 + z.len * u1
			local h0 = (track.rampHeightAt :: any)(z, u0)
			local h1 = (track.rampHeightAt :: any)(z, u1)
			local p0 = track:pointAt(s0, z.lat, h0)
			local p1 = track:pointAt(s1, z.lat, h1)
			local fr = track:frameAtProgress((s0 + s1) / 2)
			local d = p1 - p0
			local fwd = d.Unit
			local up = fr.right:Cross(fwd).Unit
			if up.Y < 0 then
				up = -up
			end
			local right = fwd:Cross(up).Unit
			local back = right:Cross(up)
			local th = 0.3
			local mid = (p0 + p1) / 2 - up * (th / 2)
			part(
				{
					Size = Vector3.new(z.halfW * 2 * SC, th * SC, (d.Magnitude + 0.1) * SC),
					CFrame = CFrame.fromMatrix(mid * SC, right, up, back),
					Color = if k % 2 == 0 then gateC else Color3.fromRGB(255, 230, 90),
					Material = Enum.Material.SmoothPlastic,
				},
				roadF
			)
			-- боковины до дороги
			local hm = (h0 + h1) / 2
			if hm > 0.15 then
				for _, side in { -1, 1 } do
					local base = track:pointAt((s0 + s1) / 2, z.lat + side * z.halfW, hm / 2)
					part(
						{
							Size = Vector3.new(0.25 * SC, hm * SC, (d.Magnitude + 0.1) * SC),
							CFrame = CFrame.fromMatrix(base * SC, fr.right, fr.up, fr.right:Cross(fr.up)),
							Color = Color3.fromRGB(60, 60, 80),
						},
						roadF
					)
				end
			end
		end
	end

	-- старт/финиш: шахматка и арка с табло и светофором
	local lights: { Part } = {}
	do
		local fr = track:frameAtProgress(0)
		local hw = fr.hw
		local cells = math.floor(hw * 2 / 1)
		local back = fr.right:Cross(fr.up)
		for row = 0, 1 do
			for k = 0, cells - 1 do
				local lat = -hw + (k + 0.5) * (hw * 2 / cells)
				local c = fr.pos + fr.right * lat + fr.up * 0.06 + fr.tan * ((row - 0.5) * 1)
				part(
					{
						Size = Vector3.new(hw * 2 / cells * SC, 0.1 * SC, 1 * SC),
						CFrame = CFrame.fromMatrix(c * SC, fr.right, fr.up, back),
						Color = if (k + row) % 2 == 0 then Color3.new(1, 1, 1) else Color3.fromRGB(20, 20, 30),
					},
					roadF
				)
			end
		end
		local gf = track:frameAtProgress(4)
		local gb = gf.right:Cross(gf.up)
		local H = 7
		local span = gf.hw + 2.2
		for _, side in { -1, 1 } do
			local p = gf.pos + gf.right * (side * span) + gf.up * (H / 2)
			part(
				{
					Size = Vector3.new(1.2 * SC, H * SC, 1.2 * SC),
					CFrame = CFrame.fromMatrix(p * SC, gf.right, gf.up, gb),
					Color = gateC,
					Material = Enum.Material.SmoothPlastic,
					CastShadow = true,
				},
				roadF
			)
		end
		local barC = gf.pos + gf.up * (H + 0.6)
		local bar = part(
			{
				Size = Vector3.new((span * 2 + 1.2) * SC, 1.8 * SC, 0.8 * SC),
				CFrame = CFrame.fromMatrix(barC * SC, gf.right, gf.up, gb),
				Color = Color3.fromRGB(30, 26, 50),
				CastShadow = true,
			},
			roadF
		)
		for _, face in { Enum.NormalId.Front, Enum.NormalId.Back } do
			local sg = Instance.new("SurfaceGui")
			sg.Face = face
			sg.PixelsPerStud = 20
			sg.LightInfluence = 0
			sg.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
			local tl = Instance.new("TextLabel")
			tl.Size = UDim2.fromScale(1, 1)
			tl.BackgroundTransparency = 1
			tl.Text = theme.gateText
			tl.TextScaled = true
			tl.Font = Enum.Font.FredokaOne
			tl.TextColor3 = Color3.new(1, 1, 1)
			tl.TextStrokeColor3 = gateC
			tl.TextStrokeTransparency = 0
			tl.Parent = sg
			sg.Parent = bar
		end
		for k = 1, 4 do
			local off = (k - 2.5) * 2.2
			local p = barC + gf.up * 1.6 + gf.right * off
			table.insert(
				lights,
				part(
					{
						Shape = Enum.PartType.Ball,
						Size = Vector3.one * 1.3 * SC,
						CFrame = CFrame.new(p * SC),
						Color = Color3.fromRGB(60, 40, 40),
						Material = Enum.Material.SmoothPlastic,
					},
					roadF
				)
			)
		end
	end

	-- декор
	decorate(track, trackId, decoF, groundY)

	-- кристаллы
	local itemF = Instance.new("Folder")
	itemF.Name = "Items"
	itemF.Parent = folder
	local boxes = {}
	for i, b in Layout.boxes(track) do
		local p = part(
			{
				Size = Vector3.one * 1.35 * SC,
				CFrame = CFrame.new(b.pos * SC),
				Color = Color3.fromHSV((i * 0.17) % 1, 0.6, 1),
				Material = Enum.Material.Neon,
				Transparency = 0.35,
			},
			itemF
		)
		local bb = Instance.new("BillboardGui")
		bb.Size = UDim2.fromScale(2.4, 2.4)
		bb.LightInfluence = 0
		bb.MaxDistance = 400
		local q = Instance.new("TextLabel")
		q.Size = UDim2.fromScale(1, 1)
		q.BackgroundTransparency = 1
		q.Text = "?"
		q.TextScaled = true
		q.Font = Enum.Font.FredokaOne
		q.TextColor3 = Color3.new(1, 1, 1)
		q.TextStrokeColor3 = Color3.fromRGB(80, 20, 120)
		q.TextStrokeTransparency = 0
		q.Parent = bb
		bb.Parent = p
		table.insert(boxes, { s = b.s, lat = b.lat, pos = b.pos, part = p, gui = bb, active = true, timer = 0, scale = 1, phase = i })
	end
	-- монеты
	local coins = {}
	for i, c in Layout.coins(track) do
		local p = part(
			{
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(0.14 * SC, 1.24 * SC, 1.24 * SC),
				CFrame = CFrame.new(c.pos * SC),
				Color = Color3.fromRGB(255, 194, 26),
				Material = Enum.Material.Neon,
			},
			itemF
		)
		table.insert(coins, { s = c.s, lat = c.lat, pos = c.pos, part = p, t = 0, phase = (i - 1) % 5 * 0.5 })
	end

	folder.Parent = workspace
	local built: Built = {
		trackId = trackId,
		track = track,
		folder = folder,
		lights = lights,
		boxes = boxes,
		coins = coins,
		traps = {},
		time = 0,
	}
	current = built
	return built
end

--- Светофор: 0 — выкл, 1..3 — красные по очереди, 4 — все зелёные.
function World.setLights(stage: number)
	local w = current
	if not w then
		return
	end
	for k, l in w.lights do
		if stage >= 4 then
			l.Color = Color3.fromRGB(60, 255, 120)
			l.Material = Enum.Material.Neon
		elseif k <= stage then
			l.Color = Color3.fromRGB(255, 50, 60)
			l.Material = Enum.Material.Neon
		else
			l.Color = Color3.fromRGB(60, 40, 40)
			l.Material = Enum.Material.SmoothPlastic
		end
	end
end

function World.setBoxTaken(i: number, timer: number?)
	local w = current
	if not w then
		return
	end
	local b = w.boxes[i]
	if b then
		b.active = false
		b.timer = timer or Layout.BOX_RESPAWN
	end
end

function World.setCoinTaken(i: number, timer: number?)
	local w = current
	if not w then
		return
	end
	local c = w.coins[i]
	if c then
		c.t = timer or Layout.COIN_RESPAWN
	end
end

function World.addTrap(id: number, x: number, y: number, z: number, s: number, lat: number)
	local w = current
	if not w then
		return
	end
	local m = Instance.new("Model")
	m.Name = "IceTrap"
	local base = Vector3.new(x, y, z)
	local col = Color3.fromRGB(174, 239, 255)
	for k = 0, 4 do
		local a = k / 5 * math.pi * 2
		local off = Vector3.new(math.cos(a) * 0.5, 0, math.sin(a) * 0.5)
		local h = 0.9 + (k % 2) * 0.5
		part(
			{
				Size = Vector3.new(0.45, h, 0.45) * SC,
				CFrame = CFrame.new((base + off + Vector3.new(0, h / 2, 0)) * SC) * CFrame.Angles(math.cos(a) * 0.4, 0, math.sin(a) * 0.4),
				Color = col,
				Material = Enum.Material.Ice,
				Transparency = 0.15,
			},
			m
		)
	end
	part(
		{
			Shape = Enum.PartType.Ball,
			Size = Vector3.one * 1.1 * SC,
			CFrame = CFrame.new((base + Vector3.new(0, 0.5, 0)) * SC),
			Color = Color3.fromRGB(90, 190, 255),
			Material = Enum.Material.Neon,
			Transparency = 0.4,
		},
		m
	)
	m.Parent = w.folder
	w.traps[id] = { id = id, pos = base, s = s, lat = lat, model = m, age = 0 }
end

function World.removeTrap(id: number)
	local w = current
	if not w then
		return
	end
	local t = w.traps[id]
	if t then
		t.model:Destroy()
		w.traps[id] = nil
	end
end

function World.clearTraps()
	local w = current
	if not w then
		return
	end
	for id in w.traps do
		World.removeTrap(id)
	end
end

--- Анимация кристаллов и монет, таймеры их возвращения.
function World.update(dt: number)
	local w = current
	if not w then
		return
	end
	w.time += dt
	local t = w.time
	local parts, cfs = {}, {}
	for i, b in w.boxes do
		if not b.active then
			b.timer -= dt
			if b.timer <= 0 then
				b.active = true
				b.scale = 0.05
			end
		else
			b.scale = math.min(1, b.scale + dt * 3)
		end
		local hidden = not b.active
		b.part.Transparency = if hidden then 1 else 0.35
		b.gui.Enabled = not hidden
		local bob = math.sin(t * 2.4 + i) * 0.15
		b.part.Size = Vector3.one * 1.35 * SC * math.max(0.05, b.scale)
		b.part.Color = Color3.fromHSV((t * 0.25 + i * 0.17) % 1, 0.55, 1)
		table.insert(parts, b.part)
		table.insert(cfs, CFrame.new((b.pos + Vector3.new(0, bob, 0)) * SC) * CFrame.Angles(t * 0.9 + i, t * 1.3 + i * 0.7, 0.4))
	end
	for _, c in w.coins do
		if c.t > 0 then
			c.t -= dt
			c.part.Transparency = 1
		else
			c.part.Transparency = 0
		end
		table.insert(parts, c.part)
		table.insert(cfs, CFrame.new(c.pos * SC) * CFrame.Angles(0, t * 3.2 + c.phase, 0) * CFrame.Angles(0, math.pi / 2, 0))
	end
	workspace:BulkMoveTo(parts, cfs, Enum.BulkMoveMode.FireCFrameChanged)
	for _, tr in w.traps do
		tr.age += dt
	end
end

return World
