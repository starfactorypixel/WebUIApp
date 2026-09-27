// Разбирает "%02d", "%2.1f" и подставляет значение по шаблону ${name} / ${name:%fmt}
export function formatTemplate(template, vars) {
  return template.replace(/\$\{(\w+)(?::(%[\d.]*[dfs]))?\}/g, (_, name, fmt) => {
    const v = vars[name];
    return fmt ? sprintf(fmt, v) : String(v);
  });
}

function sprintf(fmt, value) {
  const m = fmt.match(/^%(\d+)?(?:\.(\d+))?([dfs])$/);
  if (!m) return String(value);
  const [, width, prec, conv] = m;
  let str;
  if (conv === 'f') str = Number(value).toFixed(prec !== undefined ? +prec : 6);
  else if (conv === 'd') str = String(Math.trunc(value));
  else str = String(value);
  if (width) str = str.padStart(+width, '0');
  return str;
}

export function sprintfNamed(str, data) {
  return str.replace(/\$\{(\w+)(?::([^}]+))?\}/g, (_, key, format) => {
    let value = data[key];
    if (value == null) return "";

    if (!format) return value;

    // ---- printf-подобный разбор ----
    const match = format.match(/%([ +]?)(0?)([0-9]*)(?:\.([0-9]+))?([dfsxX])/);

    if (!match) return value;

    let [, signFlag, zeroPad, width, precision, type] = match;

    // ---- Тип ----
    switch (type) {
      case "d": // integer
        value = parseInt(value);
        break;

      case "f": // float
        value = Number(value).toFixed(precision ? Number(precision) : 0);
        break;

      case "x": // hex lower
        value = Number(value).toString(16);
        break;

      case "X": // hex upper
        value = Number(value).toString(16).toUpperCase();
        break;

      case "s":
        value = String(value);
        break;
    }

    // ---- Обработка знака ----
    if (signFlag === "+" && value >= 0) {
      value = "+" + value;
    } 
    else if (signFlag === " " && value >= 0) {
      value = " " + value;
    }

    // ---- Дополнение нулями ----
    if (width) {
      const padChar = zeroPad ? "0" : " ";
      value = value.toString().padStart(Number(width), padChar);
    }

    return value;
  });
}