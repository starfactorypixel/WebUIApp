// npm install ws serialport minimist
// node server.js --serial-port=COM22 --serial-rate=115200 --ws-port=8080


const argv = require('minimist')(process.argv.slice(2));
console.log(argv);

const { SerialPort } = require('serialport');
const WebSocket = require('ws');

const obj_serial = new SerialPort({ path: argv['serial-port'], baudRate: argv['serial-rate']/*, highWaterMark: 150000*/});
const obj_wss = new WebSocket.Server({ port: argv['ws-port'] });


const originalLog = console.log;
console.log = (...args) => 
{
	const now = new Date();
	const timeStr = now.toLocaleTimeString('en-GB', { hour12: false }) + ':' + String(now.getMilliseconds()).padStart(3, '0');
	originalLog(`[${timeStr}]`, ...args);
};

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
		let msg;
		try {
			msg = JSON.parse(message);
		} catch (err) {
			console.error('Ошибка JSON:', err);
			return;
		}
		
		console.log(msg);
		
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
				SendUart(0x1B, 0x0000, [0x06, ...writeULE(msg.data.id, 2)]);
				
				break;
			}
			
			// Запрос от UI на сохранение скрипта
			case 'ScriptSave':
			{
				script_container.mode = 'upload';
				script_container.id = msg.data.id;
				script_container.data = msg.data.data;
				SendUart(0x1B, 0x0000, [0x03, ...writeULE(msg.data.id, 2), ...writeULE(msg.data.data.length, 2)]);
				
				break;
			}
			
			// Запрос от UI на удаление скрипта
			case 'ScriptDelete':
			{
				script_container.mode = 'delete';
				script_container.id = msg.data.id;
				SendUart(0x1B, 0x0000, [0x02, ...writeULE(msg.data.id, 2)]);
				
				break;
			}
			
			// 
			case 'Raw':
			{
				SendUart(msg.type, msg.id, msg.bytes);
				break;
			}
			default:
			{
				//SendUart(type, id, msg.data); ///не data
				//break;
			}
		}

		
	});
});




/*
let SerialBuffer = Buffer.alloc(0);
obj_serial.on('data', (chunk) => 
{
	console.log([].map.call(chunk, x => x.toString(16)));

	SerialBuffer = Buffer.concat([SerialBuffer, chunk]);

	if(SerialBuffer.length < 9) return;
	if(SerialBuffer[0] != 0x3C) return;

	let data_len = SerialBuffer[5];
	if(SerialBuffer[8+data_len] != 0x3E) return;
	
	let crc = CRC16_MCRF4XX(SerialBuffer, 1, data_len+6);
	if(SerialBuffer[6+data_len] != ((crc >> 0) & 0xFF) && SerialBuffer[7+data_len] != ((crc >> 8) & 0xFF)) return;

	let type = (SerialBuffer[2] & 0x1F);
	let id = (SerialBuffer[3] & (SerialBuffer[4] << 8));
	let data = new Uint8Array(data_len);
	data.set(SerialBuffer.subarray(6, 6+data_len));
	OnRX(type, id, data);

	SerialBuffer = SerialBuffer.subarray(0, 9+data_len);
});
*/


let SerialBuffer = Buffer.alloc(0);

obj_serial.on('data', (chunk) => 
{
	//console.log("RXRaw: ", [...chunk].map(x => x.toString(16).padStart(2, '0')).join(' '));

	SerialBuffer = Buffer.concat([SerialBuffer, chunk]);

	// проверяем, есть ли вообще начало пакета
	if (SerialBuffer.length < 9) return;
	if (SerialBuffer[0] !== 0x3C) {
		// если первый байт не 0x3C — удаляем его (ищем начало пакета)
		SerialBuffer = SerialBuffer.subarray(1);
		return;
	}

	let data_len = SerialBuffer[5];

	// ждем пока весь пакет придёт
	if (SerialBuffer.length < 9 + data_len) return;

	if (SerialBuffer[8 + data_len] !== 0x3E) {
		// неверный конец — сбрасываем первый байт и ищем новый пакет
		SerialBuffer = SerialBuffer.subarray(1);
		return;
	}

	let crc = CRC16_MCRF4XX(SerialBuffer, 1, data_len + 6);
	if (
		SerialBuffer[6 + data_len] !== (crc & 0xFF) ||
		SerialBuffer[7 + data_len] !== ((crc >> 8) & 0xFF)
	) {
		// CRC не совпал — удаляем первый байт и продолжаем искать
		SerialBuffer = SerialBuffer.subarray(1);
		return;
	}

	let type = SerialBuffer[2] & 0x1F;
	let id = (SerialBuffer[3] | (SerialBuffer[4] << 8));
	let data = new Uint8Array(data_len);
	data.set(SerialBuffer.subarray(6, 6 + data_len));

	OnRX(type, id, data);

	// удаляем обработанный пакет
	SerialBuffer = SerialBuffer.subarray(9 + data_len);
});






const packet_ping = Buffer.from('+PXLS=');


let timer_reconect;


obj_serial.on('open', () => {
	
	//let data = new Uint8Array(1);
	//data[0] = 0x02;
	//SendUart(0x10, 0x0001, data);

	timer_reconect = setInterval(() => 
	{

		let data = new Uint8Array(1);
		data[0] = 0x02;
		SendUart(0x10, 0x0001, data);

	}, 1000);
});



const CORE_SN_OLD = new Uint8Array([0xD0, 0xEF, 0x25, 0x5F, 0x2C, 0xB6, 0xD9, 0xD6]);
const CORE_SN = new Uint8Array([0xAA, 0x79, 0xA5, 0xBB, 0x49, 0xC6, 0x4E, 0xC1]);


async function OnRX(type, id, rxData)
{
	console.log("RX: ", type.toString(16).padStart(2, '0'), id.toString(16).padStart(4, '0'), [].map.call(rxData, x => x.toString(16).padStart(2, '0')).join(' '));

	// Пинг
	if(type == 0x10 && id == 0xFFFF)
	{
		SendUart(0x10, 0xFFFF, new Uint8Array([0x10, 0x10, 0x10, 0x10]));

		return;
	}

	// Авторизация, запросы от MainECU
	if(type == 0x10 && id == 0x0001)
	{
		// Main сообщил свой devID и способ авторизции.
		if(rxData[0] == 0x03)
		{
			clearInterval(timer_reconect);
			
			let method = rxData[1];
			let devID = new Uint8Array( rxData.slice(2) );


			// ответ
			const random = new Uint8Array(16);
			crypto.getRandomValues(random);

			// Строка ( sn[8] + rand[16] )
			const sn_rnd = new Uint8Array(24);
			sn_rnd.set(CORE_SN);
			sn_rnd.set(random, CORE_SN.length);

			// SHA1( sn[8] + rand[16] )
			const hashBuffer = await crypto.subtle.digest('SHA-1', sn_rnd);
			const sha1 = new Uint8Array(hashBuffer);


			let txData = new Uint8Array(38);
			txData[0] = 0x04; txData[1] = method;
			txData.set(random, 2);
			txData.set(sha1, 18);
			SendUart(0x10, 0x0001, txData);
		}

		// Main сообщил о авторизции
		if(rxData[0] == 0x05)
		{
			let code = rxData[1];
			let time = rxData[2] | (rxData[3] << 8) | (rxData[4] << 16) | (rxData[5] << 24);

			console.log("AUTH: " + code, "time: " + time);

		}

		return;
	}
	
	if(type == 0x1B)
	{
		TrigUartScriptProc(type, id, rxData);
		return;
	}

	const msg = 
	{
		type: type,
		id: id,
		data: Array.from(rxData)
	};
	SendWSToAll(msg);

}

async function SendWSToAll(msg)
{
	obj_wss.clients.forEach(client => 
	{
		if(client.readyState === WebSocket.OPEN)
			client.send(JSON.stringify(msg));
	});
}


/*export */async function SendUart(type, id, data)
{
	// Добавить проверку на type, id, data как у SendRaw
	let version = 0;
	let buf = new Uint8Array( 9+64 );
	buf[0] = 0x3C;
	buf[1] = ((version & 0x7) << 5);
	buf[2] = (type & 0x1F);
	buf[3] = (id >> 0) & 0xFF;
	buf[4] = (id >> 8) & 0xFF;
	buf[5] = data.length;
	buf.set(data, 6);

	let crc = CRC16_MCRF4XX(buf, 1, data.length+6);

	buf[6+data.length] = (crc >> 0) & 0xFF;
	buf[7+data.length] = (crc >> 8) & 0xFF;
	buf[8+data.length] = 0x3E;

	let tx = buf.subarray(0, 9+data.length);

	console.log("TX: ", [].map.call(tx, x => x.toString(16).padStart(2, '0')).join(' '));
	obj_serial.write(tx);
}


function CRC16_MCRF4XX(byteArr, start, length)
{
    // poly is 8408
    const CRC_POLY = 0x8408
    const CRC_PRESET = 0xFFFF

    let crc = CRC_PRESET
	
	//document.write(">>>");
	//document.write( input_list );
	//document.write("<<<");

	//const byteArr = input_list.slice(1, -1).split(" ").map(Number);

    for (let m = start; m < length; m++) {
        crc ^= byteArr[m]
      
        for (n = 0; n < 8; n++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ CRC_POLY
            } else {
                crc = (crc >> 1)
            }
        }
    }
	
    return crc ^ 0x0 & 0xFFFF;
	//window.AppInventor.setWebViewString( (crc ^ 0x0 & 0xFFFF) );
}





function SendSubscribe(ids)
{
	if(ids.length == 0) return;

	let data = new Uint8Array( ids.length * 2 );
	ids.forEach((value, index) => 
	{
		value &= ~0x8000;
		data[index * 2 + 0] = (value >> 0) & 0xFF;
		data[index * 2 + 1] = (value >> 8) & 0xFF;
	});
	
	SendUart(0x12, 0x0000, data);
}

function SendUnsubscribe(ids)
{
	if(ids.length == 0) return;

	let data = new Uint8Array( ids.length * 2 );
	ids.forEach((value, index) => 
	{
		value |= 0x8000;
		data[index * 2 + 0] = (value >> 0) & 0xFF;
		data[index * 2 + 1] = (value >> 8) & 0xFF;
	});
	
	SendUart(0x12, 0x0000, data);
}




async function TrigUartScriptProc(type, id, data)
{
	if(type !== 0x1B) return;
	if(id !== 0x0000) return;

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
					await SendUart(0x1B, 0x0000, [0x07, ...writeULE(rx_id, 2), 0]);
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
						await SendUart(0x1B, 0x0000, [0x07, ...writeULE(rx_id, 2), ...writeULE(chunk_next, 1)]);
					}
					else
					{
						// отвечаем в UI полученными и собранными данными
						const msg = {cmd: 'ScriptLoadResp', data: {id: rx_id, data: script_container.data}};
						await SendWSToAll(msg);
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
					script_container.length = rx_len;
					script_container.chunk_size = rx_chunk_size;
					script_container.chunk_nums = rx_chunk_nums;
					
					const chunk = script_container.data.slice(0, rx_chunk_size);
					
					// Запрашиваем первый чанк данных
					await SendUart(0x1B, 0x0000, [0x04, ...writeULE(rx_id, 2), 0, ...chunk]);
				}
			}
			
			if(rx_cmd == 0x84)
			{
				let rx_id = readULE(data, 1, 2);
				let rx_chunk_idx = data[3];
				let rx_state = data[4];
				let chunk_next = rx_chunk_idx + 1;
				
				if(script_container.id === rx_id && rx_state === 1)
				{
					const from = script_container.chunk_size * chunk_next;
					const to = from + script_container.chunk_size;
					const chunk = script_container.data.slice(from, to);
					
					// Запрашиваем следующий чанк данных
					await SendUart(0x1B, 0x0000, [0x04, ...writeULE(rx_id, 2), chunk_next, ...chunk]);
				}

				if(rx_state === 2)
				{
					// отвечаем в UI полученными и собранными данными
					const msg = {cmd: 'ScriptSaveResp', data: {id: rx_id}};
					await SendWSToAll(msg);
				}
			}
			
			break;
		}
		case 'delete':
		{
			if(rx_cmd == 0x82)
			{
				let rx_id = readULE(data, 1, 2);

				if(script_container.id === rx_id)
				{
					// отвечаем в UI полученными и собранными данными
					const msg = {cmd: 'ScriptDeleteResp', data: {id: rx_id}};
					await SendWSToAll(msg);
				}
			}
			
			break;
		}
	}
}




function u16LE(value) {
    return [
        value & 0xFF,
        (value >> 8) & 0xFF
    ];
}

function u24LE(value) {
    return [
        value & 0xFF,
        (value >> 8) & 0xFF,
        (value >> 16) & 0xFF
    ];
}

function u32LE(value) {
    return [
        value & 0xFF,
        (value >> 8) & 0xFF,
        (value >> 16) & 0xFF,
        (value >> 24) & 0xFF
    ];
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