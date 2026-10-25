import { registerWidget } from './client/registry.js';
import { initWidgets, deinitWidgets } from './client/dispatch.js';
import { WSStart } from './utils/ws.js';
import { log } from './utils/loghtml.js';
import './client/subscriptions.js'; // маршрутизация пакетов и повтор подписок после переподключения
import { Tabs } from './utils/tabs.js';
import { Control } from './client/control.js';
import { ButtonWidget } from './client/widgets/button.js';
import { ValueWidget } from './client/widgets/value.js';
import { MeterWidget } from './client/widgets/meter.js';
import { StreamWidget } from './client/widgets/stream.js';
import { RadioWidget } from './client/widgets/radio.js';
import { RangeWidget } from './client/widgets/range.js';
import { CellBalanceWidget } from './client/widgets/cellbalance.js';

// Сколько ждать ответ 0x65 на команду (мс). У виджета можно переопределить: config.timeout.
Control.timeout = 2000;

// 1. Регистрируем все известные типы виджетов в одном месте.
//    Чтобы добавить новый тип — создать файл widgets/xxx.js и добавить сюда одну строку.
[ButtonWidget, ValueWidget, MeterWidget, StreamWidget, RadioWidget, RangeWidget, CellBalanceWidget].forEach(registerWidget);

// 2. Вкладки: виджеты живут только на открытой вкладке.
const root = document.getElementById('myTabs');

// Подписываемся ДО создания, чтобы поймать открытие первой вкладки
root.addEventListener('tab:close', e =>
{
	log.info(`[Вкладки] Закрытие "${e.detail.title}"`);
	deinitWidgets(e.detail.panel);
});

root.addEventListener('tab:open', e =>
{
	log.info(`[Вкладки] Открытие "${e.detail.title}"`);
	initWidgets(e.detail.panel);
});

const tabs = new Tabs(root, { active: 0 });

// 3. Виджеты вне вкладок (если есть) — живут всё время.
initWidgets(document, el => !el.closest('[data-tab-title]'));

// 4. Соединение. Порядок больше не важен: подписки, сделанные до 'open',
//    отправятся сами, как только сокет откроется, и повторятся после обрыва.
WSStart();
