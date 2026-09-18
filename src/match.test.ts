/**
 * Тесты подбора кнопок и правил. Раннер — vitest (`npm test`).
 *
 * `check` — это обычный `test` из vitest под старым именем: проверки писались
 * до переезда на раннер, и переименовывать их все смысла нет.
 */
import * as assert from "assert";
import { test as check } from "vitest";

import { buildButtonCommand, renderTemplate, versionVars } from "./command";
import {
  ButtonRule,
  ButtonSpec,
  CrtLensConfig,
  DEFAULT_CONFIG,
  normalizeButton,
  normalizeConfig,
} from "./config";
import {
  applies,
  clusterMasksApply,
  globToRegExp,
  literalLength,
  pickButtons,
  resolve,
  Target,
} from "./match";
import { buttonScopeFor, columnScopes, parseScope, scopeRegistrations } from "./scopes";
import { validateConfig } from "./validate";

function withRules(rules: ButtonRule[]): CrtLensConfig {
  return { ...DEFAULT_CONFIG, buttons: [{ ...DEFAULT_CONFIG.buttons[0], rules }] };
}

function withButtons(buttons: Record<string, unknown>[]): CrtLensConfig {
  return { ...DEFAULT_CONFIG, buttons: buttons.map(normalizeButton) };
}

const CONTEXT = "acme-eu-test-1";

const pod = (over: Partial<Target> = {}): Target => ({
  context: CONTEXT,
  namespace: "web",
  pod: "deploy-worker-abc",
  container: "app",
  name: "app",
  kind: "Pod",
  ...over,
});

const node = (over: Partial<Target> = {}): Target => ({
  context: CONTEXT,
  node: "cp-node-01",
  name: "cp-node-01",
  kind: "Node",
  ...over,
});

/** Цели пода так, как их отдаёт меню: контейнеры плюс сам под. */
function podTargets(containers = ["app"], over: Partial<Target> = {}) {
  const object = pod({ container: undefined, name: "deploy-worker-abc", ...over });

  return {
    containers: containers.map((container) => ({ ...object, container, name: container })),
    object,
  };
}

function nodeTargets(over: Partial<Target> = {}) {
  return { containers: [] as Target[], object: node(over) };
}

const shell = (config: CrtLensConfig, target: Target, rules = config.buttons[0].rules) =>
  resolve(rules, target, "shell", config.default_shell);

// ── маски ────────────────────────────────────────────────────────────────────

check("glob матчится по всей строке", () => {
  assert.ok(globToRegExp("deploy*").test("deploy-worker"));
  assert.ok(!globToRegExp("deploy*").test("my-deploy"));
  assert.ok(globToRegExp("pod-?").test("pod-1"));
  assert.ok(!globToRegExp("pod-?").test("pod-12"));
  assert.ok(globToRegExp("acme-*-prod-1").test("acme-eu-prod-1"));
});

check("точка в маске не подстановочный символ", () => {
  assert.ok(!globToRegExp("a.c").test("abc"));
  assert.ok(globToRegExp("a.c").test("a.c"));
});

check("нет масок — правило применимо ко всему", () => {
  assert.ok(applies({}, pod()));
  assert.ok(applies({}, node()));
});

check("правило про под не применяется к ноде и наоборот", () => {
  assert.ok(!applies({ pod: "*" }, node()));
  assert.ok(!applies({ node: "*" }, pod()));
});

check("маска container матчит контейнер, а не под", () => {
  assert.ok(applies({ container: "app" }, pod()));
  assert.ok(!applies({ container: "app" }, pod({ container: "sidecar" })));
  assert.ok(!applies({ container: "*" }, node()));
});

check("класс символов в маске", () => {
  assert.ok(globToRegExp("1.2[0-6].*").test("1.25.11"));
  assert.ok(!globToRegExp("1.2[0-6].*").test("1.27.3"));
  assert.ok(globToRegExp("[!x]y").test("ay"));
  assert.ok(!globToRegExp("[!x]y").test("xy"));
  // незакрытая скобка — обычный символ, а не сломанный regexp
  assert.ok(globToRegExp("a[b").test("a[b"));
});

check("маска kube_version сравнивается с версией без v", () => {
  assert.ok(applies({ kube_version: "1.2[0-6].*" }, pod({ kubeVersion: "v1.25.11" })));
  assert.ok(!applies({ kube_version: "1.2[0-6].*" }, pod({ kubeVersion: "v1.33.3" })));
  // версии нет — маска не совпала, как и любая другая маска без значения
  assert.ok(!applies({ kube_version: "*" }, pod()));
});

check("правило с kube_version перекрывает команду кнопки только на старом кластере", () => {
  const config = withButtons([
    {
      id: "gdb",
      scopes: ["containers"],
      cmd: "новый {{kube_version}}",
      rules: [{ kube_version: "1.2[0-6].*", cmd: "старый {{kube_version}}" }],
    },
  ]);
  const build = (kubeVersion: string) =>
    buildButtonCommand(
      config,
      config.buttons[0],
      parseScope("containers")!,
      pod({ kubeVersion }),
      "",
    ).command;

  assert.strictEqual(build("v1.25.11"), "старый 1.25.11");
  assert.strictEqual(build("v1.33.3"), "новый 1.33.3");
});

check("длина литеральной части считается без подстановочных символов", () => {
  assert.strictEqual(literalLength({ pod: "deploy*" }), 6);
  assert.strictEqual(literalLength({ pod: "deploy*", namespace: "web" }), 9);
});

// ── подбор значения правилом ─────────────────────────────────────────────────

check("маска пода бьёт маску неймспейса", () => {
  const config = withRules([
    { namespace: "web", shell: "sh" },
    { pod: "deploy*", shell: "bash" },
  ]);

  assert.strictEqual(shell(config, pod()).value, "bash");
});

check("порядок в файле на приоритет не влияет", () => {
  const config = withRules([
    { pod: "deploy*", shell: "bash" },
    { namespace: "web", shell: "sh" },
  ]);

  assert.strictEqual(shell(config, pod()).value, "bash");
});

check("из двух масок пода выигрывает более длинная", () => {
  const config = withRules([
    { pod: "deploy*", shell: "bash" },
    { pod: "deploy-worker*", shell: "zsh" },
  ]);

  assert.strictEqual(shell(config, pod()).value, "zsh");
});

check("при равной длине выигрывает первое сверху", () => {
  const config = withRules([
    { pod: "deploy-worker-ab?", shell: "first" },
    { pod: "deploy-worker-?bc", shell: "second" },
  ]);

  assert.strictEqual(shell(config, pod()).value, "first");
});

check("контекст добавляет специфичности при равных масках", () => {
  const config = withRules([
    { pod: "deploy*", shell: "bash" },
    { pod: "deploy*", context: CONTEXT, shell: "zsh" },
  ]);

  assert.strictEqual(shell(config, pod()).value, "zsh");
  assert.strictEqual(shell(config, pod({ context: "acme-eu-prod-1" })).value, "bash");
});

check("не подошло ничего — дефолт", () => {
  const config = withRules([{ namespace: "prod", shell: "sh" }]);

  assert.strictEqual(shell(config, pod()).value, config.default_shell);
  assert.strictEqual(shell(config, pod()).rule, undefined);
});

check("shell и image разрешаются независимо", () => {
  const config = withRules([
    { pod: "deploy*", shell: "bash" },
    { context: "acme-*", image: "registry.local/alpine:3.19" },
  ]);
  const rules = config.buttons[0].rules;
  const image = (target: Target) =>
    resolve(rules, target, "image", config.default_node_image).value;

  assert.strictEqual(shell(config, pod()).value, "bash");
  assert.strictEqual(image(node()), "registry.local/alpine:3.19");
  // у правила с shell образа нет — оно не должно перебивать правило с образом
  assert.strictEqual(image(pod()), "registry.local/alpine:3.19");
});

check("пустая строка в правиле игнорируется", () => {
  const config = withRules([{ pod: "deploy*", shell: "" }]);

  assert.strictEqual(shell(config, pod()).value, config.default_shell);
});

// ── scopes ───────────────────────────────────────────────────────────────────

check("алиасы scope разбираются в kind", () => {
  assert.deepStrictEqual(parseScope("containers"), {
    raw: "containers",
    kind: "Pod",
    apiVersions: ["v1"],
    containers: true,
  });
  assert.strictEqual(parseScope("pods")?.containers, false);
  assert.strictEqual(parseScope("nodes")?.kind, "Node");
  assert.strictEqual(parseScope("namespaces")?.kind, "Namespace");
});

check("ходовой kind получает apiVersion из таблицы, неизвестный — нет", () => {
  assert.deepStrictEqual(parseScope("Deployment")?.apiVersions, ["apps/v1"]);
  assert.strictEqual(parseScope("MyKind"), undefined);
  assert.deepStrictEqual(parseScope("example.com/v1:MyKind"), {
    raw: "example.com/v1:MyKind",
    kind: "MyKind",
    apiVersions: ["example.com/v1"],
    containers: false,
  });
});

check("containers важнее pods, если заявлены оба", () => {
  const button = normalizeButton({ id: "x", scopes: ["pods", "containers"] }, 0);

  assert.strictEqual(buttonScopeFor(button, "Pod")?.containers, true);
  assert.strictEqual(buttonScopeFor(button, "Node"), undefined);
});

check("регистрируются Pod, Node, Namespace и kind'ы из конфига", () => {
  const config = withButtons([{ id: "x", scopes: ["apps/v1:Deployment"] }]);
  const kinds = scopeRegistrations(config).map((item) => item.kind);

  assert.deepStrictEqual(kinds.sort(), ["Deployment", "Namespace", "Node", "Pod"]);
});

// ── колонки в списке ─────────────────────────────────────────────────────────

check("колонка только у кнопок с column и только для их kind'ов", () => {
  const config = withButtons([
    { id: "shell", scopes: ["containers", "nodes"], column: true },
    { id: "debug", scopes: ["containers"], cmd: "x" },
  ]);

  assert.deepStrictEqual(
    columnScopes(config).map((column) => `${column.buttonId}/${column.kind}`),
    ["shell/Pod", "shell/Node"],
  );
});

check("containers и pods у одной кнопки дают одну колонку", () => {
  const config = withButtons([{ id: "shell", scopes: ["containers", "pods"], column: true }]);

  assert.deepStrictEqual(columnScopes(config), [
    { buttonId: "shell", kind: "Pod", apiVersions: ["v1"] },
  ]);
});

check("кнопки с одним id дают одну колонку, apiVersions складываются", () => {
  const config = withButtons([
    { id: "logs", scopes: ["Event"], column: true },
    { id: "logs", context: "acme-*", scopes: ["events.k8s.io/v1:Event"], column: true },
  ]);

  assert.deepStrictEqual(columnScopes(config), [
    { buttonId: "logs", kind: "Event", apiVersions: ["v1", "events.k8s.io/v1"] },
  ]);
});

check("неразобранный scope колонку не создаёт", () => {
  const config = withButtons([{ id: "x", scopes: ["MyKind"], cmd: "x", column: true }]);

  assert.deepStrictEqual(columnScopes(config), []);
});

check("column: true — не опечатка", () => {
  assert.strictEqual(normalizeButton({ id: "x", scopes: ["pods"], column: true }, 0).column, true);
  assert.strictEqual(normalizeButton({ id: "x", scopes: ["pods"] }, 0).column, false);
  assert.deepStrictEqual(
    validateConfig({ buttons: [{ id: "x", scopes: ["containers"], column: true }] }),
    [],
  );
});

check("колонка прячется там, где не совпали маски кластера", () => {
  const button = normalizeButton(
    { id: "x", scopes: ["pods"], context: "acme-*-prod-*", kube_version: "1.3*" },
    0,
  );

  assert.strictEqual(clusterMasksApply(button, "acme-eu-prod-1", "v1.33.3"), true);
  assert.strictEqual(clusterMasksApply(button, "acme-eu-test-1", "v1.33.3"), false);
  assert.strictEqual(clusterMasksApply(button, "acme-eu-prod-1", "v1.29.1"), false);
  // версия ещё не определилась — маску считаем несовпавшей, как и в applies
  assert.strictEqual(clusterMasksApply(button, "acme-eu-prod-1", ""), false);
  // масок кластера нет — колонка видна везде, дальше решает строка
  assert.strictEqual(clusterMasksApply({ pod: "deploy*" }, "any", ""), true);
});

// ── подбор кнопок ────────────────────────────────────────────────────────────

check("кнопка появляется только в своём scope", () => {
  const config = withButtons([
    { id: "shell", scopes: ["containers"] },
    { id: "nodeshell", scopes: ["nodes"] },
  ]);

  assert.deepStrictEqual(
    pickButtons(config, "Pod", podTargets()).map((item) => item.button.id),
    ["shell"],
  );
  assert.deepStrictEqual(
    pickButtons(config, "Node", nodeTargets()).map((item) => item.button.id),
    ["nodeshell"],
  );
});

check("кнопка со scope containers не показывается, если контейнеров нет", () => {
  const config = withButtons([{ id: "shell", scopes: ["containers"] }]);
  const stopped = { containers: [] as Target[], object: podTargets().object };

  assert.strictEqual(pickButtons(config, "Pod", stopped).length, 0);
});

check("кнопка со scope pods видна и у пода без живых контейнеров", () => {
  const config = withButtons([{ id: "logs", scopes: ["pods"], cmd: "kubectl logs {{pod}}" }]);
  const stopped = { containers: [] as Target[], object: podTargets().object };

  assert.deepStrictEqual(
    pickButtons(config, "Pod", stopped).map((item) => item.button.id),
    ["logs"],
  );
});

check("маски кнопки решают, показывать ли её", () => {
  const config = withButtons([
    { id: "debug", scopes: ["containers"], pod: "worker*", cmd: "x" },
  ]);

  assert.strictEqual(pickButtons(config, "Pod", podTargets()).length, 0);
  assert.strictEqual(
    pickButtons(config, "Pod", podTargets(["app"], { pod: "worker-1" })).length,
    1,
  );
});

check("маска container отсекает лишние контейнеры в подменю", () => {
  const config = withButtons([
    { id: "debug", scopes: ["containers"], container: "app*", cmd: "x" },
  ]);
  const picked = pickButtons(config, "Pod", podTargets(["app", "app-2", "istio-proxy"]));

  assert.deepStrictEqual(
    picked[0].targets.map((target) => target.container),
    ["app", "app-2"],
  );
});

check("подпись кнопки не считается маской имени", () => {
  const config = withButtons([{ id: "debug", name: "Debug", scopes: ["containers"], cmd: "x" }]);

  assert.strictEqual(pickButtons(config, "Pod", podTargets()).length, 1);
});

check("маска object матчит имя выделенного объекта", () => {
  const config = withButtons([
    { id: "x", scopes: ["Deployment"], object: "worker*", cmd: "c" },
  ]);
  const target = (name: string) => ({
    containers: [] as Target[],
    object: { context: CONTEXT, namespace: "web", name, kind: "Deployment" },
  });

  assert.strictEqual(pickButtons(config, "Deployment", target("worker-api")).length, 1);
  assert.strictEqual(pickButtons(config, "Deployment", target("api")).length, 0);
});

check("кнопки с одним id схлопываются: выигрывает специфичная", () => {
  const config = withButtons([
    { id: "debug", scopes: ["containers"], cmd: "общая" },
    { id: "debug", context: "acme-eu-prod-1", scopes: ["containers"], cmd: "прод" },
  ]);

  const here = pickButtons(config, "Pod", podTargets());
  const prod = pickButtons(config, "Pod", podTargets(["app"], { context: "acme-eu-prod-1" }));

  assert.strictEqual(here.length, 1);
  assert.strictEqual(here[0].button.cmd, "общая");
  assert.strictEqual(prod.length, 1);
  assert.strictEqual(prod[0].button.cmd, "прод");
});

check("при равной специфичности выигрывает нижняя кнопка", () => {
  const config = withButtons([
    { id: "debug", scopes: ["containers"], cmd: "первая" },
    { id: "debug", scopes: ["containers"], cmd: "вторая" },
  ]);

  assert.strictEqual(pickButtons(config, "Pod", podTargets())[0].button.cmd, "вторая");
});

check("перекрытие не двигает кнопку в меню", () => {
  const config = withButtons([
    { id: "debug", scopes: ["containers"], cmd: "общая" },
    { id: "shell", scopes: ["containers"] },
    { id: "debug", context: CONTEXT, scopes: ["containers"], cmd: "точная" },
  ]);

  assert.deepStrictEqual(
    pickButtons(config, "Pod", podTargets()).map((item) => item.button.id),
    ["debug", "shell"],
  );
});

// ── сборка команды ───────────────────────────────────────────────────────────

check("подстановка не зависит от регистра ключа", () => {
  assert.strictEqual(renderTemplate("{{POD}}/{{Container}}", { pod: "p", container: "c" }), "p/c");
  assert.strictEqual(renderTemplate("{{unknown}}", {}), "{{unknown}}");
});

check("cmd берётся из правила, потом с кнопки, потом из pod_command", () => {
  const base = { id: "debug", scopes: ["containers"] };
  const scope = parseScope("containers")!;
  const build = (config: CrtLensConfig) =>
    buildButtonCommand(config, config.buttons[0], scope, pod(), "/kubeconfig").command;

  assert.ok(build(withButtons([base])).includes("exec -i -t"));
  assert.strictEqual(build(withButtons([{ ...base, cmd: "с кнопки" }])), "с кнопки");
  assert.strictEqual(
    build(withButtons([{ ...base, cmd: "с кнопки", rules: [{ pod: "deploy*", cmd: "из правила" }] }])),
    "из правила",
  );
});

check("в scope containers {{name}} — это контейнер", () => {
  const config = withButtons([
    { id: "debug", scopes: ["containers"], cmd: "{{pod}} {{name}} {{kind}} {{button}}" },
  ]);
  const built = buildButtonCommand(
    config,
    config.buttons[0],
    parseScope("containers")!,
    pod(),
    "",
  );

  assert.strictEqual(built.command, "deploy-worker-abc app Pod debug");
});

check("версия кластера подставляется, в том числе в kubectl_path", () => {
  const config = {
    ...withButtons([
      { id: "x", scopes: ["containers"], cmd: "{{kubectl}} {{kube_version}} {{kube_minor}}" },
    ]),
    kubectl_path: "/bin/kubectl-{{kube_minor}}",
  };
  const built = buildButtonCommand(
    config,
    config.buttons[0],
    parseScope("containers")!,
    pod({ kubeVersion: "v1.33.3" }),
    "",
  );

  assert.strictEqual(built.command, "/bin/kubectl-1.33 1.33.3 1.33");
});

check("кластер без известной версии не ломает команду", () => {
  assert.deepStrictEqual(versionVars(undefined), { kube_version: "", kube_minor: "" });
  assert.deepStrictEqual(versionVars("1.30.1"), { kube_version: "1.30.1", kube_minor: "1.30" });
});

check("нода получает overrides с образом и шеллом из правил", () => {
  const config = withButtons([
    {
      id: "shell",
      scopes: ["nodes"],
      rules: [{ node: "cp-*", image: "cr.local/alpine:3.19", shell: "ash" }],
    },
  ]);
  const built = buildButtonCommand(config, config.buttons[0], parseScope("nodes")!, node(), "");

  assert.ok(built.command.includes("--image cr.local/alpine:3.19"));
  assert.ok(built.command.includes("cp-node-01"));
  assert.ok(built.command.includes("ash"));
  assert.strictEqual(built.image.value, "cr.local/alpine:3.19");
});

check("заголовок вкладки берётся с кнопки и обрезается", () => {
  const config = {
    ...withButtons([{ id: "debug", scopes: ["containers"], cmd: "x", title: "dbg {{pod}}/{{name}}" }]),
    tab_title_max: 10,
  };
  const built = buildButtonCommand(
    config,
    config.buttons[0],
    parseScope("containers")!,
    pod(),
    "",
  );

  assert.strictEqual(built.title, "dbg deploy");
});

check("scope без дефолтной команды и без cmd даёт пустую команду", () => {
  const config = withButtons([{ id: "x", scopes: ["namespaces"] }]);
  const built = buildButtonCommand(
    config,
    config.buttons[0],
    parseScope("namespaces")!,
    { context: CONTEXT, namespace: "web", name: "web", kind: "Namespace" },
    "",
  );

  assert.strictEqual(built.command, "");
});

// ── конфиг ───────────────────────────────────────────────────────────────────

check("конфиг без buttons превращается в одну кнопку старого вида", () => {
  const config = normalizeConfig({
    name: "CRT",
    material_icon: "terminal",
    rules: [{ pod: "deploy*", shell: "bash" }],
  });

  assert.strictEqual(config.buttons.length, 1);

  const button: ButtonSpec = config.buttons[0];

  assert.strictEqual(button.id, "shell");
  assert.strictEqual(button.name, "CRT");
  assert.strictEqual(button.icon, "terminal");
  // старый конфиг знал только SecureCRT — теперь это ext с пресетом crt
  assert.strictEqual(button.type, "ext");
  assert.strictEqual(button.terminal, "crt");
  assert.deepStrictEqual(button.scopes, ["containers", "nodes"]);
  assert.deepStrictEqual(button.rules, [{ pod: "deploy*", shell: "bash" }]);
});

check("мусор в кнопке не роняет разбор", () => {
  const button = normalizeButton({ id: "x", type: "wat", scopes: "containers", rules: "нет" }, 0);

  assert.strictEqual(button.type, "ext");
  assert.deepStrictEqual(button.scopes, []);
  assert.deepStrictEqual(button.rules, []);
  assert.strictEqual(button.name, "x");
});

check("validateConfig ругается на то, что нормализация проглотила", () => {
  const problems = validateConfig({
    buttons: [
      { id: "a", type: "wat", scopes: ["containers"] },
      { id: "b", scopes: ["MyKind"] },
      { id: "c", scopes: ["namespaces"] },
      { scopes: ["containers"] },
    ],
  });

  assert.ok(problems.some((problem) => problem.includes("неизвестный type")));
  assert.ok(problems.some((problem) => problem.includes("неизвестный scope")));
  assert.ok(problems.some((problem) => problem.includes("нет команды по умолчанию")));
  assert.ok(problems.some((problem) => problem.includes("нет id")));
});

check("опечатка в поле правила не проходит молча", () => {
  const problems = validateConfig({
    buttons: [
      {
        id: "gdb",
        scopes: ["containers"],
        cmd: "x",
        rules: [{ kube_versions: "1.2*", cmd: "y" }],
      },
    ],
  });

  assert.ok(problems.some((problem) => problem.includes('неизвестное поле "kube_versions"')));
});

check("запрос ввода без {{input}} и {{input}} без запроса — оба замечание", () => {
  const problems = validateConfig({
    buttons: [
      { id: "a", type: "local", scopes: ["containers"], cmd: "kubectl logs", input: true },
      { id: "b", type: "local", scopes: ["containers"], cmd: "kubectl logs {{input}}" },
      { id: "c", type: "local", scopes: ["containers"], cmd: "x {{input}}", input: { wat: 1 } },
    ],
  });

  assert.ok(problems.some((problem) => problem.includes("подставлять её некуда")));
  assert.ok(problems.some((problem) => problem.includes("подставится пустая строка")));
  assert.ok(problems.some((problem) => problem.includes('неизвестное поле "wat"')));
});

check("input мусором не молчит, а input в rules и в title засчитывается", () => {
  const problems = validateConfig({
    buttons: [
      { id: "a", type: "local", scopes: ["containers"], cmd: "x", input: 42 },
      {
        id: "b",
        type: "local",
        scopes: ["containers"],
        cmd: "x",
        input: "фильтр",
        rules: [{ namespace: "prod", cmd: "x {{userinput}}" }],
      },
      { id: "c", type: "local", scopes: ["containers"], cmd: "x", title: "{{input}}", input: true },
    ],
  });

  assert.deepStrictEqual(problems, [
    "кнопка #1 (a): input должен быть true, строкой-подписью или мапой " +
      "{ label, placeholder, default, required } — запроса ввода не будет",
  ]);
});

check("валидный конфиг замечаний не даёт", () => {
  const problems = validateConfig({
    buttons: [
      { id: "shell", scopes: ["containers", "nodes"] },
      { id: "debug", type: "local", scopes: ["containers"], cmd: "kubectl debug" },
      { id: "ns", scopes: ["namespaces"], rules: [{ cmd: "kubectl get all -n {{name}}" }] },
    ],
  });

  assert.deepStrictEqual(problems, []);
});

// ── списки в масках ──────────────────────────────────────────────────────────

check("список в маске — это «или»", () => {
  const masks = { namespace: ["prod", "temporal"] };

  assert.ok(applies(masks, pod({ namespace: "prod" })));
  assert.ok(applies(masks, pod({ namespace: "temporal" })));
  assert.ok(!applies(masks, pod({ namespace: "kube-system" })));
});

check("альтернативы — такие же глобы", () => {
  const masks = { pod: ["deploy-*", "worker-?"] };

  assert.ok(applies(masks, pod({ pod: "deploy-abc" })));
  assert.ok(applies(masks, pod({ pod: "worker-1" })));
  assert.ok(!applies(masks, pod({ pod: "worker-12" })));
});

check("список не делает маску точнее самой слабой альтернативы", () => {
  // иначе [prod, *] выигрывал бы у честной маски prod
  assert.strictEqual(literalLength({ namespace: ["prod", "*"] }), 0);
  assert.strictEqual(literalLength({ namespace: ["prod", "temporal"] }), 4);
  assert.strictEqual(literalLength({ namespace: "prod" }), 4);
});

check("кнопка со списком видна в перечисленных неймспейсах и больше нигде", () => {
  const config = withButtons([
    { id: "logs", namespace: ["prod", "temporal"], scopes: ["containers"], cmd: "kubectl logs" },
  ]);
  const ids = (namespace: string) =>
    pickButtons(config, "Pod", podTargets(["app"], { namespace })).map((item) => item.button.id);

  assert.deepStrictEqual(ids("prod"), ["logs"]);
  assert.deepStrictEqual(ids("temporal"), ["logs"]);
  assert.deepStrictEqual(ids("kube-system"), []);
});

check("маска списком в правиле подбирает значение", () => {
  const config = withRules([{ namespace: ["prod", "temporal"], shell: "bash" }]);

  assert.strictEqual(shell(config, pod({ namespace: "temporal" })).value, "bash");
  assert.strictEqual(shell(config, pod({ namespace: "web" })).value, config.default_shell);
});

check("пустой список и мусор внутри списка выбрасываются", () => {
  const button = normalizeButton(
    { id: "x", namespace: [], pod: ["deploy-*", 42, ""], context: {} },
    0,
  );

  assert.strictEqual(button.namespace, undefined);
  assert.deepStrictEqual(button.pod, ["deploy-*"]);
  assert.strictEqual(button.context, undefined);
});

// ── валидатор ругается на негодные маски ─────────────────────────────────────

check("маска-словарь: разбор её выбросит, валидатор про это скажет", () => {
  const problems = validateConfig({
    buttons: [{ id: "logs", scopes: ["containers"], cmd: "x", namespace: { prod: true } }],
  });

  assert.ok(problems.some((problem) => problem.includes("маска namespace должна быть строкой")));
});

check("нестроковые элементы списка не молчат", () => {
  const problems = validateConfig({
    buttons: [{ id: "logs", scopes: ["containers"], cmd: "x", namespace: ["prod", 42] }],
  });

  assert.ok(problems.some((problem) => problem.includes("не строки")));
});

check("пустая маска и пустой список — тоже замечание", () => {
  const problems = validateConfig({
    buttons: [
      { id: "a", scopes: ["containers"], cmd: "x", container: "" },
      { id: "b", scopes: ["containers"], cmd: "x", namespace: [] },
    ],
  });

  assert.ok(problems.some((problem) => problem.includes("маска container пустая")));
  assert.ok(problems.some((problem) => problem.includes("пустой список")));
});

check("негодная маска в правиле и в vars тоже видна", () => {
  const problems = validateConfig({
    vars: [{ namespace: 42, set: { a: "b" } }],
    buttons: [{ id: "a", scopes: ["containers"], cmd: "x", rules: [{ pod: 42, shell: "sh" }] }],
  });

  assert.ok(problems.some((problem) => problem.includes("vars #0: маска namespace")));
  assert.ok(problems.some((problem) => problem.includes("правило #0: маска pod")));
});

check("список строк замечаний не даёт", () => {
  assert.deepStrictEqual(
    validateConfig({
      buttons: [{ id: "logs", namespace: ["prod", "temporal"], scopes: ["containers"], cmd: "x" }],
    }),
    [],
  );
});
