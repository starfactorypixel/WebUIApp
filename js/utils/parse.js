export const TYPE_SIZES = {
	bool: 1,
	uint8: 1, int8: 1,
	uint16: 2, int16: 2,
	uint32: 4, int32: 4,
	float32: 4, float64: 8,
};

export function typeSize(type)
{
	const size = TYPE_SIZES[type];
	if(size === undefined) throw new Error('Unknown type: ' + type);
	return size;
}

/**
 * Чтение числа из массива байт.
 * @param {number[]|Uint8Array|ArrayBuffer} arr - байты пакета (0-255)
 * @param {number} offset - смещение в байтах
 * @param {'bool'|'int8'|'uint8'|'int16'|'uint16'|'int32'|'uint32'|'float32'|'float64'} type
 * @param {boolean} [littleEndian=true]
 * @returns {number|null} null, если байт не хватает (короткий/пустой пакет)
 */
export function readNumberFromArray(arr, offset, type, littleEndian = true)
{
	const size = typeSize(type);
	if(arr == null) return null;

	const u8 = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
	if(offset < 0 || offset + size > u8.length) return null;

	const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
	switch(type)
	{
		case 'bool':    return view.getUint8(offset);
		case 'int8':    return view.getInt8(offset);
		case 'uint8':   return view.getUint8(offset);
		case 'int16':   return view.getInt16(offset, littleEndian);
		case 'uint16':  return view.getUint16(offset, littleEndian);
		case 'int32':   return view.getInt32(offset, littleEndian);
		case 'uint32':  return view.getUint32(offset, littleEndian);
		case 'float32': return view.getFloat32(offset, littleEndian);
		case 'float64': return view.getFloat64(offset, littleEndian);
	}
}

/**
 * Запись числа в массив байт.
 * @param {boolean} [littleEndian=true] - по умолчанию как в readNumberFromArray
 */
export function writeNumberToArray(value, type, littleEndian = true)
{
	const size = typeSize(type);
	const view = new DataView(new ArrayBuffer(size));

	switch(type)
	{
		case 'bool':    view.setUint8(0, value ? 1 : 0); break;
		case 'int8':    view.setInt8(0, value); break;
		case 'uint8':   view.setUint8(0, value); break;
		case 'int16':   view.setInt16(0, value, littleEndian); break;
		case 'uint16':  view.setUint16(0, value, littleEndian); break;
		case 'int32':   view.setInt32(0, value, littleEndian); break;
		case 'uint32':  view.setUint32(0, value, littleEndian); break;
		case 'float32': view.setFloat32(0, value, littleEndian); break;
		case 'float64': view.setFloat64(0, value, littleEndian); break;
	}

	return Array.from(new Uint8Array(view.buffer));
}

/**
 * Список "значение:подпись" через запятую.
 * "255:ON,0:OFF" → Map { 255 → 'ON', 0 → 'OFF' } (порядок сохраняется)
 */
export function parseValueList(str)
{
	const map = new Map();
	if(!str) return map;

	for(const item of str.split(','))
	{
		const [value, name] = item.split(':');
		map.set(Number(value), name ?? '');
	}
	return map;
}
