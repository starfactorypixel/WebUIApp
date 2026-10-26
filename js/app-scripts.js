// Вход scripts.html: список скриптов в ESP (ScriptList), редактор (ScriptEditor), команды серверу (ScriptOps).
//
//   клик по строке списка  → чтение скрипта → в редактор
//   галочка в списке       → включить/отключить → флаги в списке
//   записать/удалить/перезагрузить → после ответа список обновляется
//   соединение открылось   → список

import { WSEvents, WSStart } from './utils/ws.js';
import { Int2Hex } from './utils/format.js';
import { ScriptOps } from './scripts/ops.js';
import { ScriptList } from './scripts/list.js';
import { ScriptEditor } from './scripts/editor.js';
import { Addr } from './scripts/disasm.js';
import drake_script from '../data/drake_script.json' with { type: 'json' };

const root = document.querySelector('.scripts');
const button = cmd => document.querySelector(`[data-cmd="${cmd}"]`);
const BUSY_BUTTONS = ['load', 'save', 'delete', 'reload', 'list'];

const ops = new ScriptOps({
	onBusy: (busy) =>
	{
		root.classList.toggle('is-busy', busy);
		for(const cmd of BUSY_BUTTONS) button(cmd).disabled = busy;
		list.SetBusy(busy);
		if(!busy) editor.ShowInfo();
	},
	onProgress: (text) => editor.ShowProgress(text),
	onResult: (cmd, data) =>
	{
		switch(cmd)
		{
			case 'ScriptLoadResp':   editor.Set(data.id, data.data); list.Mark(data.id); break;
			case 'ScriptListResp':   list.Show(data.scripts); break;
			case 'ScriptEnableResp': list.SetFlags(data.id, data.flags); break;
			default:                 ops.List();	// записан, удалён, перезагружены — список изменился
		}
	},
});

const list = new ScriptList(document.getElementById('list_body'), document.getElementById('list_info'), {
	onOpen: (id) => { editor.SetId(id); ops.Load(id); },
	onEnable: (id, on) => ops.Enable(id, on),
});

const editor = new ScriptEditor({
	id: document.getElementById('script_id'),
	text: document.getElementById('script_text'),
	info: document.getElementById('script_info'),
	file: document.getElementById('script_file'),
}, drake_script, (id) => list.Mark(id));


function Save()
{
	const id = editor.ReadId();
	if(id === null) return;
	const bytes = editor.ReadBytes();
	if(bytes === null) return;

	if(bytes.error && !confirm(`Скрипт сломан с адреса ${Addr(bytes.error.addr)}: ${bytes.error.message}.\nИсполнение на ESP там остановится. Всё равно записать?`)) return;
	const exists = list.Has(id) ? ' Скрипт с этим ID уже есть и будет заменён.' : '';
	if(!confirm(`Записать скрипт ${Int2Hex(id, 4)} (${bytes.data.length} байт) в ESP?${exists}`)) return;

	ops.Save(id, bytes.data);
}

function Delete()
{
	const id = editor.ReadId();
	if(id === null) return;
	if(!confirm(`Удалить скрипт ${Int2Hex(id, 4)} из ESP?`)) return;

	ops.Delete(id);
}

button('load').addEventListener('click', () => { const id = editor.ReadId(); if(id !== null) ops.Load(id); });
button('save').addEventListener('click', Save);
button('delete').addEventListener('click', Delete);
button('reload').addEventListener('click', () => ops.Reload());
button('list').addEventListener('click', () => ops.List());
button('open').addEventListener('click', () => editor.OpenFile());
button('download').addEventListener('click', () => editor.DownloadFile());
button('format').addEventListener('click', () => editor.Format());
button('clear').addEventListener('click', () => editor.Clear());

WSEvents.addEventListener('open', () => ops.List());

WSStart();
