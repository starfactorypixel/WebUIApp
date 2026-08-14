
function parseHexBytes(input)
{
	input = input
		.replace(/\/\*[\s\S]*?\*\//g, '')	// /* ... */
		.replace(/\/\/.*$/gm, '')			// // ...
		.replace(/#.*$/gm, '')				// # ...
		.replace(/;.*$/gm, '');				// ; ...
	
	const matches = input.match(/0x[0-9a-fA-F]{1,2}|[0-9a-fA-F]{1,2}/g);
	if(!matches) return [];
	
	return matches.map(x => parseInt(x.replace(/^0x/i, ''), 16));
}

function formatHexBytes(bytes, options = {})
{
	const {
		prefix = "0x",
		uppercase = true,
		separator = " "
	} = options;
	
	return bytes.map(b => 
	{
		let hex = b.toString(16).padStart(2, "0");
		if(uppercase) hex = hex.toUpperCase();
		return prefix + hex;
	}).join(separator);
}

function int2hex(num, pad)
{
	return '0x' + num.toString(16).padStart(pad, "0").toUpperCase();
}

function fastFormatMs(ms) {
  // Битовое смещение ~~ работает как сверхбыстрый Math.floor
  const hr = ~~(ms / 3600000);
  const min = ~~((ms % 3600000) / 60000);
  const sec = ~~((ms % 60000) / 1000);
  const msec = ms % 1000;

  // Быстрая ручная склейка строк без массивов
  return (hr < 10 ? '0' + hr : hr) + ':' +
         (min < 10 ? '0' + min : min) + ':' +
         (sec < 10 ? '0' + sec : sec) + '.' +
         (msec < 10 ? '00' + msec : msec < 100 ? '0' + msec : msec);
}

function getRandomInt(min, max)
{
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function toHex4(n) {
  return "0x" + n.toString(16).toUpperCase().padStart(4, "0");
}

function sprintfNamed(str, data) {
  return str.replace(/\$\{(\w+)(?::([^}]+))?\}/g, (_, key, format) => {
    let value = data[key];
    if (value == null) return "";

    if (!format) return value;

    // ---- printf-подобный разбор ----
    const match = format.match(/%([ +]?)(0?)([0-9]*)(?:\.([0-9]+))?([dfsxX])/);

    if (!match) return value;

    let [, signFlag, zeroPad, width, precision, type] = match;

    // ---- Тип ----
    switch (type) {
      case "d": // integer
        value = parseInt(value);
        break;

      case "f": // float
        value = Number(value).toFixed(precision ? Number(precision) : 0);
        break;

      case "x": // hex lower
        value = Number(value).toString(16);
        break;

      case "X": // hex upper
        value = Number(value).toString(16).toUpperCase();
        break;

      case "s":
        value = String(value);
        break;
    }

    // ---- Обработка знака ----
    if (signFlag === "+" && value >= 0) {
      value = "+" + value;
    } 
    else if (signFlag === " " && value >= 0) {
      value = " " + value;
    }

    // ---- Дополнение нулями ----
    if (width) {
      const padChar = zeroPad ? "0" : " ";
      value = value.toString().padStart(Number(width), padChar);
    }

    return value;
  });
}

/**
 * Чтение числа из обычного массива JS через DataView
 * @param {number[]} arr - обычный JS массив чисел 0-255
 * @param {number} offset - смещение в байтах
 * @param {'int8'|'uint8'|'int16'|'uint16'|'int32'|'uint32'|'float32'|'float64'} type
 * @param {boolean} [littleEndian=false]
 */
function readNumberFromArray(arr, offset, type, littleEndian = false)
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


function writeNumberToArray(value, type, littleEndian = false)
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


const _jsonCache = new Map();
async function loadJson(file)
{
	if (_jsonCache.has(file))
		return;

	const response = await fetch(file);

	if (!response.ok)
		throw new Error(`Failed to load JSON: ${response.status}`);

	_jsonCache.set(file, await response.json());
}

function findInJson(file, key, value)
{
	const data = _jsonCache.get(file);

	if (data === undefined)
		return undefined;

	return data.find(item => item[key] === value);
}