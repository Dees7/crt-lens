// Дымовая проверка собранного бандла: грузим dist/renderer.js так же, как это
// делает Freelens, — подложив на globalThis то, что публикует приложение.
//
// Ловит ровно то, что не ловят ни тесты (они работают с исходниками), ни
// типы: ошибку в шиме host-провайденных модулей, забытый экспорт, падение на
// вычислении полей класса расширения (конфиг, scopes, колонки).
//
// Заглушки здесь намеренно минимальные: настоящий контракт живёт в
// packages/core/src/renderer/extension-api-globals.ts форка Freelens, а нам
// нужно убедиться, что бандл читает его и не тащит своих копий.

import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const ReactJsxRuntime = require("react/jsx-runtime");
const Mobx = require("mobx");
// mobx-react тянет за собой react-dom, которого в зависимостях расширения нет
// (его даёт хост). Бандлу от него нужен только observer — его и подкладываем.
const MobxReact = { observer: (component) => component };

class LensExtension {}

const Renderer = {
  LensExtension,
  Catalog: { activeCluster: Mobx.computed(() => undefined) },
  Component: new Proxy({}, { get: () => () => null }),
  K8sApi: {},
};

globalThis.FreelensExtensionApi = {
  Common: {},
  Renderer,
  React,
  ReactJsxRuntime,
  Mobx,
  MobxReact,
};

const module_ = await import(new URL("../dist/renderer.js", import.meta.url).href);
const Extension = module_.default;

assert.ok(Extension.prototype instanceof LensExtension, "энтрипоинт должен наследовать LensExtension");

const extension = new Extension();

assert.ok(Array.isArray(extension.kubeObjectMenuItems), "kubeObjectMenuItems должен быть списком");
assert.ok(extension.kubeObjectMenuItems.length > 0, "не зарегистрировалось ни одного kind");
assert.ok(Array.isArray(extension.kubeObjectListLayoutColumns), "kubeObjectListLayoutColumns должен быть списком");
assert.strictEqual(extension.appPreferences.length, 1, "настройки должны регистрироваться");

console.log(
  `дым: ok — kind'ов ${extension.kubeObjectMenuItems.length}, ` +
    `колонок ${extension.kubeObjectListLayoutColumns.length}`,
);

// watchConfig держит fs.watchFile — без этого процесс не завершится
process.exit(0);
