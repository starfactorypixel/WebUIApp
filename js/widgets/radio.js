import { UIWidget } from './base.js';
import { escapeHtml } from '../format.js';
import { ObjGroup, applyGroupState } from '../client/obj-group.js';

let groupCounter = 0;

export class RadioWidget extends UIWidget
{
	static type = 'radio';
	static multiObj = true;

	Render()
	{
		this.element.innerHTML =
		`<div class="ui_root ui-radio">
			<div class="ui_title ui-radio_title">${escapeHtml(this.config.name)}</div>
			<div class="ui-radio_content"></div>
		</div>`;

		this.refs.container = this.element.querySelector('.ui-radio_content');
		this.refs.options = new Map(); // value_raw -> { radio, label, count }

		this.group = new ObjGroup(this.ids,
		{
			type: this.config.type || 'uint8',
			timeout: this.config.timeout,
			onChange: state => this.#show(state),
		});

		this.buildOptions();

		for (const id of this.ids) this.Subscribe(id);
		this.#show(this.group.state);
	}

	Destroy()
	{
		this.group?.destroy();
		super.Destroy();
	}

	buildOptions()
	{
		// Уникальное имя группы: два радио-виджета с одним obj не должны «делить» выбор.
		const groupName = `ui-radio-${this.id}-${++groupCounter}`;

		this.config.radios.split(',').forEach(item =>
		{
			const [rawValue, name] = item.split(':');
			const value_raw = Number(rawValue);

			const radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = groupName;
			radio.value = value_raw;
			radio.addEventListener('click', (e) =>
			{
				e.preventDefault(); // отметку ставит только подтверждённое состояние
				if(this.config.readonly) return;
				this.group.set(value_raw);
			});

			const count = document.createElement('span');
			count.className = 'ui-radio_count';

			const label = document.createElement('label');
			label.append(radio, document.createTextNode(name), count);

			this.refs.container.appendChild(label);
			this.refs.options.set(value_raw, { radio, label, count });
		});
	}

	Update(rx_data, id)
	{
		this.group.handle(id, rx_data);
	}

	#show(state)
	{
		const showCounts = state.total > 1 && state.status !== 'ok';
		const target = state.pending ? state.pending.target : null;

		for (const [value_raw, o] of this.refs.options)
		{
			// В 'mixed' не отмечаем ничего; в 'partial' отмечаем то, что сообщили известные obj.
			o.radio.checked = state.value !== null && state.value === value_raw;
			o.radio.disabled = !!this.config.readonly || !!state.pending;
			o.label.classList.toggle('is-target', target === value_raw);

			const n = state.counts.get(value_raw) ?? 0;
			o.count.textContent = showCounts && n > 0 ? ` ${n}/${state.total}` : '';
		}

		applyGroupState(this.element, state);
	}
}
