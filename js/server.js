// Сервер: WebSocket (браузеры) ⇄ L3 ⇄ UART (ESP32).
//
//   npm install ws serialport
//   node js/server.js
//
// Подписки (раздел «Подписки» ниже):
//   - сервер помнит, на какие obj подписан каждый WS-клиент, и шлёт ему CanMsg только этих obj;
//   - подписка от клиента всегда уходит в ESP (повторная безвредна, ESP ответит текущим состоянием);
//   - отписка уходит в ESP, только если obj больше не нужен ни одному клиенту;
//   - клиент закрыл WS — его obj снимаются по тому же правилу;
//   - ESP заново принял подключение (L3 'connect') — подписка на все нужные obj заново.
//
// Упаковка в пакеты L3 — забота только сервера. Браузер шлёт сколько угодно id или сообщений
// одним WS-сообщением, сервер раскладывает их по пакетам L3 (не больше L3Packet.DATA_MAX байт).

const config = require('../data/server.json');

// Лог — первым: остальные модули пишут через него
const Log = require('./utils/logcmd.js');
Log.init(config.log);
const log_serial = Log.source('serial');
const log_ws = Log.source('ws');
console.log = Log.source('server');
console.error = console.log;

const { SerialPort } = require('serialport');
const WebSocket = require('ws');
const L3Packet = require('./utils/L3Packet.js');

const obj_serial = new SerialPort({ path: config.serial.port, baudRate: config.serial.speed, autoOpen: false });
const obj_wss = new WebSocket.Server({ port: config.ws.port });
const obj_l3 = new L3Packet(config, obj_serial);

const SERIAL_REOPEN_MS = 1000;	// повтор открытия порта

// Сообщение подписки L3: [fId][count][id u16] × count
const CANSUB_HEADER_LEN = 2;	// fId + count
const CANSUB_ID_LEN = 2;		// id u16
const CANSUB_UNSUB_BIT = 0x8000;

// Сообщение CanMsg L3: [fId][id u16][len][bytes]
const CANMSG_HEADER_LEN = 4;	// fId + id u16 + len

// Сообщение скрипта L3: [fId][0x04][id u16][idx] + чанк
const SCRIPT_CHUNK_HEADER_LEN = 5;


// ================================================================ UART

// Порт открывается и переоткрывается сам: USB-UART отвалился или его ещё нет — повтор раз в SERIAL_REOPEN_MS.
// Протокол восстанавливается сам: L3Packet по закрытию порта сбрасывает сеанс и ждёт beacon.
function SerialOpen()
{
	obj_serial.open((err) =>
	{
		if(err)
		{
			log_serial(config.serial.port + ' не открыт: ' + err.message);
			setTimeout(SerialOpen, SERIAL_REOPEN_MS);
			return;
		}

		log_serial(config.serial.port + ' @ ' + config.serial.speed + ' открыт, ждём beacon');
	});
}

obj_serial.on('close', () =>
{
	log_serial(config.serial.port + ' закрыт');
	setTimeout(SerialOpen, SERIAL_REOPEN_MS);
});
obj_serial.on('error', (err) => log_serial('ошибка: ' + err.message));

SerialOpen();


// ================================================================ WebSocket

obj_wss.on('connection', (ws) =>
{
	clientSubs.set(ws, new Set());

	ws.on('message', (message) =>
	{
		if(config.ws.debug.rx) log_ws('rx: ' + message.toString());

		let msg;
		try
		{
			msg = JSON.parse(message);
		}
		catch(err)
		{
			log_ws('Ошибка JSON: ' + err.message);
			return;
		}

		try
		{
			HandleWSCommand(ws, msg);
		}
		catch(err)
		{
			// Битый запрос от браузера не должен ронять сервер (а с ним всех клиентов)
			log_ws('Ошибка обработки ' + msg.cmd + ': ' + err.message);
		}
	});

	ws.on('close', () => ClientClosed(ws));
});

function HandleWSCommand(ws, msg)
{
	switch(msg.cmd)
	{
		// Подписка: { cmd: 'CANIDSub', data: [id, ...] } — сколько угодно id
		case 'CANIDSub':
			ClientSubscribe(ws, msg.data);
			break;

		// Отписка: { cmd: 'CANIDUnsub', data: [id, ...] }
		case 'CANIDUnsub':
			ClientUnsubscribe(ws, msg.data);
			break;

		// Команда объекту CAN:
		//   { cmd: 'CanMsg', data: { id, bytes } }            — отдельным пакетом L3
		//   { cmd: 'CanMsg', data: [{ id, bytes }, ...] }     — упаковать в минимум пакетов L3
		case 'CanMsg':
			if(Array.isArray(msg.data))
			{
				for(const m of msg.data) obj_l3.add(BuildCanMsg(m.id, m.bytes));
				obj_l3.commit();
			}
			else
			{
				obj_l3.send(BuildCanMsg(msg.data.id, msg.data.bytes));
			}
			break;

		// Сырые данные одним пакетом L3: { cmd: 'Raw', data: { bytes: [] } }
		case 'Raw':
			obj_l3.send(Buffer.from(msg.data.bytes));
			break;

		// Скрипты ESP
		case 'ScriptLoad':
			script.mode = 'download';
			script.id = msg.data.id;
			SendScript([0x06, ...writeULE(msg.data.id, 2)]);
			break;

		case 'ScriptSave':
			script.mode = 'upload';
			script.id = msg.data.id;
			script.data = msg.data.data;
			SendScript([0x03, ...writeULE(msg.data.id, 2), ...writeULE(msg.data.data.length, 2)]);
			break;

		case 'ScriptDelete':
			script.mode = 'delete';
			script.id = msg.data.id;
			SendScript([0x02, ...writeULE(msg.data.id, 2)]);
			break;

		case 'ScriptReload':
			script.mode = 'reload';
			SendScript([0x08]);
			break;

		default:
			log_ws('Неизвестная команда: ' + msg.cmd);
	}
}

// Отправить одному клиенту
function SendWS(ws, msg)
{
	if(ws.readyState !== WebSocket.OPEN) return;

	const text = JSON.stringify(msg);
	if(config.ws.debug.tx) log_ws('tx: ' + text);
	ws.send(text);
}

// Отправить всем клиентам
function SendWSToAll(msg)
{
	for(const ws of obj_wss.clients) SendWS(ws, msg);
}


// ================================================================ Подписки

const clientSubs = new Map();	// WS-клиент -> Set(obj id), на которые он подписан

// Нужен ли obj хоть одному клиенту
function IsNeeded(id)
{
	for(const ids of clientSubs.values())
		if(ids.has(id)) return true;
	return false;
}

function ClientSubscribe(ws, ids)
{
	const own = clientSubs.get(ws);
	for(const id of ids) own.add(id);

	// Всегда в ESP: если obj уже подписан, ESP просто пришлёт текущее состояние
	SendCanSub(ids, false);
}

function ClientUnsubscribe(ws, ids)
{
	const own = clientSubs.get(ws);
	for(const id of ids) own.delete(id);

	SendCanSub(ids.filter(id => !IsNeeded(id)), true);
}

function ClientClosed(ws)
{
	const ids = [...clientSubs.get(ws)];
	clientSubs.delete(ws);

	SendCanSub(ids.filter(id => !IsNeeded(id)), true);
}

// ESP заново принял подключение (перезапуск, обрыв UART): его подписки потеряны — подписываемся на всё
obj_l3.on('connect', () =>
{
	const all = new Set();
	for(const ids of clientSubs.values())
		for(const id of ids) all.add(id);

	if(all.size > 0) console.log('ESP подключён — переподписка на ' + all.size + ' obj');
	SendCanSub([...all], false);
});

// Подписка/отписка в ESP. Сообщения L3 делятся по размеру пакета: [fId][count][id u16] × count
function SendCanSub(ids, unsub)
{
	if(ids.length === 0) return;

	const per_msg = Math.floor((L3Packet.DATA_MAX - CANSUB_HEADER_LEN) / CANSUB_ID_LEN);

	for(let i = 0; i < ids.length; i += per_msg)
	{
		const part = ids.slice(i, i + per_msg);
		const msg = Buffer.alloc(CANSUB_HEADER_LEN + part.length * CANSUB_ID_LEN);
		msg[0] = obj_l3.fid.CanSub;
		msg[1] = part.length;
		part.forEach((id, index) =>
		{
			const value = unsub ? (id | CANSUB_UNSUB_BIT) : (id & ~CANSUB_UNSUB_BIT);
			msg.writeUInt16LE(value, CANSUB_HEADER_LEN + index * CANSUB_ID_LEN);
		});

		obj_l3.add(msg);
	}
	obj_l3.commit();
}

// Сообщение CanMsg L3: [fId][id u16][len][bytes]
function BuildCanMsg(id, bytes)
{
	const buf = Buffer.alloc(CANMSG_HEADER_LEN + bytes.length);
	buf.writeUInt8(obj_l3.fid.CanMsg, 0);
	buf.writeUInt16LE(id, 1);
	buf.writeUInt8(bytes.length, 3);
	Buffer.from(bytes).copy(buf, CANMSG_HEADER_LEN);
	return buf;
}


// ================================================================ Сообщения от ESP

// В одном пакете L3 может быть несколько прикладных сообщений, L3Packet делит их по l3_fids.json
// и вызывает 'message' на каждое. Неизвестный fId забирает остаток пакета целиком.
obj_l3.on('message', (fId, data) =>
{
	if(fId === obj_l3.fid.Script)
	{
		ScriptProc(data.subarray(1));
		return;
	}

	if(fId === obj_l3.fid.CanMsg)
	{
		const id = data.readUInt16LE(1);
		const length = data.readUInt8(3);
		const msg = { cmd: 'CanMsg', data: { id: id, bytes: Array.from(data.subarray(CANMSG_HEADER_LEN, CANMSG_HEADER_LEN + length)) } };

		// Только тем, кто подписан на этот obj
		for(const [ws, ids] of clientSubs)
			if(ids.has(id)) SendWS(ws, msg);
		return;
	}

	SendWSToAll({ cmd: 'Raw', data: { bytes: Array.from(data) } });
});


// ================================================================ Скрипты

let script =
{
	mode: 'idle',	// текущая операция со скриптом
	id: 0,			// ID скрипта
	length: 0,		// длина скрипта, байт
	data: [],		// тело скрипта
	chunk_size: 0,	// размер чанка при передаче, байт
	chunk_nums: 0,	// количество чанков
};

function SendScript(bytes)
{
	obj_l3.add([obj_l3.fid.Script, ...bytes]);
	obj_l3.commit();
}

// data — сообщение скрипта без fId: data[0] — cmd
function ScriptProc(data)
{
	const rx_cmd = data[0];
	switch(script.mode)
	{
		case 'download':
		{
			if(rx_cmd === 0x86)
			{
				const rx_id = readULE(data, 1, 2);
				if(script.id !== rx_id) break;

				script.length = readULE(data, 3, 2);
				script.data = [];
				script.chunk_size = data[5];
				script.chunk_nums = data[6];

				SendScript([0x07, ...writeULE(rx_id, 2), 0]);	// первый чанк
			}

			if(rx_cmd === 0x87)
			{
				const rx_id = readULE(data, 1, 2);
				if(script.id !== rx_id) break;

				const chunk_next = data[3] + 1;
				script.data.push(...data.slice(4));

				if(script.chunk_nums > chunk_next)
					SendScript([0x07, ...writeULE(rx_id, 2), chunk_next]);	// следующий чанк
				else
					SendWSToAll({ cmd: 'ScriptLoadResp', data: { id: rx_id, data: script.data } });
			}
			break;
		}

		case 'upload':
		{
			if(rx_cmd === 0x83)
			{
				const rx_id = readULE(data, 1, 2);
				if(script.id !== rx_id) break;

				const chunk_size = data[5];
				const chunk_max = L3Packet.DATA_MAX - SCRIPT_CHUNK_HEADER_LEN;
				if(chunk_size > chunk_max)
				{
					console.log('Скрипт: ESP задал чанк ' + chunk_size + ' байт, в пакет помещается ' + chunk_max);
					break;
				}

				script.length = readULE(data, 3, 2);
				script.chunk_size = chunk_size;
				script.chunk_nums = data[6];

				SendScript([0x04, ...writeULE(rx_id, 2), 0, ...script.data.slice(0, chunk_size)]);	// первый чанк
			}

			if(rx_cmd === 0x84)
			{
				const rx_id = readULE(data, 1, 2);
				const rx_state = toInt8(data[4]);
				const chunk_next = data[3] + 1;

				if(script.id === rx_id && rx_state === 1)
				{
					const from = script.chunk_size * chunk_next;
					SendScript([0x04, ...writeULE(rx_id, 2), chunk_next, ...script.data.slice(from, from + script.chunk_size)]);	// следующий чанк
				}

				if(rx_state === 2)
					SendWSToAll({ cmd: 'ScriptSaveResp', data: { id: rx_id } });
			}
			break;
		}

		case 'delete':
		{
			if(rx_cmd === 0x82)
			{
				const rx_id = readULE(data, 1, 2);
				if(script.id === rx_id)
					SendWSToAll({ cmd: 'ScriptDeleteResp', data: { id: rx_id, state: toInt8(data[3]) } });
			}
			break;
		}

		case 'reload':
		{
			if(rx_cmd === 0x88)
				SendWSToAll({ cmd: 'ScriptReloadResp', data: { state: toInt8(data[1]) } });
			break;
		}
	}
}


// ================================================================ Числа

function readULE(arr, offset, byteCount)
{
	let value = 0;
	for(let i = 0; i < byteCount; i++)
		value |= arr[offset + i] << (8 * i);
	return value >>> 0;
}

function writeULE(value, byteCount)
{
	const bytes = [];
	for(let i = 0; i < byteCount; i++)
		bytes.push((value >> (8 * i)) & 0xFF);
	return bytes;
}

function toInt8(byte)
{
	return byte > 127 ? byte - 256 : byte;
}
