// Менеджер подписок: подсчёт ссылок + маршрутизация пакетов.
//
//   const off = subscribe(0x0110, (data, id) => { ... });
//   off(); // отписаться
//
// Правила:
//  - На один id может подписаться сколько угодно обработчиков (несколько
//    виджетов с одним id, виджет вне вкладок + виджет во вкладке и т.д.).
//  - CANIDSub уходит на КАЖДОГО нового подписчика: повторная подписка
//    безвредна, а сервер в ответ присылает текущее состояние объекта —
//    так новый виджет сразу получает данные.
//  - CANIDUnsub уходит только когда ушёл ПОСЛЕДНИЙ подписчик id —
//    чужую подписку случайно снять нельзя.
//  - Отправка отложена до конца текущей задачи (microtask): при переключении
//    вкладки (close → open подряд) общие id не отписываются, а все запросы
//    склеиваются в пачки по CHUNK_SIZE.
//  - Пока соединения нет, ничего не отправляется. После каждого 'open'
//    (первый запуск или переподключение) серверу заново отправляются все
//    актуальные id — сервер после обрыва про подписки ничего не помнит.

import { WSEvents, WSIsConnected, WSSubscribe, WSUnsubscribe } from '../ws.js';

const CHUNK_SIZE = 32;

const handlers = new Map(); // id -> Set<{ fn }>
let serverIds = new Set();  // id, на которые сервер, по нашим данным, подписан
const needSub = new Set();  // id с новыми подписчиками — отправить CANIDSub
let flushQueued = false;

export function subscribe(id, fn)
{
	if(!Number.isInteger(id))
		throw new TypeError(`subscribe: id must be an Int, got ${id}`);
	if(typeof fn !== 'function')
		throw new TypeError('subscribe: handler must be a function');

	// Обёртка-объект: один и тот же fn можно подписать дважды, и это будут две подписки.
	const entry = { fn };
	let set = handlers.get(id);
	if(!set)
	{
		set = new Set();
		handlers.set(id, set);
	}
	set.add(entry);
	needSub.add(id);
	scheduleFlush();

	let active = true;

	return function unsubscribe()
	{
		if(!active) return; // повторный вызов безопасен
		active = false;
		const s = handlers.get(id);
		if(!s) return;
		s.delete(entry);
		if(s.size === 0) handlers.delete(id);
		scheduleFlush();
	};
}

/** Список id, на которые сейчас есть хоть один обработчик (для отладки). */
export function activeIds()
{
	return [...handlers.keys()];
}

function scheduleFlush()
{
	if(flushQueued) return;
	flushQueued = true;
	queueMicrotask(flush);
}

function flush()
{
	flushQueued = false;
	if(!WSIsConnected()) return; // отправим после 'open'

	const toSub = [];
	const toUnsub = [];
	for (const id of handlers.keys())
		if(needSub.has(id) || !serverIds.has(id)) toSub.push(id);
	for (const id of serverIds)
		if(!handlers.has(id)) toUnsub.push(id);
	needSub.clear();

	sendChunked(WSUnsubscribe, toUnsub, id => serverIds.delete(id));
	sendChunked(WSSubscribe, toSub, id => serverIds.add(id));
}

function sendChunked(send, ids, onSent)
{
	for (let i = 0; i < ids.length; i += CHUNK_SIZE)
	{
		const chunk = ids.slice(i, i + CHUNK_SIZE);
		if(!send(chunk)) return; // соединение пропало — досинхронизируемся после 'open'
		chunk.forEach(onSent);
	}
}

WSEvents.addEventListener('open', () =>
{
	serverIds = new Set(); // новое соединение — сервер чистый
	flush();
});

WSEvents.addEventListener('close', () =>
{
	serverIds = new Set();
});

WSEvents.addEventListener('packet', (e) =>
{
	const { id, data } = e.detail;
	const set = handlers.get(id);
	if(!set) return; // пакет для id без подписчиков — игнорируем

	// Копия: обработчик может отписаться прямо во время вызова.
	for (const entry of [...set]) callHandler(entry, id, data);
});

function callHandler(entry, id, data)
{
	try
	{
		entry.fn(data, id);
	}
	catch (err)
	{
		// Ошибка одного виджета не должна ломать остальные.
		console.error(`Ошибка обработки пакета 0x${id.toString(16)}:`, err);
	}
}

/** Ручная подача пакета (демо/тесты), идёт тем же путём, что и пакет из WS. */
export function injectPacket(id, data)
{
	WSEvents.dispatchEvent(new CustomEvent('packet', { detail: { id, type: null, data } }));
}
