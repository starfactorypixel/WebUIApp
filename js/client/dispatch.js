// Жизненный цикл виджетов: создание по <ui-element> и уничтожение.
// Разметка: <ui-element type="value" obj="0x0110" config='{...}'>
//           <ui-element type="button" obj="0x0164,0x0165,0x0166" ...>  — группа (если виджет умеет)
// Подписками и маршрутизацией пакетов занимается client/subscriptions.js.

import { getWidgetClass } from './registry.js';

const widgets = new WeakMap(); // <ui-element> -> UIWidget

/**
 * Создать виджеты для всех <ui-element> внутри root.
 * Уже созданные пропускаются, поэтому повторный вызов безопасен.
 * @param {ParentNode} root
 * @param {(el: Element) => boolean} [filter]  какие элементы брать
 */
export function initWidgets(root = document, filter = null)
{
	let count = 0;
	for (const el of root.querySelectorAll('ui-element'))
	{
		if(widgets.has(el)) continue;
		if(filter && !filter(el)) continue;

		const type = el.getAttribute('type');
		const Cls = getWidgetClass(type);
		if(!Cls)
		{
			console.warn('Неизвестный тип виджета:', type, el);
			continue;
		}

		// obj — адрес объекта данных (hex) или список через запятую
		const objAttr = el.getAttribute('obj') ?? '';
		let ids = objAttr.split(',').map(s => parseInt(s.trim(), 16));
		if(ids.length === 0 || ids.some(Number.isNaN))
		{
			console.warn('Некорректный атрибут obj виджета:', objAttr, el);
			continue;
		}
		ids = [...new Set(ids)];
		if(ids.length > 1 && !Cls.multiObj)
		{
			console.warn(`Виджет "${type}" не поддерживает несколько obj, используется первый:`, objAttr, el);
			ids = [ids[0]];
		}

		let config;
		try
		{
			config = JSON.parse(el.getAttribute('config') || '{}');
		}
		catch (err)
		{
			console.error('Некорректный JSON в config:', el, err);
			continue;
		}

		const widget = new Cls(el, config, ids);
		try
		{
			widget.Render();
		}
		catch (err)
		{
			console.error('Ошибка Render():', el, err);
			try { widget.Destroy(); } catch { /* уже неважно */ }
			continue;
		}

		widgets.set(el, widget);
		count++;
	}

	console.log(`Инициализировано виджетов: ${count}`);
}

/** Уничтожить виджеты внутри root (только те, что были созданы). */
export function deinitWidgets(root = document)
{
	let count = 0;
	for (const el of root.querySelectorAll('ui-element'))
	{
		const widget = widgets.get(el);
		if(!widget) continue;
		widgets.delete(el);

		try
		{
			widget.Destroy();
		}
		catch (err)
		{
			console.error('Ошибка Destroy():', el, err);
		}
		count++;
	}

	console.log(`Деинициализировано виджетов: ${count}`);
}

/** Получить экземпляр виджета по его <ui-element>. */
export function getWidget(el)
{
	return widgets.get(el);
}
