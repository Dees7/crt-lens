// Сборка расширения под Freelens 1.x.
//
// Три вещи отличают эту сборку от ветки `v2`, и все три — про то, как хост
// грузит расширение и что он ему даёт.
//
// 1. Формат — CommonJS: загрузчик расширений 1.x зовёт обычный `require()` на
//    файл из поля `renderer` манифеста. По той же причине в `package.json` нет
//    `"type": "module"` — иначе Node посчитал бы `dist/renderer.js` модулем и
//    уронил бы require.
//
// 2. Глобалы другие. Рендерер 1.x собран с `libraryTarget: "global"`, поэтому
//    его экспорты лежат прямо на глобальном объекте: API в `LensExtensions`, а
//    рядом с ним `React`, `ReactJsxRuntime`, `Mobx`, `MobxReact` (см.
//    `freelens/src/renderer/index.ts`). В 2.x всё это переехало внутрь
//    `globalThis.FreelensExtensionApi`. Своя копия React означала бы «invalid
//    hook call», своя копия mobx — молчаливую потерю реактивности, поэтому и
//    здесь в бандл не попадает ни то, ни другое.
//
// 3. Стили расширение инжектит само. Соседний с бандлом `style.css` подхватывает
//    только загрузчик 2.x — в 1.x расширения про CSS не знает никто, и без
//    инжекта диалоги и колонки остались бы без раскладки.

import { defineConfig } from "vite";

const hostApi = `const api = globalThis.LensExtensions;
export const Common = api.Common;
export const Main = api.Main;
export const Renderer = api.Renderer;
`;

const hostProvidedModules = {
  "@freelensapp/extensions": hostApi,

  react: `const React = globalThis.React;
export default React;
export const { createElement, Fragment, useEffect, useMemo, useRef, useState } = React;
`,

  "react/jsx-runtime": `const jsxRuntime = globalThis.ReactJsxRuntime;
export const { Fragment, jsx, jsxs } = jsxRuntime;
`,

  mobx: `const mobx = globalThis.Mobx;
export const { computed, observable, runInAction } = mobx;
`,

  "mobx-react": `const mobxReact = globalThis.MobxReact;
export const { observer } = mobxReact;
`,
};

const virtualPrefix = "\0freelens-host:";

/** @type {import("vite").Plugin} */
const hostProvidedModulesPlugin = {
  name: "crt-lens-host-provided-modules",
  // До собственного резолвера Vite: иначе react и mobx уедут в бандл из node_modules.
  enforce: "pre",

  resolveId(source) {
    return Object.hasOwn(hostProvidedModules, source) ? `${virtualPrefix}${source}` : null;
  },

  load(id) {
    return id.startsWith(virtualPrefix) ? hostProvidedModules[id.slice(virtualPrefix.length)] : null;
  },
};

/**
 * `import.meta.url` — из файла бандла, а не из адреса страницы.
 *
 * Общий код ищет по нему каталог расширения (`extensionDir` в `src/config.ts`),
 * чтобы дотянуться до примеров конфига рядом с `dist/`. Свой шим для CJS у
 * Rollup есть, но он рассчитан на браузер: раз `document` определён — а в
 * рендерере Electron он определён, — путь берётся из `document.currentScript`
 * или из `document.baseURI`, то есть из адреса страницы приложения. Бандл
 * расширения при этом грузится через `require()`, `currentScript` там null, и
 * `extensionDir()` вернул бы каталог самого Freelens.
 *
 * `__filename` в CommonJS — ровно то, что нужно, и правки в общем коде не
 * требует: подменяем метаданные на этапе сборки.
 */
/** @type {import("vite").Plugin} */
const cjsImportMetaPlugin = {
  name: "crt-lens-cjs-import-meta",

  resolveImportMeta(property) {
    return property === "url" ? `require("url").pathToFileURL(__filename).href` : null;
  },
};

/**
 * CSS-модули — в сам бандл, отдельным `style.css` их никто не загрузит.
 *
 * Код инжекта вставляется одной строкой сразу за директивой `'use strict'`:
 * перед ней нельзя (директива перестанет быть директивой и модуль потеряет
 * strict mode), а одна строка не сдвигает нумерацию и оставляет sourcemap
 * годной.
 */
/** @type {import("vite").Plugin} */
const inlineCssPlugin = {
  name: "crt-lens-inline-css",
  // После собственных build-плагинов Vite: CSS складывает в бандл `vite:css-post`,
  // и без `post` наш хук успевает отработать раньше, чем там появится ассет.
  enforce: "post",

  generateBundle(options, bundle) {
    const cssFiles = Object.keys(bundle).filter((name) => name.endsWith(".css"));
    const css = cssFiles
      .map((name) => {
        const asset = bundle[name];
        const source = asset.source;

        delete bundle[name];

        return typeof source === "string" ? source : new TextDecoder().decode(source);
      })
      .join("");

    if (css === "") return;

    const chunk = Object.values(bundle).find((item) => item.type === "chunk" && item.isEntry);

    if (!chunk) return;

    // повторный require бандла не выполняется (модуль в кеше), но расширение
    // могут выключить и включить снова — тогда тег уже висит в head
    const inject =
      `(function(){var d=typeof document!=="undefined"&&document;` +
      `if(!d||d.querySelector("style[data-crt-lens]"))return;` +
      `var s=d.createElement("style");s.setAttribute("data-crt-lens","");` +
      `s.textContent=${JSON.stringify(css)};d.head.appendChild(s);})();`;
    const directive = /^(['"])use strict\1;/.exec(chunk.code);

    chunk.code = directive
      ? chunk.code.slice(0, directive[0].length) + inject + chunk.code.slice(directive[0].length)
      : inject + chunk.code;
  },
};

// Расширение работает в рендерере с nodeIntegration, поэтому читает конфиг и
// запускает процессы напрямую. Эти модули должны остаться require'ами, а не
// попытками забандлить Node.
const nodeBuiltins = [
  "child_process",
  "fs",
  "os",
  "path",
  "url",
  "node:child_process",
  "node:fs",
  "node:os",
  "node:path",
  "node:url",
];

export default defineConfig({
  plugins: [hostProvidedModulesPlugin, cjsImportMetaPlugin, inlineCssPlugin],
  build: {
    // 1.10.3 живёт на electron 41, но ветка обслуживает всю линейку 1.x,
    // где Chromium заметно старше; es2020 переживут они все
    target: "es2020",
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    // один css-файл на бандл: инжектить два асинхронных куска нечем
    cssCodeSplit: false,
    lib: {
      entry: "src/renderer.tsx",
      formats: ["cjs"],
      fileName: () => "renderer.js",
    },
    rollupOptions: {
      external: nodeBuiltins,
      output: {
        // Загрузчик расширений берёт класс как `require(...).default`, а rollup
        // на единственном default-экспорте по умолчанию пишет
        // `module.exports = Класс` — и хост получил бы undefined. С `named`
        // экспорт остаётся на своём месте, в `exports.default`.
        exports: "named",
      },
    },
  },
});
