// Сборка расширения под Freelens 2.x.
//
// Главное здесь — не бандлить то, что даёт хост. Приложение кладёт свои
// синглтоны на `globalThis.FreelensExtensionApi`, и каждый такой модуль
// подменяется крошечным виртуальным модулем, который читает их оттуда.
// Иначе: своя копия React — «invalid hook call» на первом же хуке, своя копия
// mobx — молчаливая потеря реактивности (хост просто перестаёт реагировать на
// наши observable). Обе поломки видны только в рантайме.
//
// Именованные экспорты ниже перечислены руками намеренно: импорт, которого тут
// нет, роняет сборку с «is not exported by», а не утаскивает вторую копию
// пакета в бандл.
//
// Образец — packages/fixture-extension/vite.config.mjs в чекауте Freelens.

import { defineConfig } from "vite";

const HOST_GLOBAL = "globalThis.FreelensExtensionApi";

const hostProvidedModules = {
  "@freelensapp/extensions": `const api = ${HOST_GLOBAL};
export const Common = api.Common;
export const Main = api.Main;
export const Renderer = api.Renderer;
`,

  react: `const React = ${HOST_GLOBAL}.React;
export default React;
export const { createElement, Fragment, useEffect, useMemo, useRef, useState } = React;
`,

  "react/jsx-runtime": `const jsxRuntime = ${HOST_GLOBAL}.ReactJsxRuntime;
export const { Fragment, jsx, jsxs } = jsxRuntime;
`,

  mobx: `const mobx = ${HOST_GLOBAL}.Mobx;
export const { computed, observable, runInAction } = mobx;
`,

  "mobx-react": `const mobxReact = ${HOST_GLOBAL}.MobxReact;
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

// Расширение работает в рендерере с nodeIntegration, поэтому читает конфиг и
// запускает процессы напрямую. Эти модули должны остаться импортами, а не
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
  plugins: [hostProvidedModulesPlugin],
  build: {
    target: "esnext",
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: "src/renderer.tsx",
      formats: ["es"],
      fileName: () => "renderer.js",
      // Хост подхватывает соседний с энтрипоинтом style.css сам — свои <style>
      // городить не нужно (docs/v2-styling.md).
      cssFileName: "style",
    },
    rollupOptions: {
      external: nodeBuiltins,
    },
  },
});
