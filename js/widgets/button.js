import { UIWidget } from './base.js';
import { sprintfNamed, escapeHtml } from '../format.js';
import { ObjGroup, applyGroupState } from '../client/obj-group.js';

export class ButtonWidget extends UIWidget
{
	static type = 'button';
	static multiObj = true;

	#txtMap = new Map();

	Render()
	{
		this.element.innerHTML =
		`<div class="ui_root ui-button">
			<div class="ui_title ui-button_title">${escapeHtml(this.config.name)}</div>
			<div class="ui-button_content">
				<button>-</button>
			</div>
		</div>`;

		this.refs.btn = this.element.querySelector('.ui-button_content button');
		this.refs.btn.addEventListener('click', () => this.#onClick());

		this.#txtMap.clear();
		if(this.config.txt)
		{
			for (const item of this.config.txt.split(','))
			{
				const [pValue, pName] = item.split(':');
				this.#txtMap.set(Number(pValue), pName);
			}
		}

		this.group = new ObjGroup(this.ids,
		{
			type: this.config.type || 'uint8',
			timeout: this.config.timeout,
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

	#onClick()
	{
		const cmd = this.config.cmd ?? (this.ids.length > 1 ? 'set' : 'toggle');
		switch(cmd)
		{
			case 'toggle': this.group.toggle(); break;
			case 'action': this.group.action(); break;
			case 'set':
			{
				const on = this.config.on ?? 255;
				const off = this.config.off ?? 0;
				const st = this.group.state;
				this.group.set(st.status === 'ok' && st.value !== off ? off : on);
				break;
			}
			default:
				console.warn('button: неизвестный cmd', cmd, this.element);
		}
	}

	#show(state)
	{
		const value_raw = state.value;
		const value = value_raw === null ? null : value_raw / (this.config.scale || 1);
		const data =
		{
			value,
			value_raw,
			icon1: this.#icon1(state),
			txt: this.#txt(state),
			count: `${state.known}/${state.total}`,
		};

		this.refs.btn.innerHTML = sprintfNamed(this.config.format, data);
		this.refs.btn.disabled = !!state.pending; // пока ждём ответ — повторно не жмём
		applyGroupState(this.element, state);
	}

	#icon1(state)
	{
		if(state.pending) return '⏳';
		if(state.status === 'mixed') return '⚠️';
		if(state.value === null) return '🟡';
		if(state.value === 0) return '🔴';
		return '🟢';
	}

	#txt(state)
	{
		if(state.status === 'mixed') return 'смеш.';
		const name = this.#txtMap.get(state.value);
		return name !== undefined ? name : '-';
	}
}
