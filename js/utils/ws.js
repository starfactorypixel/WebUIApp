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
// Импортирует только лог, поэтому циклических зависимостей нет.

import { log } from './loghtml.js';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10000;

/** Шина событий: 'open', 'close', 'packet' {id, bytes}, 'packetRaw' {bytes}, 'response' {cmd, data}. */
export const WSEvents = new EventTarget();

let url = null;
let socket = null;
let retryDelay = RECONNECT_MIN_MS;
let retryTimer = null;

const WS_URL = 'ws://localhost:8080';	// адрес server.js (server.json → ws.port)

/** Запуск соединения. Вызывается один раз из app-*.js. */
export function WSStart(wsUrl = WS_URL)
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
		log.error('[WS] Не удалось создать соединение', err);
		scheduleReconnect();
		return;
	}
	socket = ws;
	let opened = false;

	ws.addEventListener('open', () =>
	{
		if(socket !== ws) return;
		opened = true;
		log.info(`[WS] Соединение установлено: ${url}`);
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
			log.warn(`[WS] Соединение потеряно (code ${event.code}), переподключение…`);
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
	log.info(`[WS] Переподключение через ${(delay / 1000).toFixed(1)} с`);
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
		log.error('[WS] Ошибка JSON во входящем сообщении', err);
		return;
	}

	const d = msg?.data;
	if(d === null || typeof d !== 'object') return; // ответ другого формата (ack и т.п.)

	switch(msg.cmd)
	{
		case 'CanMsg': // пакет объекта CAN: { id, bytes }
			WSEvents.dispatchEvent(new CustomEvent('packet', { detail: { id: d.id, bytes: d.bytes } }));
			break;

		case 'Raw': // прикладное сообщение L3 без разбора: { bytes }
			WSEvents.dispatchEvent(new CustomEvent('packetRaw', { detail: { bytes: d.bytes } }));
			break;

		default: // ответы сервера (ScriptLoadResp и т.п.): detail = { cmd, data }
			WSEvents.dispatchEvent(new CustomEvent('response', { detail: { cmd: msg.cmd, data: d } }));
	}
}

/** Отправка JSON. Возвращает false, если соединения нет (сообщение отброшено). */
export function WSSend(obj)
{
	if(!WSIsConnected()) return false;
	socket.send(JSON.stringify(obj));
	return true;
}

export function WSSendCanMsg(id, bytes)
{
	if(!Number.isInteger(id))
		throw new TypeError('WSSendCanMsg: id param must be an Int');
	if(!Array.isArray(bytes))
		throw new TypeError('WSSendCanMsg: bytes param must be an Array');
	
	return WSSend({ cmd: 'CanMsg', data: { id: id, bytes: bytes } });
}

/**
 * Несколько команд объектам CAN одним WS-сообщением: [{ id, bytes }, ...].
 * Сервер упакует их в минимум пакетов L3 (как подписку). Для групповых запросов.
 */
export function WSSendCanMsgBatch(msgs)
{
	if(!Array.isArray(msgs))
		throw new TypeError('WSSendCanMsgBatch: msgs param must be an Array');
	if(msgs.length === 0) return true;

	return WSSend({ cmd: 'CanMsg', data: msgs });
}

export function WSSendRaw(bytes)
{
	if(!Array.isArray(bytes))
		throw new TypeError('WSSendRaw: bytes param must be an Array');

	const ok = WSSend({ cmd: 'Raw', data: { bytes: bytes } });
	if(!ok) log.warn('[WS] Нет соединения, Raw-данные не отправлены');
	return ok;
}

/**
 * Подписка и отписка одним WS-сообщением: { cmd: 'CanSub', data: { sub: [id…], unsub: [id…] } }.
 * Сервер кладёт обе в одни и те же сообщения L3 CanSub — одним пакетом, сначала отписка.
 */
export function WSCanSub(sub, unsub)
{
	if(!Array.isArray(sub) || !Array.isArray(unsub))
		throw new TypeError('WSCanSub: sub and unsub must be Arrays');
	return WSSend({ cmd: 'CanSub', data: { sub, unsub } });
}
