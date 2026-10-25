// Дизассемблер DrakeScript: байты скрипта → читаемый текст.
//
//   const { text, ops, unknown } = Disassemble(bytes, drake_script_json);
//
// Каждая команда — комментарий с адресом, именем и аргументами + её байты:
//
//   // 0006 SetRegVal(reg: A, val: 100)
//   0x30 0x06 0x64 0x00 0x00 0x00
//
// Описания стоят в комментариях, поэтому текст можно снова записать в ESP как есть (parseHexBytes).
// Адрес — смещение команды в байтах от начала скрипта (на него указывают jump).
//
// Описание команд — data/drake_script.json:
//   opcodes[]: { code, length, name, format: [{ name, type, enum?, print? }] }
//   type: uint8/int8/uint16/int16/uint32/int32 (byte = uint8), reg, enum, can_id
//   print: "hex:N" — вывести как 0x + N hex-цифр

import { readNumberFromArray, typeSize } from '../utils/parse.js';
import { Int2Hex, formatHexBytes } from '../utils/format.js';

export function Disassemble(bytes, cfg)
{
	const opcodes = new Map(cfg.opcodes.map(op => [parseInt(op.code, 16), op]));
	const lines = [];
	let ops = 0;
	let unknown = 0;
	let i = 0;

	while(i < bytes.length)
	{
		const addr = String(i).padStart(4, '0');
		const def = opcodes.get(bytes[i]);

		if(!def)
		{
			lines.push(`// ${addr} ??? неизвестный опкод\n${formatHexBytes([bytes[i]])}\n`);
			unknown++;
			i++;
			continue;
		}

		const chunk = bytes.slice(i, i + def.length);
		let comment = `${addr} ${def.name}`;
		if(def.format) comment += `(${formatArgs(chunk, def.format, cfg)})`;
		if(chunk.length < def.length) comment += ` — ОБРЕЗАНО: ${chunk.length} из ${def.length} байт`;

		lines.push(`// ${comment}\n${formatHexBytes(chunk)}\n`);
		ops++;
		i += def.length;
	}

	return { text: lines.join('\n'), ops, unknown };
}

// Аргументы команды: "reg: A, val: 100". Первый байт chunk — опкод.
function formatArgs(chunk, format, cfg)
{
	const args = [];
	let offset = 1;

	for(const field of format)
	{
		const { value, size } = readField(chunk, offset, field, cfg);
		args.push(`${field.name}: ${value}`);
		offset += size;
	}

	return args.join(', ');
}

function readField(chunk, offset, field, cfg)
{
	if(offset >= chunk.length) return { value: '?', size: 1 };

	switch(field.type)
	{
		case 'reg':
		{
			const raw = chunk[offset];
			return { value: cfg.registers[raw] ?? Int2Hex(raw, 2), size: 1 };
		}

		case 'enum':
		{
			const raw = chunk[offset];
			return { value: cfg.enums[field.enum]?.[raw] ?? raw, size: 1 };
		}

		case 'can_id':
		{
			const raw = readNumberFromArray(chunk, offset, 'uint16');
			return { value: raw === null ? '?' : Int2Hex(raw & 0x0FFF, 4), size: 2 };
		}

		default:
		{
			const type = field.type === 'byte' ? 'uint8' : field.type;
			const size = typeSize(type);
			const raw = readNumberFromArray(chunk, offset, type);
			if(raw === null) return { value: '?', size };

			const [print, pad] = (field.print ?? '').split(':');
			return { value: print === 'hex' ? Int2Hex(raw, Number(pad)) : raw, size };
		}
	}
}
