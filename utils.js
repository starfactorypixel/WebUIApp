
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
