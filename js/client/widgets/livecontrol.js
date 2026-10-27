import { UIWidget } from './base.js';
import { writeNumberToArray, typeSize } from '../../utils/parse.js';
import { sprintfNamed, escapeHtml } from '../../utils/format.js';

// Ползунок «живого» управления (газ, руль): значение действует, только пока ползунок держат.
//
//   Отпущен     — ничего не отправляется, ползунок стоит в default.
//   Держим      — сразу и затем каждые interval мс уходит текущее значение во все obj.
//   Отпустили   — ползунок возвращается в default, уходит один пакет с default.
//
// Все obj — одним WS-сообщением, сервер кладёт их в один пакет L3. Ответов нет и не ждём (отправка «в пустоту»),
// подписки на obj нет.
//
// Пакет в каждый obj (mode):
//   "set"      — [0x01, value]            (SET, как у range)
//   "realtime" — [0x0A, counter, value]   counter — uint8 своего obj, +1 на каждый пакет (после 255 — 0).
//                                         Устройство проверяет его только внутри непрерывного потока;
//                                         после паузы > 3 × interval начинать можно с любого значения
// value — по config.type, little-endian, raw = значение ползунка × scale.
//
// «Отпустили» — это и отпускание мыши/пальца (даже за пределами ползунка), и отпускание клавиши,
// и потеря фокуса, и скрытие страницы, и закрытие вкладки с виджетом: значение не должно «залипнуть».
// Браузеры по-разному фиксируют значение ползунка после отпускания (некоторые — уже после pointerup),
// поэтому любое изменение значения, пока ползунок не держат, сразу возвращается в default.

const FID_SET = 0x01;
const FID_REALTIME = 0x0A;
const DEFAULT_INTERVAL_MS = 100;

const counters = new Map();	// obj → следующий counter (realtime); один на obj для всех виджетов страницы

export class LiveControlWidget extends UIWidget
{
	static type = 'livecontrol';
	static multiObj = true;

	Render()
	{
		const c = this.config;
		this.min = c.min ?? 0;
		this.max = c.max ?? 100;
		this.step = c.step ?? 1;
		this.scale = c.scale || 1;
		this.interval = c.interval ?? DEFAULT_INTERVAL_MS;
		this.realtime = c.mode === 'realtime';
		this.isFloat = (c.type || '').startsWith('float');

		typeSize(c.type);	// неизвестный type — ошибка сразу, а не при первом движении
		if(c.mode !== undefined && c.mode !== 'set' && c.mode !== 'realtime')
			console.warn(`[Виджеты] livecontrol: mode "${c.mode}" — допустимо "set" или "realtime", используется "set"`, this.element);
		if(c.default === undefined)
			console.warn(`[Виджеты] livecontrol: не задан default, используется min = ${this.min}`, this.element);
		this.default = Math.min(this.max, Math.max(this.min, c.default ?? this.min));

		this.timer = null;		// пока держим — таймер отправки

		this.element.innerHTML =
		`<div class="ui_root ui-livecontrol">
			<div class="ui_title ui-livecontrol_title">${escapeHtml(c.name)}</div>
			<div class="ui-livecontrol_content">
				<input type="range" min="${this.min}" max="${this.max}" step="${this.step}" value="${this.default}">
				<div class="ui-livecontrol_value"></div>
			</div>
		</div>`;

		this.refs.input = this.element.querySelector('.ui-livecontrol_content input');
		this.refs.value = this.element.querySelector('.ui-livecontrol_value');
		this.refs.input.disabled = !!c.readonly;

		// Нажали — начинаем; отпустили где угодно — заканчиваем
		this.onRelease = () => this.Release();
		this.refs.input.addEventListener('pointerdown', () => this.Hold());
		window.addEventListener('pointerup', this.onRelease);
		window.addEventListener('pointercancel', this.onRelease);

		// Клавиатура: держим клавишу — держим ползунок
		this.refs.input.addEventListener('keydown', (e) => { if(!e.repeat) this.Hold(); });
		this.refs.input.addEventListener('keyup', this.onRelease);
		this.refs.input.addEventListener('blur', this.onRelease);

		// Страница скрыта (свернули, переключили вкладку браузера) — отпускаем
		this.onVisibility = () => { if(document.visibilityState !== 'visible') this.Release(); };
		document.addEventListener('visibilitychange', this.onVisibility);

		// Значение меняется, только пока держим; иначе — назад в default
		const onChange = () => { if(this.timer === null) this.SetDefault(); else this.ShowValue(); };
		this.refs.input.addEventListener('input', onChange);
		this.refs.input.addEventListener('change', onChange);
		this.ShowValue();
	}

	Destroy()
	{
		this.Release();
		window.removeEventListener('pointerup', this.onRelease);
		window.removeEventListener('pointercancel', this.onRelease);
		document.removeEventListener('visibilitychange', this.onVisibility);
		super.Destroy();
	}

	Update() {}	// подписки нет — пакетов не бывает

	Hold()
	{
		if(this.timer !== null || this.refs.input.disabled) return;

		this.element.classList.add('is-active');
		this.timer = setInterval(() => this.Send(this.Value()), this.interval);
		setTimeout(() => { if(this.timer !== null) this.Send(this.Value()); });	// первый — сразу, но уже с новым значением: ползунок встаёт под палец после pointerdown
	}

	Release()
	{
		if(this.timer === null) return;

		clearInterval(this.timer);
		this.timer = null;
		this.element.classList.remove('is-active');

		this.SetDefault();
		this.Send(this.Value());
		setTimeout(() => { if(this.timer === null) this.SetDefault(); });	// браузер мог дописать значение после отпускания
	}

	// Ползунок — в default (только вид, без отправки)
	SetDefault()
	{
		this.refs.input.value = this.default;
		this.ShowValue();
	}

	// Текущее значение ползунка в raw (× scale)
	Value()
	{
		const raw = Number(this.refs.input.value) * this.scale;
		return this.isFloat ? raw : Math.round(raw);
	}

	// Во все obj одним WS-сообщением. Нет связи — пакет просто не уходит
	Send(raw)
	{
		const value = writeNumberToArray(raw, this.config.type);
		const msgs = this.ids.map(id =>
		{
			if(!this.realtime) return { id, bytes: [FID_SET, ...value] };

			const counter = counters.get(id) ?? 0;
			counters.set(id, (counter + 1) & 0xFF);
			return { id, bytes: [FID_REALTIME, counter, ...value] };
		});

		this.SendCanMsgBatch(msgs);
	}

	ShowValue()
	{
		const value = Number(this.refs.input.value);
		this.refs.value.innerHTML = sprintfNamed(this.config.format || '${value}', { value, value_raw: Math.round(value * this.scale) });
	}
}
