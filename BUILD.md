# Сборка под Freelens 2.x

Эта ветка добавляет к общей базе ([`main`](../../tree/main)) всё, что делает из неё пакет
для Freelens 2.x, и ничего больше: манифест, `tsconfig.json`, `vite.config.mjs` и дымовую
проверку. Код расширения живёт в базе и про версию хоста не знает.

```sh
npm install
npm run build        # -> dist/renderer.js + dist/style.css
npm test             # vitest: маски, правила, переменные, ссылки, терминалы
npm run type:check   # типы против API расширений Freelens 2.x
npm run smoke        # сборка + загрузка бандла с подставленным контрактом хоста
```

## Что даёт хост

Расширение собирается под контракт расширений Freelens 2: ESM, React 19 и mobx приходят от
хоста через `globalThis.FreelensExtensionApi`, в бандл они не попадают (`vite.config.mjs`).
Своя копия React дала бы «invalid hook call», своя копия mobx — молчаливую потерю
реактивности; обе поломки видны только в рантайме.

Стили хост подхватывает сам: рядом с `dist/renderer.js` он ищет `dist/style.css`, поэтому
CSS-модули собираются в отдельный файл и ничего инжектить не нужно.

## Типы

Типы `@freelensapp/extensions` 2.x на npm не опубликованы, поэтому `tsconfig.json` берёт их из
соседнего чекаута форка: `../freelens/packages/extensions/dist/extension-api.d.ts`. Сборка и
тесты от этого не зависят — только `npm run type:check`.

## Колонки в списке

Точку расширения `kubeObjectListLayoutColumns` даёт патч форка Freelens, в upstream её нет.
На сборке без патча поле класса молча игнорируется: пункты меню и настройки работают, колонок
в строках списка не появляется.
