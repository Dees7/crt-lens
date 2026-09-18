// Дымовая проверка собранного бандла: грузим dist/renderer.js так же, как это
// делает Freelens 1.x, — через require() и с глобалами, которые публикует
// рендерер приложения.
//
// Ловит ровно то, что не ловят ни тесты (они работают с исходниками), ни
// типы: ошибку в шиме host-провайденных модулей, забытый экспорт, падение на
// вычислении полей класса расширения (конфиг, scopes, колонки), а заодно —
// инжект стилей, которого в этой ветке нет ни у кого, кроме самого бандла.
//
// Заглушки здесь намеренно минимальные: настоящий контракт живёт в
// freelens/src/renderer/index.ts форка, а нам нужно убедиться, что бандл
// читает его и не тащит своих копий.

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

// 1.x кладёт экспорты рендерера прямо на глобальный объект, а не под один ключ
globalThis.LensExtensions = { Common: {}, Renderer };
globalThis.React = React;
globalThis.ReactJsxRuntime = ReactJsxRuntime;
globalThis.Mobx = Mobx;
globalThis.MobxReact = MobxReact;

// document нужен не React'у (ничего не рендерим), а инжекту стилей в бандле
const appended = [];

globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ attributes: {}, textContent: "", setAttribute(name, value) {
    this.attributes[name] = value;
  } }),
  head: { appendChild: (node) => appended.push(node) },
};

const module_ = require("../dist/renderer.js");
const Extension = module_.default;

assert.ok(Extension.prototype instanceof LensExtension, "энтрипоинт должен наследовать LensExtension");

assert.strictEqual(appended.length, 1, "бандл должен сам вешать свои стили: <style data-crt-lens>");
assert.ok("data-crt-lens" in appended[0].attributes, "у тега стилей должен быть признак расширения");
assert.ok(appended[0].textContent.includes("--font-monospace"), "в теге должны быть стили расширения");

const extension = new Extension();

assert.ok(Array.isArray(extension.kubeObjectMenuItems), "kubeObjectMenuItems должен быть списком");
assert.ok(extension.kubeObjectMenuItems.length > 0, "не зарегистрировалось ни одного kind");
assert.ok(Array.isArray(extension.kubeObjectListLayoutColumns), "kubeObjectListLayoutColumns должен быть списком");
assert.strictEqual(extension.appPreferences.length, 1, "настройки должны регистрироваться");

console.log(
  `дым: ok — kind'ов ${extension.kubeObjectMenuItems.length}, ` +
    `колонок ${extension.kubeObjectListLayoutColumns.length}, стили инжектятся`,
);

// watchConfig держит fs.watchFile — без этого процесс не завершится
process.exit(0);
