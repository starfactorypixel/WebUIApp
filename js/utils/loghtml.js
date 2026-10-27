// Лог системы: строка на странице (в <div id="log">, если он есть) + консоль браузера.
//
//   import { log } from './loghtml.js';
//   log.info('[WS] Соединение установлено');
//   log.warn('[Газ М1+М2] SET 700: 0x0104=700, 0x0105=нет ответа');
//   log.error('Некорректный JSON в config', el, err);
//   log.packet('Газ М1+М2', '→', 0x0104, [0x0A, 0x05, 0xE5, 0x02]);   // отладка пакетов ("debug": true в config)
//
// Первый аргумент — текст (он попадает на страницу).
// Остальные аргументы (элементы, ошибки, объекты) — только в консоль, там их удобно раскрыть.

const LOG_MAX_LINES = 200;

function write(level, msg, extra)
{
	const time = new Date().toTimeString().slice(0, 8); // ЧЧ:ММ:СС
	const text = `${time} ${msg}`;

	// Консоль
	if(level === 'error') console.error(text, ...extra);
	else if(level === 'warn') console.warn(text, ...extra);
	else console.log(text, ...extra);

	// Страница
	const el = document.getElementById('log');
	if(!el) return;

	const line = document.createElement('div');
	line.className = 'log_' + level; // log_info / log_warn / log_error — цвет в client.css
	line.textContent = text;
	el.appendChild(line);

	while(el.childElementCount > LOG_MAX_LINES) el.firstElementChild.remove();
	el.scrollTop = el.scrollHeight;
}

export const log =
{
	info:  (msg, ...extra) => write('info', msg, extra),
	warn:  (msg, ...extra) => write('warn', msg, extra),
	error: (msg, ...extra) => write('error', msg, extra),

	// Пакет объекта CAN: "[Газ М1+М2] → 0x0104: 0A 05 E5 02" (→ отправлен, ← принят)
	packet: (name, dir, id, bytes) => write('info', `[${name}] ${dir} 0x${hex(id, 4)}: ${Array.from(bytes, b => hex(b, 2)).join(' ')}`, []),
};

function hex(num, pad)
{
	return num.toString(16).toUpperCase().padStart(pad, '0');
}
