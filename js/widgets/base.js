import { readNumberFromArray } from '../parse.js';
import { subscribe } from '../client/subscriptions.js';

export class UIWidget
{
	static type = 'base'; // переопределяется в наследниках
	static multiObj = false; // true — виджет умеет работать с несколькими obj (obj="0x01,0x02")

	#unsubs = [];

	constructor(element, config, ids)
	{
		this.element = element;
		this.config = config;
		this.ids = Array.isArray(ids) ? ids : [ids]; // все obj виджета
		this.id = this.ids[0];                        // основной obj
		this.refs = {}; // кэш под-элементов после рендера, чтобы не делать querySelector повторно
		this.timer_type = {0x61:'normal', 0x62:'warning', 0x63:'critical'};		// А если это event? Переименовать тип и логику на "доступный тип с данными"
	}

	// Строит внутренний HTML, сохраняет ссылки в this.refs и явно вызывает Subscribe().
	Render()
	{
		throw new Error('Render() not implemented');
	}

	// Освобождает всё, на что виджет подписался через Subscribe().
	// Наследник переопределяет, только если у него есть свои ресурсы
	// (графики, таймеры), и обязательно вызывает super.Destroy().
	Destroy()
	{
		this.UnsubscribeAll();
	}

	// Применяет пришедшие данные к отрендеренным элементам. Переопределяется в наследнике.
	// data — массив байт пакета, id — от какого id он пришёл (важно, если подписок несколько).
	Update(data, id)
	{
		throw new Error('Update() not implemented');
	}

	/**
	 * Подписка на пакеты по id. Вызывать явно (обычно в Render()).
	 * id по умолчанию — собственный id виджета, обработчик — Update().
	 * Можно подписаться на несколько id и/или со своим обработчиком:
	 *   this.Subscribe();                                  // свой id → Update
	 *   this.Subscribe(0x0200, data => this.onAux(data));  // чужой id → свой обработчик
	 * Отписка от всего — автоматически в Destroy().
	 */
	Subscribe(id = this.id, handler = (data, pid) => this.Update(data, pid))
	{
		const off = subscribe(id, handler);
		this.#unsubs.push(off);
		return off; // можно отписаться и раньше, вручную
	}

	UnsubscribeAll()
	{
		for (const off of this.#unsubs) off();
		this.#unsubs = [];
	}

	/**
	 * Уровень тревоги из fId (0x61/0x62/0x63, см. timer_type) → класс на <ui-element>:
	 * lvl-normal / lvl-warning / lvl-critical. Остальные fId (например, 0x65) уровень не меняют.
	 */
	ShowLevel(fId)
	{
		const level = this.timer_type[fId];
		if(!level) return;
		for(const l of Object.values(this.timer_type))
			this.element.classList.toggle('lvl-' + l, l === level);
	}

	/**
	 * Прочитать число из пакета с учётом config.type / config.scale.
	 * Если данных не хватает — { value: null, value_raw: null }.
	 */
	ReadValue(data, offset = 1, type = this.config.type)
	{
		const value_raw = readNumberFromArray(data, offset, type);
		if(value_raw === null) return { value: null, value_raw: null };
		const scale = this.config.scale || 1;
		return { value: value_raw / scale, value_raw };
	}
}
