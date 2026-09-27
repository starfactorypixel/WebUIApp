// Модуль-синглтон: создаётся один раз при первом импорте,
// и все, кто импортирует этот файл, получают ОДИН И ТОТ ЖЕ объект socket.

import { initWidgets, onPacket } from './client/dispatch.js';

export const socket = new WebSocket('ws://localhost:8080');

socket.addEventListener('open', (event) =>
{
	console.log("WS: Соединение установлено:", event.target.url);

	//GetMode('RGB');
	//GetMode('W1');
	//GetMode('W2');
	//WSOnOpenEvent();
	initWidgets();
});

socket.addEventListener('close', () =>
{
	console.log('WS disconnected');
});

socket.addEventListener('message', (message) => 
{
	let msg;
	try
	{
		msg = JSON.parse(message.data);
	} catch (err)
	{
		console.error('Ошибка JSON:', err);
		return;
	}

	if (msg.data.type == 0x05)
	{
		console.log(msg);

		if (msg.data.id == 1)
		{
			processPacket(msg.data.data);
			return;
		}
	}

	onPacket(msg.data.id, msg.data.data)
});

function processPacket(data)
{
	// ваш существующий алгоритм
}

export function WSSendRaw(type, id, bytes)
{
	if (!Number.isInteger(type))
		throw new TypeError('SendRaw: type param must be an Int');
	if (!Number.isInteger(id))
		throw new TypeError('SendRaw: id param must be an Int');
	if (!Array.isArray(bytes))
		throw new TypeError('SendRaw: bytes param must be an Array');

	const packet =
	{
		cmd: "Raw",
		type: type,
		id: id,
		bytes: bytes
	};
	socket.send(JSON.stringify(packet));
}








export function WSSubscribe(params)
{
	if (!Array.isArray(params))
		throw new TypeError('Pixel_Subscribe: params must be an Array');

	let obj =
	{
		cmd: "CANIDSub",
		data: params
	};

	socket.send(JSON.stringify(obj));
}

export function WSUnsubscribe(params)
{
	if (!Array.isArray(params))
		throw new TypeError('Pixel_Unsubscribe: params must be an Array');

	let obj =
	{
		cmd: "CANIDUnsub",
		data: params
	};

	socket.send(JSON.stringify(obj));
}

