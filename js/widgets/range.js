import { UIWidget } from './base.js';
import { sprintfNamed, escapeHtml } from '../format.js';
import { ObjGroup, applyGroupState } from '../client/obj-group.js';

export class RangeWidget extends UIWidget
{
	static type = 'range';
	static multiObj = true;

	#editing = false;

	Render()
	{
		const c = this.config;
		this.min = Number(c.min ?? 0);
		this.max = Number(c.max ?? 100);
		this.step = Number(c.step ?? 1);
		this.scale = c.scale || 1;

		this.element.innerHTML =
		`<div class="ui_root ui-range">
			<div class="ui_title ui-range_title">${escapeHtml(c.name)}</div>
			<div class="ui-range_content">
				<input type="range" min="${this.min}" max="${this.max}" step="${this.step}" value="${this.min}">
				<div class="ui-range_value">-</div>
			</div>
		</div>`;

		this.refs.input = this.element.querySelector('.ui-range_content input');
		this.refs.value = this.element.querySelector('.ui-range_value');

		const input = this.refs.input;
		input.addEventListener('pointerdown', () => { this.#editing = true; });
		input.addEventListener('input', () =>
		{
			this.#editing = true;
			this.refs.value.innerHTML = this.#format(Number(input.value)); // только предпросмотр
		});
		input.addEventListener('change', () => this.#commit(Number(input.value)));

		// Отпустили, не изменив значение ('change' не придёт) — вернуть фактическое состояние.
		const endEdit = () => setTimeout(() =>
		{
			if(!this.#editing) return;
			this.#editing = false;
			this.#show(this.group.state);
		}, 0);
		input.addEventListener('pointerup', endEdit);
		input.addEventListener('pointercancel', endEdit);
		input.addEventListener('blur', endEdit);

		this.group = new ObjGroup(this.ids,
		{
			type: c.type || 'uint8',
			timeout: c.timeout,
			onChange: state => this.#show(state),
		});

		for (const id of this.ids) this.Subscribe(id);
		this.#show(this.group.state);
	}

	Destroy()
	{
		this.group?.destroy();
		super.Destroy();
	}

	Update(rx_data, id)
	{
		this.group.handle(id, rx_data);
	}

	#commit(value)
	{
		this.#editing = false;
		if(this.config.readonly) return;

		const isFloat = (this.config.type || '').startsWith('float');
		const raw = isFloat ? value * this.scale : Math.round(value * this.scale);
		if(!this.group.set(raw)) this.#show(this.group.state); // не ушло — вернуть факт
	}

	#show(state)
	{
		const input = this.refs.input;
		input.disabled = !!this.config.readonly || !!state.pending;
		applyGroupState(this.element, state);

		if(this.#editing) return; // не двигаем ползунок из-под пальца

		if(state.pending)
		{
			// Ждём ответ: ползунок остаётся там, где его отпустили.
			const target = state.pending.target / this.scale;
			input.value = target;
			this.refs.value.innerHTML = '⏳ ' + this.#format(target);
			return;
		}

		if(state.value !== null)
		{
			const value = state.value / this.scale;
			input.value = value;
			this.refs.value.innerHTML = this.#format(value);
		}
		else if(state.status === 'mixed')
		{
			// Значения разные: показываем диапазон, ползунок не двигаем.
			const values = [...state.counts.keys()].map(v => v / this.scale);
			this.refs.value.innerHTML =
				this.#format(Math.min(...values)) + ' … ' + this.#format(Math.max(...values));
		}
		else
		{
			this.refs.value.textContent = '-';
		}
	}

	#format(value)
	{
		const format = this.config.format || '${value}';
		return sprintfNamed(format, { value, value_raw: Math.round(value * this.scale) });
	}
}
