import { parseNumber } from '../parse.js';

export class UIWidget
{
	static type = 'base'; // переопределяется в наследниках

	constructor(element, config, id)
	{
		this.element = element;
		this.config = config;
		this.id = id;
		this.refs = {}; // кэш под-элементов после рендера, чтобы не делать querySelector повторно
		this.timer_type = {0x61:'normal', 0x62:'warning', 0x63:'critical'};
		//this.Render();
	}

	// Строит внутренний HTML, сохраняет ссылки в this.refs. Переопределяется в наследнике.
	Render()
	{
		throw new Error('render() not implemented');
	}

	// Разбирает бинарные данные согласно config.type/scale. Можно переопределить (см. stream).
	Parse(view, offset = 0)
	{
		return parseNumber(view, offset, this.config.type, this.config.scale);
	}

	// Применяет значение к уже отрендеренным элементам. Переопределяется в наследнике.
	Update(value)
	{
		throw new Error('update() not implemented');
	}
}
