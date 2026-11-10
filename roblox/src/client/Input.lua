--!strict
-- Управление: клавиатура (как в веб-версии), геймпад и сенсорные кнопки (их рисует Hud).
--   ←/→ или A/D — руль, ↑/W — газ, ↓/S — тормоз/назад, Пробел/Shift — дрифт и трюк,
--   E/Q/Enter — предмет, F/X — буст из шкалы.
--   Геймпад: стик/крестовина — руль, R2 — газ, L2 — тормоз, R1/X — дрифт, L1 — предмет, Y — буст.
local UserInputService = game:GetService("UserInputService")

local Input = {}

local KEYS = {
	left = { Enum.KeyCode.Left, Enum.KeyCode.A },
	right = { Enum.KeyCode.Right, Enum.KeyCode.D },
	up = { Enum.KeyCode.Up, Enum.KeyCode.W },
	down = { Enum.KeyCode.Down, Enum.KeyCode.S },
	drift = { Enum.KeyCode.Space, Enum.KeyCode.LeftShift, Enum.KeyCode.RightShift, Enum.KeyCode.ButtonR1, Enum.KeyCode.ButtonX },
	item = { Enum.KeyCode.E, Enum.KeyCode.Q, Enum.KeyCode.Return, Enum.KeyCode.ButtonL1 },
	boost = { Enum.KeyCode.F, Enum.KeyCode.X, Enum.KeyCode.ButtonY },
}

local edges = { drift = false, item = false, boost = false }
local touch = { steer = 0, gas = false, brake = false, drift = false }
Input.touch = touch

local function anyDown(list: { Enum.KeyCode }): boolean
	for _, k in list do
		local isPad = string.sub(k.Name, 1, 6) == "Button"
		if isPad then
			if UserInputService:IsGamepadButtonDown(Enum.UserInputType.Gamepad1, k) then
				return true
			end
		elseif UserInputService:IsKeyDown(k) then
			return true
		end
	end
	return false
end

UserInputService.InputBegan:Connect(function(io: InputObject, processed: boolean)
	if processed and io.UserInputType == Enum.UserInputType.Keyboard and UserInputService:GetFocusedTextBox() then
		return
	end
	for name, list in KEYS do
		if edges[name] ~= nil and table.find(list, io.KeyCode) then
			edges[name] = true
		end
	end
end)

--- Сенсорные кнопки сообщают нажатия сюда.
function Input.press(name: string)
	if edges[name] ~= nil then
		edges[name] = true
	end
end

local pad = { steer = 0, gas = 0, brake = 0 }
UserInputService.InputChanged:Connect(function(io: InputObject)
	if io.KeyCode == Enum.KeyCode.Thumbstick1 then
		local x = io.Position.X
		pad.steer = if math.abs(x) > 0.15 then x else 0
	elseif io.KeyCode == Enum.KeyCode.ButtonR2 then
		pad.gas = io.Position.Z
	elseif io.KeyCode == Enum.KeyCode.ButtonL2 then
		pad.brake = io.Position.Z
	end
end)
UserInputService.InputEnded:Connect(function(io: InputObject)
	if io.KeyCode == Enum.KeyCode.ButtonR2 then
		pad.gas = 0
	elseif io.KeyCode == Enum.KeyCode.ButtonL2 then
		pad.brake = 0
	elseif io.KeyCode == Enum.KeyCode.Thumbstick1 then
		pad.steer = 0
	end
end)

--- Снять состояние за кадр: { steer, throttle, brake, driftHeld, driftPressed, item, boost }.
function Input.read()
	if UserInputService:GetFocusedTextBox() then
		edges.drift, edges.item, edges.boost = false, false, false
		return { steer = 0, throttle = 0, brake = 0, driftHeld = false, driftPressed = false, item = false, boost = false }
	end
	local steer = 0
	if anyDown(KEYS.left) or UserInputService:IsGamepadButtonDown(Enum.UserInputType.Gamepad1, Enum.KeyCode.DPadLeft) then
		steer -= 1
	end
	if anyDown(KEYS.right) or UserInputService:IsGamepadButtonDown(Enum.UserInputType.Gamepad1, Enum.KeyCode.DPadRight) then
		steer += 1
	end
	if steer == 0 then
		steer = if pad.steer ~= 0 then pad.steer else touch.steer
	end
	local throttle = if anyDown(KEYS.up) or touch.gas then 1 else 0
	throttle = math.max(throttle, pad.gas)
	local brake = if anyDown(KEYS.down) or touch.brake then 1 else 0
	brake = math.max(brake, pad.brake)
	local out = {
		steer = math.clamp(steer, -1, 1),
		throttle = throttle,
		brake = brake,
		driftHeld = anyDown(KEYS.drift) or touch.drift,
		driftPressed = edges.drift,
		item = edges.item,
		boost = edges.boost,
	}
	edges.drift, edges.item, edges.boost = false, false, false
	return out
end

return Input
