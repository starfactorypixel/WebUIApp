// Редактор скрипта: поле ID, текст (байты в hex с комментариями), сводка под ним, файлы .drs.
// Байты разбирает parseHexBytes (комментарии игнорируются), «Разобрать» — дизассемблер (описания в комментариях, текст обратим).

import { log } from '../utils/loghtml.js';
import { parseHexBytes } from '../utils/parse.js';
import { Int2Hex, escapeHtml } from '../utils/format.js';
import { Disassemble, Addr } from './disasm.js';

const SCRIPT_ID_MAX = 0x7FF;		// 2048 скриптов в ESP (ScriptLogic::SCRIPTS_COUNT)
const SCRIPT_LEN_MAX = 4096 - 16;	// сектор флеш-памяти минус заголовок (nor_script_header_h)

export class ScriptEditor
{
	#id;
	#text;
	#info;
	#file;
	#cfg;

	/**
	 * @param {Object}   el        { id, text, info, file } — поле ID, textarea, сводка, input[type=file]
	 * @param {Object}   cfg       drake_script.json
	 * @param {Function} onIdInput (id | NaN) => void — ID в поле изменён
	 */
	constructor(el, cfg, onIdInput)
	{
		this.#id = el.id;
		this.#text = el.text;
		this.#info = el.info;
		this.#file = el.file;
		this.#cfg = cfg;

		this.#text.addEventListener('input', () => this.ShowInfo());
		this.#file.addEventListener('change', () => this.#openFile());
		this.#id.addEventListener('input', () =>
		{
			this.#id.setCustomValidity('');
			onIdInput(parseInt(this.#id.value, 16));
		});
	}

	// ID из поля: hex 0..7FF, иначе null + подсветка поля
	ReadId()
	{
		const value = this.#id.value.trim();
		const id = parseInt(value, 16);
		const ok = /^[0-9a-fA-F]{1,3}$/.test(value) && id <= SCRIPT_ID_MAX;

		if(!ok)
		{
			this.#id.setCustomValidity(`ID скрипта — hex от 0 до ${SCRIPT_ID_MAX.toString(16).toUpperCase()}`);
			this.#id.reportValidity();
			return null;
		}
		this.#id.setCustomValidity('');
		return id;
	}

	SetId(id)
	{
		this.#id.value = id.toString(16).toUpperCase();
		this.#id.setCustomValidity('');
	}

	// Прочитанный скрипт: ID и разобранный текст
	Set(id, bytes)
	{
		this.SetId(id);
		this.#text.value = Disassemble(bytes, this.#cfg).text;
		this.ShowInfo();
	}

	// Байты для записи: { data, error } или null (пусто / слишком длинный — в лог). error — первая ошибка разбора или null
	ReadBytes()
	{
		const data = parseHexBytes(this.#text.value);
		if(data.length === 0) { log.warn('[Скрипты] Нечего записывать: в редакторе нет байт'); return null; }
		if(data.length > SCRIPT_LEN_MAX) { log.warn(`[Скрипты] Скрипт ${data.length} байт, максимум ${SCRIPT_LEN_MAX}`); return null; }

		return { data, error: Disassemble(data, this.#cfg).error };
	}

	// Разобрать: байты из текста → текст с именами команд в комментариях
	Format()
	{
		this.#text.value = Disassemble(parseHexBytes(this.#text.value), this.#cfg).text;
		this.ShowInfo();
	}

	Clear()
	{
		this.#text.value = '';
		this.#file.value = '';
		this.ShowInfo();
	}

	OpenFile() { this.#file.click(); }

	DownloadFile()
	{
		const name = this.#id.value ? Int2Hex(parseInt(this.#id.value, 16), 4) : 'script';
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([this.#text.value], { type: 'text/plain' }));
		link.download = `${name}.drs`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	// Ход операции вместо сводки (сводка вернётся ShowInfo)
	ShowProgress(text)
	{
		this.#info.textContent = text;
	}

	// Сводка под редактором: размер, команды, ошибка разбора
	ShowInfo()
	{
		const bytes = parseHexBytes(this.#text.value);
		if(bytes.length === 0) { this.#info.textContent = ''; return; }

		const { ops, error } = Disassemble(bytes, this.#cfg);
		const parts = [`${bytes.length} байт`, `${ops} команд`];
		if(error) parts.push(`<span class="is-bad">ошибка разбора с адреса ${Addr(error.addr)}: ${escapeHtml(error.message)}</span>`);
		if(bytes.length > SCRIPT_LEN_MAX) parts.push(`<span class="is-bad">больше ${SCRIPT_LEN_MAX} байт</span>`);
		this.#info.innerHTML = parts.join(' · ');
	}

	#openFile()
	{
		const file = this.#file.files[0];
		if(!file) return;

		const reader = new FileReader();
		reader.onload = () =>
		{
			this.#text.value = reader.result;
			this.ShowInfo();
			log.info(`[Скрипты] Открыт файл ${file.name}`);
		};
		reader.onerror = () => log.error(`[Скрипты] Ошибка чтения файла ${file.name}`);
		reader.readAsText(file);
	}
}
