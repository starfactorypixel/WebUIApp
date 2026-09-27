const WidgetRegistry = new Map();

export function registerWidget(cls) {
  WidgetRegistry.set(cls.type, cls);
}

export function getWidgetClass(type) {
  return WidgetRegistry.get(type);
}
