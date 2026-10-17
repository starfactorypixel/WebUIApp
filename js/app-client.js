import { registerWidget } from './client/registry.js';
import { initWidgets, deinitWidgets } from './client/dispatch.js';
import { WSStart, WSEvents } from './ws.js';
import './client/subscriptions.js'; // маршрутизация пакетов и повтор подписок после переподключения
import { Tabs } from './tabs.js';
import { ObjGroup } from './client/obj-group.js';
import { ButtonWidget } from './widgets/button.js';
import { ValueWidget } from './widgets/value.js';
import { MeterWidget } from './widgets/meter.js';
import { StreamWidget } from './widgets/stream.js';
import { RadioWidget } from './widgets/radio.js';
import { RangeWidget } from './widgets/range.js';

const WS_URL = 'ws://localhost:8080';

// Сколько ждать ответ 0x65 на команду (мс). У виджета можно переопределить: config.timeout.
ObjGroup.defaultTimeout = 2000;

// 1. Регистрируем все известные типы виджетов в одном месте.
//    Чтобы добавить новый тип — создать файл widgets/xxx.js и добавить сюда одну строку.
[ButtonWidget, ValueWidget, MeterWidget, StreamWidget, RadioWidget, RangeWidget].forEach(registerWidget);

// 2. Лог на странице
const logEl = document.getElementById('log');
const LOG_MAX_LINES = 200;
const log = msg =>
{
	if(!logEl) return;
	const line = document.createElement('div');
	line.textContent = msg;
	logEl.appendChild(line);
	while(logEl.childElementCount > LOG_MAX_LINES) logEl.firstElementChild.remove();
	logEl.scrollTop = logEl.scrollHeight;
};

WSEvents.addEventListener('open', () => log('[WS] Соединение установлено'));
WSEvents.addEventListener('close', () => log('[WS] Соединение потеряно, переподключение…'));

// 3. Вкладки: виджеты живут только на открытой вкладке.
const root = document.getElementById('myTabs');

// Подписываемся ДО создания, чтобы поймать открытие первой вкладки
root.addEventListener('tab:close', e =>
{
	log(`[Закрытие] "${e.detail.title}"`);
	deinitWidgets(e.detail.panel);
});

root.addEventListener('tab:open', e =>
{
	log(`[Открытие] "${e.detail.title}"`);
	initWidgets(e.detail.panel);
});

const tabs = new Tabs(root, { active: 0 });

// 4. Виджеты вне вкладок (если есть) — живут всё время.
initWidgets(document, el => !el.closest('[data-tab-title]'));

// 5. Соединение. Порядок больше не важен: подписки, сделанные до 'open',
//    отправятся сами, как только сокет откроется, и повторятся после обрыва.
WSStart(WS_URL);
