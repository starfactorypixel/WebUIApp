
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
