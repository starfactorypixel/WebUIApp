/** Экранирование текста для вставки в innerHTML. */
export function escapeHtml(str)
{
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Подстановка ${name} / ${name:%fmt} из data.
 * Поддерживается printf-подобный формат: %[+ ][0][width][.prec](d|f|s|x|X)
 * Отсутствующее (null/undefined) значение подставляется как пустая строка.
 */
export function sprintfNamed(str, data)
{
	return str.replace(/\$\{(\w+)(?::([^}]+))?\}/g, (_, key, format) =>
	{
		let value = data[key];
		if(value == null) return '';

		if(!format) return String(value);

		const match = format.match(/%([ +]?)(0?)([0-9]*)(?:\.([0-9]+))?([dfsxX])/);
		if(!match) return String(value);

		const [, signFlag, zeroPad, width, precision, type] = match;

		let negative = false;
		switch(type)
		{
			case 'd': // integer
				value = Math.trunc(Number(value));
				negative = value < 0;
				value = String(Math.abs(value));
				break;

			case 'f': // float
				value = Number(value);
				negative = value < 0;
				value = Math.abs(value).toFixed(precision ? Number(precision) : 0);
				break;

			case 'x': // hex lower
				value = Math.trunc(Number(value)).toString(16);
				break;

			case 'X': // hex upper
				value = Math.trunc(Number(value)).toString(16).toUpperCase();
				break;

			case 's':
				value = String(value);
				break;
		}

		// ---- Знак (отдельно от числа, чтобы нули вставали после него: -05, +0012.3) ----
		let sign = '';
		if(negative) sign = '-';
		else if(type === 'd' || type === 'f')
		{
			if(signFlag === '+') sign = '+';
			else if(signFlag === ' ') sign = ' ';
		}

		// ---- Ширина ----
		const w = width ? Number(width) : 0;
		if(zeroPad && type !== 's')
			value = sign + value.padStart(Math.max(0, w - sign.length), '0');
		else
			value = (sign + value).padStart(w, ' ');

		return value;
	});
}

/** Число → "0x00AB" (pad — минимум hex-цифр). */
export function Int2Hex(num, pad)
{
	return '0x' + num.toString(16).toUpperCase().padStart(pad, '0');
}

/** Миллисекунды → "ЧЧ:ММ:СС.ммм" (часы не ограничены 24). */
export function FastFormatMs(ms)
{
	const hr = Math.floor(ms / 3600000);
	const min = Math.floor((ms % 3600000) / 60000);
	const sec = Math.floor((ms % 60000) / 1000);
	const msec = ms % 1000;

	const p = (n, w) => String(n).padStart(w, '0');
	return p(hr, 2) + ':' + p(min, 2) + ':' + p(sec, 2) + '.' + p(msec, 3);
}
