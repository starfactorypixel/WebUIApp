// Единственное WS-соединение приложения (модуль-синглтон).
//
// Что здесь есть:
//  - автоматическое переподключение с экспоненциальной задержкой (0.5с → 10с);
//  - события соединения через WSEvents: 'open', 'close', 'packet';
//  - класс 'ws-offline' на <html>, пока связи нет (для стилей);
//  - безопасная отправка: если соединения нет, команда НЕ ставится в очередь,
//    а отбрасывается (иначе команда устройству может «выстрелить» спустя минуту
//    после нажатия кнопки). Подписки при этом не теряются — их хранит
//    client/subscriptions.js и сам повторяет после каждого переподключения.
//
// Модуль ничего не импортирует, поэтому циклических зависимостей больше нет.

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10000;

/** Шина событий соединения: 'open', 'close', 'packet' (detail = { id, type, data }). */
export const WSEvents = new EventTarget();

let url = null;
let socket = null;
let retryDelay = RECONNECT_MIN_MS;
let retryTimer = null;

/** Запуск соединения. Вызывается один раз из app-client.js. */
export function WSStart(wsUrl)
{
	if(url !== null) return; // уже запущено
	url = wsUrl;

	// Сеть вернулась / вкладка снова видна — не ждём таймер, пробуем сразу.
	window.addEventListener('online', reconnectNow);
	document.addEventListener('visibilitychange', () =>
	{
		if(document.visibilityState === 'visible') reconnectNow();
	});

	setOnline(false);
	connect();
}

export function WSIsConnected()
{
	return socket !== null && socket.readyState === WebSocket.OPEN;
}

function connect()
{
	clearTimeout(retryTimer);
	retryTimer = null;

	let ws;
	try
	{
		ws = new WebSocket(url);
	}
	catch (err)
	{
		console.error('WS: не удалось создать соединение:', err);
		scheduleReconnect();
		return;
	}
	socket = ws;
	let opened = false;

	ws.addEventListener('open', () =>
	{
		if(socket !== ws) return;
		opened = true;
		console.log('WS: соединение установлено:', url);
		retryDelay = RECONNECT_MIN_MS;
		setOnline(true);
		WSEvents.dispatchEvent(new Event('open'));
	});

	ws.addEventListener('close', (event) =>
	{
		if(socket !== ws) return; // событие от старого сокета
		socket = null;
		setOnline(false);
		if(opened)
		{
			console.log(`WS: соединение потеряно (code ${event.code})`);
			WSEvents.dispatchEvent(new Event('close'));
		}
		scheduleReconnect();
	});

	// 'error' всегда сопровождается 'close', переподключение делается там.
	ws.addEventListener('error', () => {});

	ws.addEventListener('message', onMessage);
}

function scheduleReconnect()
{
	if(retryTimer !== null) return;
	const delay = retryDelay * (0.8 + Math.random() * 0.4); // небольшой разброс
	retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
	console.log(`WS: переподключение через ${Math.round(delay)} мс`);
	retryTimer = setTimeout(connect, delay);
}

function reconnectNow()
{
	if(url === null || socket !== null) return; // сокет есть (открыт или подключается)
	retryDelay = RECONNECT_MIN_MS;
	connect();
}

function setOnline(online)
{
	const cl = document.documentElement.classList;
	cl.toggle('ws-online', online);
	cl.toggle('ws-offline', !online);
}

function onMessage(message)
{
	let msg;
	try
	{
		msg = JSON.parse(message.data);
	}
	catch (err)
	{
		console.error('WS: ошибка JSON:', err);
		return;
	}

	const d = msg?.data;
	if(d === null || typeof d !== 'object') return; // ответ другого формата (ack и т.п.)

	if(d.type == 0x05 && d.id == 1)
	{
		processPacket(d.data);
		return;
	}

	WSEvents.dispatchEvent(new CustomEvent('packet', { detail: { id: Number(d.id), type: d.type, data: d.data } }));
}

function processPacket(data)
{
	// ваш существующий алгоритм
}

/** Отправка JSON. Возвращает false, если соединения нет (сообщение отброшено). */
export function WSSend(obj)
{
	if(!WSIsConnected()) return false;
	socket.send(JSON.stringify(obj));
	return true;
}

export function WSSendRaw(type, id, bytes)
{
	if(!Number.isInteger(type))
		throw new TypeError('SendRaw: type param must be an Int');
	if(!Number.isInteger(id))
		throw new TypeError('SendRaw: id param must be an Int');
	if(!Array.isArray(bytes))
		throw new TypeError('SendRaw: bytes param must be an Array');

	const ok = WSSend({ cmd: 'Raw', type, id, bytes });
	if(!ok) console.warn(`WS: нет соединения, команда для 0x${id.toString(16)} не отправлена`);
	return ok;
}

export function WSSubscribe(ids)
{
	if(!Array.isArray(ids))
		throw new TypeError('WSSubscribe: ids must be an Array');
	return WSSend({ cmd: 'CANIDSub', data: ids });
}

export function WSUnsubscribe(ids)
{
	if(!Array.isArray(ids))
		throw new TypeError('WSUnsubscribe: ids must be an Array');
	return WSSend({ cmd: 'CANIDUnsub', data: ids });
}
