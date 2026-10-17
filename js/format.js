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
