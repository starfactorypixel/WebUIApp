// Подписки: какие функции хотят получать пакеты какого obj.
//
//   const off = subscribe(0x0110, (data, id) => { ... });
//   off(); // отписаться
//
// subscribe()/unsubscribe() ничего не отправляют сами — они кладут id в очередь,
// а flush() отправляет всю очередь в конце текущей задачи ОДНИМ WS-сообщением.
// Открытие вкладки создаёт все её виджеты за одну задачу, поэтому вся вкладка уходит одним сообщением.
// Деление на пакеты по размеру (протокол L3 с ESP) делает сервер, здесь его нет.
//
// Правила:
//   - подписались        → id в очередь CANIDSub (сервер в ответ пришлёт текущее состояние obj);
//   - ушёл последний     → id в очередь CANIDUnsub;
//   - соединение открылось (первый раз или после обрыва) → CANIDSub на все obj из списка;
//   - нет соединения     → ничего не отправляется, всё уйдёт при открытии.

import { WSEvents, WSSubscribe, WSUnsubscribe } from '../utils/ws.js';
import { log } from '../utils/loghtml.js';

const handlers = new Map(); // obj id -> [функция, функция, ...]

const queueSub = new Set();   // ждут отправки CANIDSub
const queueUnsub = new Set(); // ждут отправки CANIDUnsub
let flushPlanned = false;

export function subscribe(id, fn)
{
	if(!handlers.has(id)) handlers.set(id, []);
	handlers.get(id).push(fn);
	queue(queueSub, id);

	return function unsubscribe()
	{
		const list = handlers.get(id);
		if(!list) return;

		const i = list.indexOf(fn);
		if(i === -1) return; // уже отписаны
		list.splice(i, 1);

		if(list.length === 0)
		{
			handlers.delete(id);
			queue(queueUnsub, id);
		}
	};
}

function queue(set, id)
{
	set.add(id);
	if(flushPlanned) return;
	flushPlanned = true;
	queueMicrotask(flush); // в конце текущей задачи
}

function flush()
{
	flushPlanned = false;

	// Отписываем только тех, на кого так никто и не подписался обратно
	// (при смене вкладки общий obj не отписывается).
	const unsub = [...queueUnsub].filter(id => !handlers.has(id));
	const sub = [...queueSub].filter(id => handlers.has(id));
	queueUnsub.clear();
	queueSub.clear();

	// Нет связи — не уйдёт; при открытии подпишемся на всё заново
	if(unsub.length > 0) WSUnsubscribe(unsub);
	if(sub.length > 0) WSSubscribe(sub);
}

// Соединение открылось — сервер ничего не помнит, подписываемся на всё заново.
WSEvents.addEventListener('open', () =>
{
	if(handlers.size > 0) WSSubscribe([...handlers.keys()]);
});

// Пришёл пакет — раздаём всем подписанным на этот obj.
WSEvents.addEventListener('packet', (e) => 
{
	const { id, bytes } = e.detail;
	const list = handlers.get(id);
	if(!list) return;

	for(const fn of [...list]) // копия: обработчик может отписаться прямо во время вызова
	{
		try
		{
			fn(bytes, id);
		}
		catch(err)
		{
			log.error(`[Пакеты] Ошибка обработки пакета obj 0x${id.toString(16)}: ${err.message}`, err);
		}
	}
});
