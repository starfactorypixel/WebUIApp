export const TYPE_SIZES = {
  uint8: 1, int8: 1,
  uint16: 2, int16: 2,
  uint32: 4, int32: 4,
  float32: 4,
};

export function typeSize(type) {
  return TYPE_SIZES[type] ?? 1;
}

export function parseNumber(view, offset, type, scale = 1) {
  let raw;
  switch (type) {
    case 'uint8':   raw = view.getUint8(offset); break;
    case 'int8':    raw = view.getInt8(offset); break;
    case 'uint16':  raw = view.getUint16(offset, true); break;
    case 'int16':   raw = view.getInt16(offset, true); break;
    case 'uint32':  raw = view.getUint32(offset, true); break;
    case 'int32':   raw = view.getInt32(offset, true); break;
    case 'float32': raw = view.getFloat32(offset, true); break;
    default: throw new Error('unknown type ' + type);
  }
  return raw / scale;
}





/**
 * Чтение числа из обычного массива JS через DataView
 * @param {number[]} arr - обычный JS массив чисел 0-255
 * @param {number} offset - смещение в байтах
 * @param {'int8'|'uint8'|'int16'|'uint16'|'int32'|'uint32'|'float32'|'float64'} type
 * @param {boolean} [littleEndian=true]
 */
export function readNumberFromArray(arr, offset, type, littleEndian = true)
{
	if(arr.length <= offset) return null;
  // превращаем массив в Uint8Array
  const u8 = new Uint8Array(arr);
  const view = new DataView(u8.buffer);

  switch (type) {
	case 'bool': return view.getUint8(offset);
    case 'int8': return view.getInt8(offset);
    case 'uint8': return view.getUint8(offset);
    case 'int16': return view.getInt16(offset, littleEndian);
    case 'uint16': return view.getUint16(offset, littleEndian);
    case 'int32': return view.getInt32(offset, littleEndian);
    case 'uint32': return view.getUint32(offset, littleEndian);
    case 'float32': return view.getFloat32(offset, littleEndian);
    case 'float64': return view.getFloat64(offset, littleEndian);
    default: throw new Error('Unknown type: ' + type);
  }
}


export function writeNumberToArray(value, type, littleEndian = false)
{
	const types =
	{
		bool:    ['setUint8',   1, value ? 1 : 0],
		int8:    ['setInt8',    1, value],
		uint8:   ['setUint8',   1, value],
		int16:   ['setInt16',   2, value],
		uint16:  ['setUint16',  2, value],
		int32:   ['setInt32',   4, value],
		uint32:  ['setUint32',  4, value],
		float32: ['setFloat32', 4, value],
		float64: ['setFloat64', 8, value],
	};

	const t = types[type];
	if(!t) throw new Error('Unknown type: ' + type);

	const [method, size, val] = t;

	const buffer = new ArrayBuffer(size);
	const view = new DataView(buffer);

	if(size === 1)
		view[method](0, val);
	else
		view[method](0, val, littleEndian);

	return Array.from(new Uint8Array(buffer));
}




export function writeNumberToArray2(value, type, littleEndian) {
  const sizes = { uint8:1, int8:1, uint16:2, int16:2, uint32:4, int32:4, float32:4 };
  const size = sizes[type] ?? 1;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const setters = {
    uint8: 'setUint8', int8: 'setInt8',
    uint16: 'setUint16', int16: 'setInt16',
    uint32: 'setUint32', int32: 'setInt32',
    float32: 'setFloat32',
  };
  const method = setters[type] ?? 'setUint8';
  view[method](0, value, ...(size > 1 ? [littleEndian] : []));
  return Array.from(new Uint8Array(buf));
}