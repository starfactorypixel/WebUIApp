// Вход scripts.html: редактор скриптов ESP32 (DrakeScript) и список скриптов в ESP.
//
// Браузер ⇄ server.js (WS), обмен с ESP по частям ведёт сервер (SCRIPTS_PROTOCOL.md):
//   ScriptLoad {id}         ← ScriptLoadResp   {id, data}
//   ScriptSave {id, data}   ← ScriptSaveResp   {id}
//   ScriptDelete {id}       ← ScriptDeleteResp {id}
//   ScriptReload {}         ← ScriptReloadResp {count}
//   ScriptList {}           ← ScriptListResp   {scripts: [{id, length, flags}]}
//   ScriptEnable {id, on}   ← ScriptEnableResp {id, flags}
//   во время чтения/записи  ← ScriptProgress   {done, total}
// Ошибка — поле error в ответе.
//
// Одновременно — одна операция: кнопки блокируются до ответа или до OP_TIMEOUT_MS.

import { WSEvents, WSStart, WSSend } from './utils/ws.js';
import { log } from './utils/loghtml.js';
import { parseHexBytes } from './utils/parse.js';
import { Int2Hex } from './utils/format.js';
import { Disassemble } from './scripts/disasm.js';
import drake_script from '../data/drake_script.json' with { type: 'json' };

const WS_URL = 'ws://localhost:8080';

const SCRIPT_ID_MAX = 0x7FF;		// 2048 скриптов в ESP (ScriptLogic::SCRIPTS_COUNT)
const SCRIPT_LEN_MAX = 4096 - 16;	// сектор флеш-памяти минус заголовок (nor_script_header_h)
const OP_TIMEOUT_MS = 15000;		// сервер сам ограничивает каждый шаг; это — страховка

// flags из ESP
const FLAG_LOADED = 0x02;
const FLAG_ENABLED = 0x04;

const root = document.querySelector('.scripts');
const idInput = document.getElementById('script_id');
const text = document.getElementById('script_text');
const info = document.getElementById('script_info');
const fileInput = document.getElementById('script_file');
const listBody = document.getElementById('list_body');
const listInfo = document.getElementById('list_info');
const button = cmd => document.querySelector(`[data-cmd="${cmd}"]`);

let pending = null;			// текущая операция: { cmd, timer }
let list = new Map();		// id -> { length, flags } — скрипты в ESP


// ================================================================ Операции с ESP

function Load(id = ReadId())
{
	if(id === null) return;
	Start('ScriptLoad', { id }, `Чтение скрипта ${Int2Hex(id, 4)}…`);
}

function Save()
{
	const id = ReadId();
	if(id === null) return;

	const data = parseHexBytes(text.value);
	if(data.length === 0) { log.warn('[Скрипты] Нечего записывать: в редакторе нет байт'); return; }
	if(data.length > SCRIPT_LEN_MAX) { log.warn(`[Скрипты] Скрипт ${data.length} байт, максимум ${SCRIPT_LEN_MAX}`); return; }

	const { unknown } = Disassemble(data, drake_script);
	if(unknown > 0 && !confirm(`В скрипте ${unknown} неизвестных опкодов. Всё равно записать?`)) return;
	const exists = list.has(id) ? ' Скрипт с этим ID уже есть и будет заменён.' : '';
	if(!confirm(`Записать скрипт ${Int2Hex(id, 4)} (${data.length} байт) в ESP?${exists}`)) return;

	Start('ScriptSave', { id, data }, `Запись скрипта ${Int2Hex(id, 4)}, ${data.length} байт…`);
}

function Delete()
{
	const id = ReadId();
	if(id === null) return;
	if(!confirm(`Удалить скрипт ${Int2Hex(id, 4)} из ESP?`)) return;

	Start('ScriptDelete', { id }, `Удаление скрипта ${Int2Hex(id, 4)}…`);
}

function Reload()
{
	Start('ScriptReload', {}, 'Перезагрузка всех скриптов в ESP…');
}

function List()
{
	Start('ScriptList', {}, null);
}

function Enable(id, on)
{
	Start('ScriptEnable', { id, on }, `${on ? 'Включение' : 'Отключение'} скрипта ${Int2Hex(id, 4)}…`);
}

// Отправить команду и заблокировать кнопки до ответа
function Start(cmd, data, message)
{
	if(pending) return;

	if(!WSSend({ cmd, data }))
	{
		log.warn('[Скрипты] Нет связи с сервером — не отправлено');
		return;
	}

	if(message) log.info('[Скрипты] ' + message);
	pending = { cmd, timer: setTimeout(OnTimeout, OP_TIMEOUT_MS) };
	SetBusy(true);
}

function OnTimeout()
{
	log.warn(`[Скрипты] Нет ответа сервера на ${pending.cmd} за ${OP_TIMEOUT_MS / 1000} с`);
	pending = null;
	SetBusy(false);
	ShowInfo();
}

// Ответ сервера
WSEvents.addEventListener('response', (e) =>
{
	const { cmd, data } = e.detail;
	if(!pending) return;

	if(cmd === 'ScriptProgress')
	{
		info.textContent = `${pending.cmd === 'ScriptSave' ? 'Запись' : 'Чтение'}: ${data.done} / ${data.total} байт`;
		return;
	}
	if(cmd !== pending.cmd + 'Resp') return;

	clearTimeout(pending.timer);
	pending = null;
	SetBusy(false);
	ShowInfo();

	const name = data.id !== undefined ? `Скрипт ${Int2Hex(data.id, 4)}` : 'Скрипты';
	if(data.error)
	{
		log.error(`[Скрипты] ${name}: ${data.error}`);
		return;
	}

	switch(cmd)
	{
		case 'ScriptLoadResp':
			idInput.value = data.id.toString(16).toUpperCase();
			text.value = Disassemble(data.data, drake_script).text;
			ShowInfo();
			MarkCurrent();
			log.info(`[Скрипты] ${name} прочитан: ${data.data.length} байт`);
			break;

		case 'ScriptSaveResp':
			log.info(`[Скрипты] ${name} записан`);
			List();
			break;

		case 'ScriptDeleteResp':
			log.info(`[Скрипты] ${name} удалён`);
			List();
			break;

		case 'ScriptReloadResp':
			log.info(`[Скрипты] ESP перечитал скрипты из флеш-памяти: загружено ${data.count}`);
			List();
			break;

		case 'ScriptListResp':
			list = new Map(data.scripts.map(s => [s.id, s]));
			ShowList();
			break;

		case 'ScriptEnableResp':
			if(list.has(data.id)) list.get(data.id).flags = data.flags;
			ShowList();
			log.info(`[Скрипты] ${name} ${data.flags & FLAG_ENABLED ? 'включён' : 'отключён'}`);
			break;
	}
});

// Связь есть — получить список скриптов
WSEvents.addEventListener('open', () => List());


// ================================================================ Список скриптов

function ShowList()
{
	listBody.innerHTML = '';
	for(const s of [...list.values()].sort((a, b) => a.id - b.id))
	{
		const on = (s.flags & FLAG_ENABLED) !== 0;
		const tr = document.createElement('tr');
		tr.dataset.id = s.id;
		tr.classList.toggle('is-off', !on);
		tr.classList.toggle('is-unloaded', (s.flags & FLAG_LOADED) === 0);
		tr.title = (s.flags & FLAG_LOADED) ? 'Открыть в редакторе' : 'Не загружен в память ESP (ошибка CRC или нет места). Открыть в редакторе';
		tr.innerHTML = `<td>${Int2Hex(s.id, 3)}</td><td>${s.length}</td><td><input type="checkbox" title="Включён"></td>`;

		const box = tr.querySelector('input');
		box.checked = on;
		box.disabled = pending !== null;
		box.addEventListener('click', (e) =>
		{
			e.preventDefault();		// галочку ставит только ответ ESP (ShowList)
			e.stopPropagation();	// не открывать скрипт
			Enable(s.id, !on);
		});

		tr.addEventListener('click', () =>
		{
			idInput.value = s.id.toString(16).toUpperCase();
			Load(s.id);
		});

		listBody.appendChild(tr);
	}

	const total = [...list.values()].reduce((sum, s) => sum + s.length, 0);
	listInfo.textContent = `${list.size} скриптов, ${total} байт`;
	MarkCurrent();
}

// Подсветить в списке скрипт, ID которого в поле
function MarkCurrent()
{
	const id = parseInt(idInput.value, 16);
	for(const tr of listBody.children) tr.classList.toggle('is-current', Number(tr.dataset.id) === id);
}


// ================================================================ Редактор

// Разобрать: байты из текста → текст с именами команд в комментариях
function Format()
{
	text.value = Disassemble(parseHexBytes(text.value), drake_script).text;
	ShowInfo();
}

function Clear()
{
	text.value = '';
	fileInput.value = '';
	ShowInfo();
}

function OpenFile()
{
	const file = fileInput.files[0];
	if(!file) return;

	const reader = new FileReader();
	reader.onload = () =>
	{
		text.value = reader.result;
		ShowInfo();
		log.info(`[Скрипты] Открыт файл ${file.name}`);
	};
	reader.onerror = () => log.error(`[Скрипты] Ошибка чтения файла ${file.name}`);
	reader.readAsText(file);
}

function DownloadFile()
{
	const id = idInput.value ? Int2Hex(parseInt(idInput.value, 16), 4) : 'script';
	const link = document.createElement('a');
	link.href = URL.createObjectURL(new Blob([text.value], { type: 'text/plain' }));
	link.download = `${id}.drs`;
	link.click();
	URL.revokeObjectURL(link.href);
}

// Сводка под редактором: размер, команды, неизвестные опкоды
function ShowInfo()
{
	const bytes = parseHexBytes(text.value);
	if(bytes.length === 0) { info.textContent = ''; return; }

	const { ops, unknown } = Disassemble(bytes, drake_script);
	const parts = [`${bytes.length} байт`, `${ops} команд`];
	if(unknown > 0) parts.push(`<span class="is-bad">${unknown} неизвестных опкодов</span>`);
	if(bytes.length > SCRIPT_LEN_MAX) parts.push(`<span class="is-bad">больше ${SCRIPT_LEN_MAX} байт</span>`);
	info.innerHTML = parts.join(' · ');
}

// ID из поля: hex 0..7FF, иначе null + подсветка поля
function ReadId()
{
	const value = idInput.value.trim();
	const id = parseInt(value, 16);
	const ok = /^[0-9a-fA-F]{1,3}$/.test(value) && id <= SCRIPT_ID_MAX;

	if(!ok)
	{
		idInput.setCustomValidity(`ID скрипта — hex от 0 до ${SCRIPT_ID_MAX.toString(16).toUpperCase()}`);
		idInput.reportValidity();
		return null;
	}
	idInput.setCustomValidity('');
	return id;
}

function SetBusy(busy)
{
	root.classList.toggle('is-busy', busy);
	for(const cmd of ['load', 'save', 'delete', 'reload', 'list']) button(cmd).disabled = busy;
	for(const box of listBody.querySelectorAll('input')) box.disabled = busy;
}


// ================================================================ Запуск

button('load').addEventListener('click', () => Load());
button('save').addEventListener('click', Save);
button('delete').addEventListener('click', Delete);
button('reload').addEventListener('click', Reload);
button('list').addEventListener('click', List);
button('open').addEventListener('click', () => fileInput.click());
button('download').addEventListener('click', DownloadFile);
button('format').addEventListener('click', Format);
button('clear').addEventListener('click', Clear);
fileInput.addEventListener('change', OpenFile);
text.addEventListener('input', ShowInfo);
idInput.addEventListener('input', () => { idInput.setCustomValidity(''); MarkCurrent(); });

WSStart(WS_URL);
