// Дизассемблер DrakeScript: байты скрипта → читаемый текст.
//
//   const { text, ops, error } = Disassemble(bytes, drake_script_json);
//
// Каждая команда — комментарий с адресом, именем и аргументами + её байты:
//
//   // 0006 SetRegVal(reg: A, val: 100)
//   0x30 0x06 0x64 0x00 0x00 0x00
//
// Описания стоят в комментариях, поэтому текст можно снова записать в ESP как есть (parseHexBytes).
// Адрес — смещение команды в байтах от начала скрипта (на него указывают jump).
//
// Разбор идёт так же, как исполнение на ESP: команда за командой, без попыток «найти» следующую.
// Первая ошибка останавливает разбор, остаток выводится сырыми байтами одним блоком:
//   - неизвестный опкод;
//   - команда обрезана концом скрипта;
//   - регистр или значение enum, которых нет в JSON, или значение вне min/max
//     (обычно признак сдвига: команда съела чужие байты).
// После разбора проверяются переходы: jump должен указывать на начало команды.
// error — первая ошибка { addr, message } или null.
//
// Описание команд — data/drake_script.json:
//   opcodes[]: { code, length, name, format: [{ name, type, enum?, print?, min?, max? }] }
//   type: uint8/int8/uint16/int16/uint32/int32 (byte = uint8), reg, enum, can_id
//   print: "hex:N" — вывести как 0x + N hex-цифр
//   min/max — допустимые значения поля
//   поле с именем jump — адрес перехода
// JSON проверяется при первом использовании: length каждой команды = 1 (опкод) + размеры полей. Ошибки — в консоль.

import { readNumberFromArray, typeSize } from '../utils/parse.js';
import { Int2Hex, formatHexBytes } from '../utils/format.js';

const FIELD_SIZE = { reg: 1, enum: 1, can_id: 2 };
const RAW_PER_LINE = 16;	// байт в строке сырого остатка

const checked = new WeakSet();

export function Disassemble(bytes, cfg)
{
	if(!checked.has(cfg)) { CheckConfig(cfg); checked.add(cfg); }

	const opcodes = new Map(cfg.opcodes.map(op => [parseInt(op.code, 16), op]));
	const lines = [];		// { addr, comment, bytes, jumps: [цель] }
	let error = null;
	let i = 0;

	while(i < bytes.length)
	{
		const def = opcodes.get(bytes[i]);
		if(!def) { error = { addr: i, message: `неизвестный опкод ${Int2Hex(bytes[i], 2)}` }; break; }

		const chunk = bytes.slice(i, i + def.length);
		if(chunk.length < def.length) { error = { addr: i, message: `${def.name} обрезана: ${chunk.length} из ${def.length} байт` }; break; }

		const { text, jumps, bad } = readArgs(chunk, def.format ?? [], cfg);
		if(bad) { error = { addr: i, message: `${def.name}: ${bad}` }; break; }

		lines.push({ addr: i, comment: def.format ? `${def.name}(${text})` : def.name, bytes: chunk, jumps });
		i += def.length;
	}

	// Переходы — только на начало команды (если разбор дошёл до конца)
	if(error === null)
	{
		const starts = new Set(lines.map(l => l.addr));
		for(const l of lines)
			for(const target of l.jumps)
				if(!starts.has(target))
				{
					const message = `jump ${target} не на начало команды`;
					l.comment += ` ← ОШИБКА: ${message}`;
					error ??= { addr: l.addr, message: `${l.comment.split('(')[0]}: ${message}` };
				}
	}

	const out = lines.map(l => `// ${Addr(l.addr)} ${l.comment}\n${formatHexBytes(l.bytes)}\n`);
	if(error !== null && i < bytes.length)
	{
		const rest = [];
		for(let p = i; p < bytes.length; p += RAW_PER_LINE) rest.push(formatHexBytes(bytes.slice(p, p + RAW_PER_LINE)));
		out.push(`// ${Addr(i)} ОШИБКА: ${error.message} — исполнение здесь остановится, дальше не разобрано\n${rest.join('\n')}\n`);
	}

	return { text: out.join('\n'), ops: lines.length, error };
}

export function Addr(addr)
{
	return String(addr).padStart(4, '0');
}

// Аргументы команды: "reg: A, val: 100". Первый байт chunk — опкод.
// bad — текст ошибки, если значение вне min/max
function readArgs(chunk, format, cfg)
{
	const args = [];
	const jumps = [];
	let offset = 1;

	for(const field of format)
	{
		const { raw, value, size } = readField(chunk, offset, field, cfg);
		if(value === undefined) return { bad: `${field.name} = ${Int2Hex(raw, 2)} — нет в ${field.type === 'reg' ? 'registers' : field.enum}` };
		args.push(`${field.name}: ${value}`);
		offset += size;

		if(field.min !== undefined && raw < field.min) return { bad: `${field.name} = ${raw}, меньше ${field.min}` };
		if(field.max !== undefined && raw > field.max) return { bad: `${field.name} = ${raw}, больше ${field.max}` };
		if(field.name === 'jump') jumps.push(raw);
	}

	return { text: args.join(', '), jumps, bad: null };
}

function readField(chunk, offset, field, cfg)
{
	switch(field.type)
	{
		case 'reg':
		{
			const raw = chunk[offset];
			return { raw, value: cfg.registers[raw], size: 1 };		// нет в registers — undefined (ошибка)
		}

		case 'enum':
		{
			const raw = chunk[offset];
			return { raw, value: cfg.enums[field.enum]?.[raw], size: 1 };	// нет в enum — undefined (ошибка)
		}

		case 'can_id':
		{
			const raw = readNumberFromArray(chunk, offset, 'uint16') & 0x0FFF;
			return { raw, value: Int2Hex(raw, 4), size: 2 };
		}

		default:
		{
			const type = field.type === 'byte' ? 'uint8' : field.type;
			const raw = readNumberFromArray(chunk, offset, type);
			const [print, pad] = (field.print ?? '').split(':');
			return { raw, value: print === 'hex' ? Int2Hex(raw, Number(pad)) : raw, size: typeSize(type) };
		}
	}
}

function SafeSize(type)
{
	try { return typeSize(type); } catch(e) { return 0; }
}

// length каждой команды = 1 + размеры полей; типы и enum известны; коды не повторяются
function CheckConfig(cfg)
{
	const seen = new Set();
	for(const op of cfg.opcodes)
	{
		const where = `[drake_script.json] ${op.code} ${op.name}`;
		const code = parseInt(op.code, 16);
		if(seen.has(code)) console.error(`${where}: код повторяется`);
		seen.add(code);

		let size = 1;
		for(const f of op.format ?? [])
		{
			const type = f.type === 'byte' ? 'uint8' : f.type;
			const s = FIELD_SIZE[type] ?? SafeSize(type);
			if(!s) { console.error(`${where}: поле ${f.name} — неизвестный тип ${f.type}`); continue; }
			if(type === 'enum' && !cfg.enums[f.enum]) console.error(`${where}: поле ${f.name} — нет enum ${f.enum}`);
			size += s;
		}

		if(size !== op.length) console.error(`${where}: length ${op.length}, а по полям ${size} (опкод + поля)`);
	}
}
