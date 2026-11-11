--!strict
-- Экран загрузки и диагностика: показывает, на каком шаге запуск, и выводит на экран ошибки
-- клиента и сервера (иначе при сбое виден только пустой мир). Ни от чего не зависит.
local Players = game:GetService("Players")
local LogService = game:GetService("LogService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local gui = Instance.new("ScreenGui")
gui.Name = "SakuraBoot"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.DisplayOrder = 100
gui.Parent = player:WaitForChild("PlayerGui")

local status = Instance.new("TextLabel")
status.Size = UDim2.new(1, -40, 0, 60)
status.Position = UDim2.new(0, 20, 0.5, -30)
status.BackgroundTransparency = 1
status.TextColor3 = Color3.new(1, 1, 1)
status.TextStrokeTransparency = 0
status.Font = Enum.Font.GothamBold
status.TextSize = 28
status.Text = "SAKURA DRIFT — загрузка…"
status.Parent = gui

local errBox = Instance.new("TextLabel")
errBox.Size = UDim2.new(1, -40, 0.45, 0)
errBox.Position = UDim2.new(0, 20, 0.55, 0)
errBox.BackgroundColor3 = Color3.fromRGB(40, 10, 20)
errBox.BackgroundTransparency = 0.2
errBox.TextColor3 = Color3.fromRGB(255, 190, 190)
errBox.Font = Enum.Font.Code
errBox.TextSize = 15
errBox.TextWrapped = true
errBox.TextXAlignment = Enum.TextXAlignment.Left
errBox.TextYAlignment = Enum.TextYAlignment.Top
errBox.Visible = false
errBox.Parent = gui

local clientLines: { string } = {}
local serverText = ""
local function refresh()
	local parts = {}
	if #clientLines > 0 then
		table.insert(parts, "КЛИЕНТ:\n" .. table.concat(clientLines, "\n"))
	end
	if serverText ~= "" then
		table.insert(parts, "СЕРВЕР:\n" .. serverText)
	end
	errBox.Text = table.concat(parts, "\n\n")
	errBox.Visible = #parts > 0
end

LogService.MessageOut:Connect(function(msg: string, kind: Enum.MessageType)
	if kind == Enum.MessageType.MessageError or kind == Enum.MessageType.MessageWarning then
		table.insert(clientLines, string.sub(msg, 1, 300))
		if #clientLines > 10 then
			table.remove(clientLines, 1)
		end
		refresh()
	end
end)

task.spawn(function()
	local log = ReplicatedStorage:WaitForChild("SakuraServerLog", 20)
	if log and log:IsA("StringValue") then
		serverText = log.Value
		refresh()
		log.Changed:Connect(function()
			serverText = log.Value
			refresh()
		end)
	end
end)

local t0 = os.clock()
while true do
	local stage = player:GetAttribute("SakuraStage")
	if stage == "ok" then
		status.Visible = false
		-- ошибки во время игры показываем маленькой плашкой внизу
		errBox.Size = UDim2.new(0.5, 0, 0.2, 0)
		errBox.Position = UDim2.new(0, 10, 0.78, 0)
		errBox.TextSize = 12
		break
	end
	status.Text = string.format("SAKURA DRIFT — загрузка: %s (%d с)", tostring(stage or "старт скриптов"), math.floor(os.clock() - t0))
	task.wait(0.25)
end
