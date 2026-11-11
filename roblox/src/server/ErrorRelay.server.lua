--!strict
-- Диагностика: ошибки и предупреждения сервера складываются в ReplicatedStorage.SakuraServerLog,
-- чтобы клиентский экран загрузки (Boot) мог показать их игроку. Ни от чего не зависит.
local LogService = game:GetService("LogService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local log = Instance.new("StringValue")
log.Name = "SakuraServerLog"
log.Parent = ReplicatedStorage

local lines: { string } = {}
LogService.MessageOut:Connect(function(msg: string, kind: Enum.MessageType)
	if kind == Enum.MessageType.MessageError or kind == Enum.MessageType.MessageWarning then
		table.insert(lines, string.sub(msg, 1, 300))
		if #lines > 10 then
			table.remove(lines, 1)
		end
		log.Value = table.concat(lines, "\n")
	end
end)
