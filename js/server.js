// npm install ws serialport
// node server.js



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

const SERIAL_REOPEN_MS = 1000;								// повтор открытия порта
const CAN_SUB_IDS_MAX = (L3Packet.DATA_MAX - 2) >> 1;		// 31: [fId][count][id u16] x count
const SCRIPT_CHUNK_MAX = L3Packet.DATA_MAX - 5;				// 59: [fId][0x04][id u16][idx] + чанк


// Порт открывается и переоткрывается сам: USB-UART отвалился или его ещё нет — повтор раз в SERIAL_REOPEN_MS.
// Протокол восстанавливается сам: L3Packet по закрытию порта сбрасывает сеанс и ждёт beacon
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


/*
SerialPort.list().then(ports =>
{
	ports.forEach(function(port)
	{
		console.log(port.path);
	})
});
*/


let script_container =
{
	mode: 'idle',	// Текущий режим работы со скриптами
	id: 0,			// ID скрипта
	length: 0,		// Длина скрипта, байт
	data: [],		// Тело скрипта
	chunk_size: 0,	// Размер чанка при передачи, байт
	chunk_nums: 0,	// Колво чанков для передачи
};



obj_wss.on('connection', (ws, req) =>
{
	ws.on('message', (message) =>
	{
		if(config.ws.debug.rx) log_ws('rx: ' + message.toString());

		let msg;
		try {
			msg = JSON.parse(message);
		} catch (err) {
			log_ws('Ошибка JSON:', err.message);
			return;
		}

		switch(msg.cmd)
		{
			// Запрос от UI на подписку CAN ID
			case 'CANIDSub':
			{
				SendSubscribe(msg.data);

				break;
			}

			// Запрос от UI на отписку CAN ID
			case 'CANIDUnsub':
			{
				SendUnsubscribe(msg.data);

				break;
			}

			// Запрос от UI на чтение скрипта
			case 'ScriptLoad':
			{
				script_container.mode = 'download';
				script_container.id = msg.data.id;
				SendScript([0x06, ...writeULE(msg.data.id, 2)]);

				break;
			}

			// Запрос от UI на сохранение скрипта
			case 'ScriptSave':
			{
				script_container.mode = 'upload';
				script_container.id = msg.data.id;
				script_container.data = msg.data.data;
				SendScript([0x03, ...writeULE(msg.data.id, 2), ...writeULE(msg.data.data.length, 2)]);

				break;
			}

			// Запрос от UI на удаление скрипта
			case 'ScriptDelete':
			{
				script_container.mode = 'delete';
				script_container.id = msg.data.id;
				SendScript([0x02, ...writeULE(msg.data.id, 2)]);

				break;
			}

			// Запрос от UI на перезагрузку всех скриптов
			case 'ScriptReload':
			{
				script_container.mode = 'reload';
				SendScript([0x08]);

				break;
			}
			
			// Команда прямого запроса в CAN
			// {cmd: 'CanMsg', data: {id: 1234, bytes: []}}
			case 'CanMsg':
			{
				const data = msg.data;
				const buf = Buffer.alloc(4 + data.bytes.length);
				buf.writeUInt8(obj_l3.fid.CanMsg, 0);
				buf.writeUInt16LE(data.id, 1);
				buf.writeUInt8(data.bytes.length, 3);
				data.bytes.forEach((b, i) => buf.writeUInt8(b, (4 + i)));
				obj_l3.send(buf);

				break;
			}
			
			// Сырые данные
			// {cmd: 'Raw', data: {bytes: []}}
			case 'Raw':
			{
				const bytes = msg.bytes;
				const buf = Buffer.alloc(bytes.length);
				bytes.forEach((b, i) => buf.writeUInt8(b, i));
				obj_l3.send(buf);
				
				break;
			}
			default:
			{
			}
		}


	});
});



// В одном пакете L3 может быть несколько прикладных пакетов.
// Все прикладные пакеты начинаются с fId далее данные.
// Драйвер пытается разобрать пакет на прикладные пакеты, используя таблицу l3_fids.json
// Для каждого разобранного прикладного пакета вызывается событие. Если встречается неизвестный fId, то он и все данные до конца пакета попадают в последние событие.
obj_l3.on('message', (fId, data) => 
{
	if(fId === obj_l3.fid.Script)
	{
		TrigUartScriptProc(data.subarray(1));
		return;
	}
	
	if(fId === obj_l3.fid.CanMsg)
	{
		const id = data.readUInt16LE(1);
		const length = data.readUInt8(3);
		const bytes = Array.from(data.subarray(4, 4 + length));
		
		const msg = { cmd: 'CanMsg', data: { id: id, bytes: bytes } };
		SendWSToAll(msg);
		return;
	}
	
	const msg = { cmd: 'Raw', data: { bytes: Array.from(data) } };
	SendWSToAll(msg);
});


function SendWSToAll(msg)
{
	const text = JSON.stringify(msg);
	if(config.ws.debug.tx) log_ws('tx: ' + text);

	obj_wss.clients.forEach(client =>
	{
		if(client.readyState === WebSocket.OPEN)
			client.send(text);
	});
}


function SendScript(bytes)
{
	obj_l3.add([obj_l3.fid.Script, ...bytes]);
	obj_l3.commit();
}


// Подписка/отписка: сообщения [fId][count][id u16] x count, не больше CAN_SUB_IDS_MAX ID в каждом, бит 0x8000 — отписка
function SendCanSub(ids, unsub)
{
	for(let i = 0; i < ids.length; i += CAN_SUB_IDS_MAX)
	{
		const part = ids.slice(i, i + CAN_SUB_IDS_MAX);
		const msg = Buffer.alloc(2 + part.length * 2);
		msg[0] = obj_l3.fid.CanSub;
		msg[1] = part.length;
		part.forEach((value, index) => msg.writeUInt16LE(unsub ? (value | 0x8000) : (value & ~0x8000), 2 + index * 2));

		obj_l3.add(msg);
	}
	obj_l3.commit();
}

function SendSubscribe(ids)
{
	SendCanSub(ids, false);
}

function SendUnsubscribe(ids)
{
	SendCanSub(ids, true);
}



// data — сообщение скрипта без fId: data[0] — cmd
function TrigUartScriptProc(data)
{
	let rx_cmd = data[0];
	switch(script_container.mode)
	{
		case 'download':
		{
			if(rx_cmd == 0x86)
			{
				let rx_id = readULE(data, 1, 2);
				let rx_len = readULE(data, 3, 2);
				let rx_chunk_size = data[5];
				let rx_chunk_nums = data[6];

				if(script_container.id === rx_id)
				{
					script_container.length = rx_len;
					script_container.data = [];
					script_container.chunk_size = rx_chunk_size;
					script_container.chunk_nums = rx_chunk_nums;

					// Запрашиваем первый чанк данных
					SendScript([0x07, ...writeULE(rx_id, 2), 0]);
				}
			}

			if(rx_cmd == 0x87)
			{
				let rx_id = readULE(data, 1, 2);
				let rx_chunk_idx = data[3];
				let rx_data = data.slice(4);
				let chunk_next = rx_chunk_idx + 1;

				if(script_container.id === rx_id)
				{
					script_container.data.push(...rx_data);

					if(script_container.chunk_nums > chunk_next)
					{
						// Запрашиваем следующий чанк данных
						SendScript([0x07, ...writeULE(rx_id, 2), ...writeULE(chunk_next, 1)]);
					}
					else
					{
						// отвечаем в UI полученными и собранными данными
						const msg = {cmd: 'ScriptLoadResp', data: {id: rx_id, data: script_container.data}};
						SendWSToAll(msg);
					}
				}
			}

			break;
		}
		case 'upload':
		{
			if(rx_cmd == 0x83)
			{
				let rx_id = readULE(data, 1, 2);
				let rx_len = readULE(data, 3, 2);
				let rx_chunk_size = data[5];
				let rx_chunk_nums = data[6];

				if(script_container.id === rx_id)
				{
					if(rx_chunk_size > SCRIPT_CHUNK_MAX)
					{
						console.log('Скрипт: ESP задал чанк ' + rx_chunk_size + ' байт, в пакет помещается ' + SCRIPT_CHUNK_MAX);
						break;
					}

					script_container.length = rx_len;
					script_container.chunk_size = rx_chunk_size;
					script_container.chunk_nums = rx_chunk_nums;

					const chunk = script_container.data.slice(0, rx_chunk_size);

					// Запрашиваем первый чанк данных
					SendScript([0x04, ...writeULE(rx_id, 2), 0, ...chunk]);
				}
			}

			if(rx_cmd == 0x84)
			{
				let rx_id = readULE(data, 1, 2);
				let rx_chunk_idx = data[3];
				let rx_state = toInt8(data[4]);
				let chunk_next = rx_chunk_idx + 1;

				if(script_container.id === rx_id && rx_state === 1)
				{
					const from = script_container.chunk_size * chunk_next;
					const to = from + script_container.chunk_size;
					const chunk = script_container.data.slice(from, to);

					// Запрашиваем следующий чанк данных
					SendScript([0x04, ...writeULE(rx_id, 2), chunk_next, ...chunk]);
				}

				if(rx_state === 2)
				{
					// отвечаем в UI полученными и собранными данными
					const msg = {cmd: 'ScriptSaveResp', data: {id: rx_id}};
					SendWSToAll(msg);
				}
			}

			break;
		}
		case 'delete':
		{
			if(rx_cmd == 0x82)
			{
				let rx_id = readULE(data, 1, 2);
				let rx_state = toInt8(data[3]);

				if(script_container.id === rx_id)
				{
					// отвечаем в UI полученными и собранными данными
					const msg = {cmd: 'ScriptDeleteResp', data: {id: rx_id, state: rx_state}};
					SendWSToAll(msg);
				}
			}

			break;
		}
		case 'reload':
		{
			if(rx_cmd == 0x88)
			{
				let rx_state = toInt8(data[1]);

				// отвечаем в UI полученными и собранными данными
				const msg = {cmd: 'ScriptReloadResp', data: {state: rx_state}};
				SendWSToAll(msg);
			}
		}
	}
}



function readULE(arr, offset, byteCount) {
    let value = 0;
    for (let i = 0; i < byteCount; i++) {
        value |= arr[offset + i] << (8 * i);
    }
    return value >>> 0;
}

function writeULE(value, byteCount) {
    const bytes = [];
    for (let i = 0; i < byteCount; i++) {
        bytes.push((value >> (8 * i)) & 0xFF);
    }
    return bytes;
}

function toInt8(byte)
{
	return byte > 127 ? byte - 256 : byte;
}
