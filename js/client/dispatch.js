import { getWidgetClass } from './registry.js';
import { SendSubscribe } from '../ws.js';

// id -> [UIWidget, ...] (может быть несколько виджетов с одним id)
const widgetsById = new Map();

export function initWidgets(root = document) {
  root.querySelectorAll('ui-element').forEach(el => {
    const type = el.getAttribute('type');
    const id = parseInt(el.getAttribute('id'), 16);
    const config = JSON.parse(el.getAttribute('config'));

    const Cls = getWidgetClass(type);
    if (!Cls) {
      console.warn('Unknown widget type:', type);
      return;
    }

    const widget = new Cls(el, config, id);
	widget.Render();

    if (!widgetsById.has(id)) widgetsById.set(id, []);
    widgetsById.get(id).push(widget);
  });

  SendSubscribe();

  console.log(`Инициализировано ${document.querySelectorAll('ui-element').length} виджетов`);
}

// Универсальный приём: raw может быть ArrayBuffer, Uint8Array или обычный массив байт из JSON
export function onPacket(id, raw) {
  const widgets = widgetsById.get(id);
  if (!widgets) return; // пакет для несуществующего элемента — игнорируем

  const view = toDataView(raw);
  for (const w of widgets) {
    const value = w.Parse(view);
    w.Update(raw);	// value
  }
}

function toDataView(raw) {
  if (raw instanceof DataView) return raw;
  if (raw instanceof ArrayBuffer) return new DataView(raw);
  if (raw instanceof Uint8Array) return new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (Array.isArray(raw)) return new DataView(new Uint8Array(raw).buffer);
  throw new Error('Unsupported packet data format: ' + typeof raw);
}
