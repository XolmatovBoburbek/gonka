--!strict
-- Машины: кузов (форма модели), характеристики (1..5, сумма 10), цена в монетах. Плюс палитра красок.
local Cars = {}

Cars.list = {
	{ id = "comet", name = "Комета", class = "Купе", desc = "Сбалансированное купе для любого стиля", body = "coupe", stats = { speed = 3, accel = 4, handling = 3 }, price = 0 },
	{ id = "bolt", name = "Молния RS", class = "Спорткар", desc = "Высокая максимальная скорость", body = "sport", stats = { speed = 4, accel = 3, handling = 3 }, price = 0 },
	{ id = "mochi", name = "Моти", class = "Малолитражка", desc = "Цепкая и послушная в поворотах", body = "kei", stats = { speed = 3, accel = 3, handling = 4 }, price = 0 },
	{ id = "brute", name = "Громила V8", class = "Маслкар", desc = "Максимум скорости, тяжёлый руль", body = "muscle", stats = { speed = 5, accel = 3, handling = 2 }, price = 0 },
	{ id = "dune", name = "Дюна", class = "Багги", desc = "Срывается с места быстрее всех", body = "buggy", stats = { speed = 3, accel = 5, handling = 2 }, price = 250 },
	{ id = "ronin", name = "Ронин", class = "Дрифт-кар", desc = "Скорость и точный занос", body = "drift", stats = { speed = 4, accel = 2, handling = 4 }, price = 450 },
	{ id = "titan", name = "Титан", class = "Пикап", desc = "Мгновенный разгон, уверенный руль", body = "pickup", stats = { speed = 2, accel = 5, handling = 3 }, price = 700 },
	{ id = "apex", name = "Апекс F", class = "Болид", desc = "Рельсы в поворотах", body = "formula", stats = { speed = 2, accel = 3, handling = 5 }, price = 1000 },
}

Cars.paints = {
	{ name = "Сакура", color = "#ff6fa8" },
	{ name = "Синий", color = "#2f6bff" },
	{ name = "Белый", color = "#f3f7ff" },
	{ name = "Красный", color = "#ea3530" },
	{ name = "Оранжевый", color = "#ff8a1f" },
	{ name = "Фиолетовый", color = "#7a3cff" },
	{ name = "Жёлтый", color = "#ffd23f" },
	{ name = "Зелёный", color = "#27b865" },
	{ name = "Бирюзовый", color = "#18c8c8" },
	{ name = "Чёрный", color = "#22222c" },
}

Cars.byId = {}
for _, c in Cars.list do
	Cars.byId[c.id] = c
end

function Cars.get(id: string?)
	return Cars.byId[id or ""] or Cars.list[1]
end

function Cars.paint(i: number?)
	return Cars.paints[i or 1] or Cars.paints[1]
end

return Cars
