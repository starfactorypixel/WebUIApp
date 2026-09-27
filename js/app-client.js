import { registerWidget, getWidgetClass } from './client/registry.js';
import { initWidgets, onPacket } from './client/dispatch.js';
import './ws.js'; // side-effect импорт: открывает WS и начинает слушать сообщения
import { ButtonWidget } from './widgets/button.js';
import { ValueWidget } from './widgets/value.js';
import { MeterWidget } from './widgets/meter.js';
import { StreamWidget } from './widgets/stream.js';
import { RadioWidget } from './widgets/radio.js';

// 1. Регистрируем все известные типы виджетов в одном месте.
//    Чтобы добавить новый тип — создать файл widgets/xxx.js и добавить сюда одну строку.
[ButtonWidget, ValueWidget, MeterWidget, StreamWidget, RadioWidget].forEach(registerWidget);

// --- запуск ---
document.addEventListener('DOMContentLoaded', () =>
{
	//initWidgets();
	//setupDemoFeed(onPacket); // см. ниже — просто для демонстрации, замените на свой источник данных
});

// ==================================================================
// Демонстрационный генератор пакетов (замените на ваш WebSocket/Serial/BLE и т.п.)
// ==================================================================
function setupDemoFeed(onPacket)
{
	const btn = document.getElementById('demo-send');
	if (!btn) return;

	btn.addEventListener('click', () =>
	{
		sendUint8('0x0166', Math.floor(Math.random() * 3));
		sendUint16('0x0110', Math.floor(Math.random() * 1200)); // scale 10 -> км/ч *10
		sendUint16('0x0113', 500 + Math.floor(Math.random() * 500)); // scale 10 -> V*10
		sendUint16Array('0x0190', Array.from({ length: 12 }, () => 3000 + Math.floor(Math.random() * 500)));
	});

	function sendUint8(id, val)
	{
		const buf = new ArrayBuffer(1);
		new DataView(buf).setUint8(0, val);
		onPacket(id, buf);
	}
	function sendUint16(id, val)
	{
		const buf = new ArrayBuffer(2);
		new DataView(buf).setUint16(0, val, true);
		onPacket(id, buf);
	}
	function sendUint16Array(id, arr)
	{
		const buf = new ArrayBuffer(arr.length * 2);
		const view = new DataView(buf);
		arr.forEach((v, i) => view.setUint16(i * 2, v, true));
		onPacket(id, buf);
	}
}



