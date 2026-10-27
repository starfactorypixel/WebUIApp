# Скрипты ESP32: браузер ⇄ server.js ⇄ ESP

**Протокол обмена с ESP** (сообщение `Script`, 0x1B: команды, коды ошибок, размеры кусков, последовательности, пример) — в `PROTOCOL_SERVER_ESP.md`, раздел 9. Здесь — как он реализован в этом проекте: команды браузера, сервер, сторона ESP и правки библиотеки DrakeScript.

Коротко о смысле: источник правды — скрипты, загруженные в память ESP (то, что исполняется). Запись и удаление меняют только флеш-память; пока не выполнена перезагрузка скриптов (RELOAD), исполняются старые, а LIST возвращает признак `reload_needed`, по которому страница показывает подсказку.

## Браузер ⇄ server.js (WebSocket)

| Запрос | Ответ (`data`) |
|---|---|
| `ScriptLoad {id}` | `ScriptLoadResp {id, data: [байты]}` |
| `ScriptSave {id, data}` | `ScriptSaveResp {id}` |
| `ScriptDelete {id}` | `ScriptDeleteResp {id}` |
| `ScriptReload {}` | `ScriptReloadResp {count}` |
| `ScriptList {}` | `ScriptListResp {scripts: [{id, length, flags}], reload_needed}` |
| `ScriptEnable {id, on}` | `ScriptEnableResp {id, flags}` |

При ошибке в ответе есть `error` (текст). Во время чтения и записи сервер шлёт `ScriptProgress {done, total}`. Ответы и прогресс уходят только клиенту, который спросил. Одновременно — одна операция: вторая сразу получает `error: "занято: идёт …"`.

## Реализация

- **Сервер:** `js/server/scripts.js` (класс `Scripts`), маршрутизация в `js/server.js` (`ScriptOp`). Ожидание ответа на шаг — 1,1 с, на RELOAD — 5,5 с (`RELOAD_TIMEOUT_MS`: он читает все скрипты из флеш-памяти).
- **ESP:** `esp/ScriptProto.h`, подключается в конце `ScriptLogic.h`. `ScriptProto::Rx(msg, len, tx, tx_len)`: одно сообщение (`msg[0]` — fId, `len` — от драйвера L3), ответ в `tx` (`MSG_MAX` байт). Каждое сообщение — packed-структура целиком (с fid, cmd, status), поле данных последнее: запрос — каст `msg` к структуре, ответ — заполненный объект в `tx` через `Answer()` (READ и LIST заполняются прямо в `tx`: у них данные переменной длины). Все размеры — через `sizeof` этих структур. Один `switch` по `cmd`. Скрипты — из PSRAM (`ScriptMapObj`); включение и отключение — через библиотеку, список отключённых (битовый массив) `ScriptProto` помнит, чтобы вернуть его после RELOAD (`ReInit` включает всё). CRC — `esp_crc32_le(0, …)`.

  **Проверено на ПК** при `DATA_MAX` 64, 128 и 300: флеш-память — массив, функции флеш-памяти и `LoadFromSPIFlash` — из `ScriptLogic.h` без изменений, карта скриптов — настоящий `DrakeScriptMappingESP32PSRAM` из библиотеки с двумя правками ниже. Тот же набор, что для сервера, несколько сообщений в одном пакете, запись и удаление с RELOAD, ENABLE/RELOAD (исполнитель после отключения скрипт не получает, после RELOAD отключённый остаётся отключённым, READ отключённого работает), браузерный тест страницы скриптов. На железе не проверялось.

**Правки в библиотеке DrakeScript** (`DrakeScriptMappingInterface.hpp` и все реализации `GetScriptPtr`):
```cpp
bool IsLoaded(uint16_t id) { return _scripts_map[id].length > 0; }

// always = true — отдать и отключённый скрипт
virtual bool GetScriptPtr(uint16_t id, uint8_t *&array_ptr, uint16_t &length, bool always = false) = 0;
//   в реализации: if(obj.mode != MODE_ENABLED && !always) return false;
```
Параметр `always` нужно добавить и в `DrakeScriptMappingESP32PSRAM`, и в `DrakeScriptMappingRaw`: иначе `override` не совпадёт и не соберётся.

**Что проверить или доделать на ESP:**
1. `esp_crc32_le(0, "123456789", 9)` должен дать `0xCBF43926` (стандартный CRC-32, как на сервере). На ПК вместо ROM-функции — её точная копия; если на ESP получится другое, запись будет падать с «контрольная сумма не совпала».
2. `Commit()` после ответа: если менеджер L3 сам вызывает `Commit()` после разбора пакета — убрать, ответы будут упакованы вместе.
