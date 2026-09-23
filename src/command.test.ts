/**
 * Тесты ссылок, переменных и экранирования — того, что появилось вместе с
 * `type: url` и внешними терминалами.
 */
import * as assert from "assert";
import { test as check } from "vitest";

import { buildButtonCommand, instanceId, isRunnable, providerVars, withInput } from "./command";
import { CrtLensConfig, DEFAULT_CONFIG, normalizeButton, normalizeConfig, VarsEntry } from "./config";
import { pickButtons, resolveVars, Target } from "./match";
import { parseScope } from "./scopes";
import { cmdQuote, posixQuote, quote } from "./template";

const CONTEXT = "acme-eu-prod-1";

const pod = (over: Partial<Target> = {}): Target => ({
  context: CONTEXT,
  namespace: "web",
  pod: "deploy-worker-abc",
  container: "app",
  name: "app",
  kind: "Pod",
  ...over,
});

function withConfig(over: Partial<CrtLensConfig>): CrtLensConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

function build(config: CrtLensConfig, target: Target, scope = "containers") {
  return buildButtonCommand(config, config.buttons[0], parseScope(scope)!, target, "/kubeconfig");
}

// ── нода: id машины ──────────────────────────────────────────────────────────

check("instance_id — последний сегмент providerID без схемы", () => {
  assert.strictEqual(instanceId("yandex://a7lcabeskdjtm9713us6"), "a7lcabeskdjtm9713us6");
  assert.strictEqual(instanceId("aws:///eu-west-1a/i-0abc"), "i-0abc");
  assert.strictEqual(instanceId("gce://proj/europe-west1-b/node-1"), "node-1");
  assert.strictEqual(instanceId(undefined), "");
  assert.strictEqual(instanceId(""), "");
});

check("сегменты providerID: GCE отдаёт project, zone и имя", () => {
  const vars = providerVars("gce://acme-prod/europe-west1-b/gke-main-pool-1a2b");

  assert.strictEqual(vars.provider_path, "acme-prod/europe-west1-b/gke-main-pool-1a2b");
  assert.strictEqual(vars.provider_1, "acme-prod");
  assert.strictEqual(vars.provider_2, "europe-west1-b");
  assert.strictEqual(vars.provider_3, "gke-main-pool-1a2b");
  assert.strictEqual(vars.provider_4, "");
  assert.strictEqual(vars.instance_id, "gke-main-pool-1a2b");
});

check("без providerID все переменные машины пустые, но есть", () => {
  const vars = providerVars(undefined);

  assert.strictEqual(vars.provider_id, "");
  assert.strictEqual(vars.provider_path, "");
  assert.strictEqual(vars.provider_1, "");
  assert.strictEqual(vars.provider_9, "");
  assert.strictEqual(vars.instance_id, "");
});

check("ссылка на ноду собирается из providerID", () => {
  const config = normalizeConfig({
    buttons: [{ id: "c", type: "url", scopes: ["nodes"], url: "https://c/nodes/{{instance_id}}?p={{provider_id}}" }],
  });
  const target: Target = { context: CONTEXT, node: "n1", name: "n1", kind: "Node", providerId: "yandex://a7l" };

  assert.strictEqual(build(config, target, "nodes").url, "https://c/nodes/a7l?p=yandex://a7l");
});

// ── переменные ───────────────────────────────────────────────────────────────

const varsFor = (vars: VarsEntry[], button: Record<string, unknown>, target: Target) =>
  resolveVars(vars, normalizeButton(button, 0), target);

check("переменная берётся из записи, чьи маски подошли", () => {
  const vars: VarsEntry[] = [
    { context: "acme-eu-prod-*", set: { base: "prod" } },
    { context: "acme-eu-preprod-*", set: { base: "preprod" } },
  ];

  assert.strictEqual(varsFor(vars, { id: "x" }, pod()).base, "prod");
  assert.strictEqual(
    varsFor(vars, { id: "x" }, pod({ context: "acme-eu-preprod-1" })).base,
    "preprod",
  );
});

check("не подошла ни одна запись — ключа нет вовсе", () => {
  const vars: VarsEntry[] = [{ context: "чужой", set: { base: "prod" } }];

  assert.deepStrictEqual(varsFor(vars, { id: "x" }, pod()), {});
});

check("более специфичная маска перебивает общую", () => {
  const vars: VarsEntry[] = [
    { context: "acme-*", set: { base: "общий", extra: "остаётся" } },
    { context: "acme-eu-prod-1", set: { base: "точный" } },
  ];
  const resolved = varsFor(vars, { id: "x" }, pod());

  assert.strictEqual(resolved.base, "точный");
  // ключ, которого в точной записи нет, приезжает из общей
  assert.strictEqual(resolved.extra, "остаётся");
});

check("vars кнопки бьёт таблицу при одинаковых масках", () => {
  const vars: VarsEntry[] = [{ set: { base: "из таблицы" } }];
  const resolved = varsFor(vars, { id: "x", vars: { base: "с кнопки" } }, pod());

  assert.strictEqual(resolved.base, "с кнопки");
});

check("vars правила бьёт vars кнопки", () => {
  const resolved = varsFor(
    [],
    { id: "x", vars: { base: "с кнопки" }, rules: [{ vars: { base: "из правила" } }] },
    pod(),
  );

  assert.strictEqual(resolved.base, "из правила");
});

check("маска правила важнее ранга источника", () => {
  const vars: VarsEntry[] = [{ pod: "deploy-worker-*", set: { base: "точная таблица" } }];
  const resolved = varsFor(vars, { id: "x", rules: [{ vars: { base: "правило без масок" } }] }, pod());

  assert.strictEqual(resolved.base, "точная таблица");
});

check("маски правила про ноду не задевают под", () => {
  const resolved = varsFor([], { id: "x", rules: [{ node: "*", vars: { base: "нода" } }] }, pod());

  assert.deepStrictEqual(resolved, {});
});

// ── ссылки ───────────────────────────────────────────────────────────────────

const LOGS_BUTTON = {
  id: "logs",
  type: "url",
  scopes: ["containers", "nodes"],
  query: '{project = "{{logs_project}}", pod = "{{pod}}", container = "{{container}}"}',
  url: "{{logs_base}}/projects/{{logs_project}}/logs?query={{query_encoded}}&from={{from}}&to={{to}}",
};

check("ссылка собирается из vars, а селектор уезжает в неё url-encoded", () => {
  const config = withConfig({
    buttons: [normalizeButton(LOGS_BUTTON, 0)],
    vars: [
      {
        context: CONTEXT,
        set: { logs_base: "https://logs.example.com", logs_project: "b1g" },
      },
    ],
  });
  const built = build(config, pod());

  assert.strictEqual(
    built.vars.query,
    '{project = "b1g", pod = "deploy-worker-abc", container = "app"}',
  );
  assert.strictEqual(
    built.url,
    "https://logs.example.com/projects/b1g/logs" +
      "?query=%7Bproject%20%3D%20%22b1g%22%2C%20pod%20%3D%20%22deploy-worker-abc%22%2C%20container%20%3D%20%22app%22%7D" +
      "&from=now-1h&to=now",
  );
  // у ссылки нет команды, и это не мешает ей быть рабочей
  assert.strictEqual(built.command, "");
  assert.ok(isRunnable(config.buttons[0], built));
});

check("окно by default now-1h..now, но перебивается через vars", () => {
  const config = withConfig({
    buttons: [normalizeButton({ ...LOGS_BUTTON, vars: { from: "now-3h", to: "now-1h" } }, 0)],
    vars: [{ context: CONTEXT, set: { logs_base: "https://m", logs_project: "p" } }],
  });

  assert.ok(build(config, pod()).url.endsWith("&from=now-3h&to=now-1h"));
});

check("нет записи в vars для контекста — ссылка неполная, но кнопка отключается по пустому url", () => {
  const config = withConfig({
    buttons: [normalizeButton({ id: "logs", type: "url", scopes: ["containers"] }, 0)],
    vars: [],
  });
  const built = build(config, pod());

  assert.strictEqual(built.url, "");
  assert.ok(!isRunnable(config.buttons[0], built));
});

check("правило подменяет селектор для ноды", () => {
  const config = withConfig({
    buttons: [
      normalizeButton(
        {
          ...LOGS_BUTTON,
          rules: [{ node: "*", query: '{project = "{{logs_project}}", k8s.node = "{{node}}"}' }],
        },
        0,
      ),
    ],
    vars: [{ context: CONTEXT, set: { logs_base: "https://m", logs_project: "p" } }],
  });
  const built = build(config, { context: CONTEXT, node: "cp-01", name: "cp-01", kind: "Node" }, "nodes");

  assert.strictEqual(built.vars.query, '{project = "p", k8s.node = "cp-01"}');
  assert.strictEqual(built.queryRule.index, 0);
});

check("vars не может подменить имя пода или контекст", () => {
  const config = withConfig({
    buttons: [normalizeButton({ ...LOGS_BUTTON, vars: { pod: "чужой", context: "чужой" } }, 0)],
    vars: [{ context: CONTEXT, set: { logs_base: "https://m", logs_project: "p" } }],
  });
  const built = build(config, pod());

  assert.strictEqual(built.vars.pod, "deploy-worker-abc");
  assert.strictEqual(built.vars.context, CONTEXT);
});

// ── запрос ввода ─────────────────────────────────────────────────────────────

const withInputButton = (over: Record<string, unknown>) =>
  withConfig({ buttons: [normalizeButton({ id: "b", scopes: ["containers"], ...over }, 0)] });

check("до ответа {{input}} пустой, а не оставлен в команде текстом", () => {
  const config = withInputButton({ type: "local", cmd: "logs {{pod}} {{input}}", input: true });

  assert.strictEqual(build(config, pod()).command, "logs deploy-worker-abc ");
});

check("ответ подставляется в команду, заголовок и селектор", () => {
  const config = withInputButton({
    type: "local",
    cmd: "logs {{pod}} {{input}}",
    title: "логи {{userinput}}",
    input: true,
  });
  const built = withInput(config, config.buttons[0], build(config, pod()), "| grep -i error");

  assert.strictEqual(built.command, "logs deploy-worker-abc | grep -i error");
  assert.strictEqual(built.title, "логи | grep -i error");
  assert.strictEqual(built.vars.userinput, "| grep -i error");
});

check("{{input_quoted}} экранируется, а пустой ответ не даёт пустых кавычек", () => {
  const config = withInputButton({ type: "local", cmd: "sh -c {{input_quoted}}", input: true });
  const base = build(config, pod());

  assert.strictEqual(base.command, "sh -c ");
  assert.strictEqual(
    withInput(config, config.buttons[0], base, "it's").command,
    "sh -c 'it'\\''s'",
  );
});

check("ответ доезжает до ссылки через селектор", () => {
  const config = withInputButton({
    type: "url",
    query: '{pod = "{{pod}}"} |= "{{input}}"',
    url: "https://logs/?q={{query_encoded}}",
    input: true,
  });
  const built = withInput(config, config.buttons[0], build(config, pod()), "timeout");

  assert.strictEqual(
    built.url,
    "https://logs/?q=" + encodeURIComponent('{pod = "deploy-worker-abc"} |= "timeout"'),
  );
});

check("input: строка — это подпись, мапа — все поля", () => {
  assert.deepStrictEqual(withInputButton({ input: "фильтр" }).buttons[0].input, {
    label: "фильтр",
    default: "",
    required: false,
  });
  assert.deepStrictEqual(
    withInputButton({ input: { label: "фильтр", default: "| grep -i error", required: true } })
      .buttons[0].input,
    { label: "фильтр", default: "| grep -i error", required: true },
  );
  assert.strictEqual(withInputButton({ input: false }).buttons[0].input, undefined);
  assert.strictEqual(withInputButton({}).buttons[0].input, undefined);
});

check("пересборка не трогает подбор значений и имя пода для ноды", () => {
  const config = withConfig({
    buttons: [normalizeButton({ id: "b", scopes: ["nodes"], type: "local", input: true }, 0)],
  });
  const base = build(config, { context: CONTEXT, node: "cl1-node-1", name: "cl1-node-1" }, "nodes");
  const built = withInput(config, config.buttons[0], base, "неважно");

  assert.strictEqual(built.vars.node_pod, base.vars.node_pod);
  assert.strictEqual(built.cmd.value, base.cmd.value);
});

// ── экранирование ────────────────────────────────────────────────────────────

check("posix-кавычки закрывают одинарную кавычку внутри", () => {
  assert.strictEqual(posixQuote("bash"), "'bash'");
  assert.strictEqual(posixQuote("it's"), "'it'\\''s'");
});

check("cmd-кавычки удваивают кавычку и процент", () => {
  assert.strictEqual(cmdQuote("bash"), '"bash"');
  assert.strictEqual(cmdQuote('say "hi"'), '"say ""hi"""');
  // в батнике %PATH% раскрылось бы в переменную окружения
  assert.strictEqual(cmdQuote("100%"), '"100%%"');
});

check("флейвор выбирает стиль кавычек", () => {
  assert.strictEqual(quote("x", "posix"), "'x'");
  assert.strictEqual(quote("x", "cmd"), '"x"');
  assert.strictEqual(quote("x", "none"), "'x'");
});

// ── старый конфиг ────────────────────────────────────────────────────────────

check("конфиг со старыми ключами SecureCRT даёт рабочий пресет crt", () => {
  const config = normalizeConfig({
    securecrt_path: "/Applications/CRT.app/Contents/MacOS/CRT",
    securecrt_args: ["/F", "/tmp/cfg"],
    session_name: "мой-crt",
    buttons: [{ id: "shell", type: "crt", scopes: ["containers"] }],
  });

  assert.deepStrictEqual(config.terminals.crt.darwin?.argv, [
    "/Applications/CRT.app/Contents/MacOS/CRT",
    "/F",
    "/tmp/cfg",
    "/T",
    "/N",
    "{{title}}",
    "/S",
    "мой-crt",
  ]);
  assert.strictEqual(config.buttons[0].type, "ext");
  assert.strictEqual(config.buttons[0].terminal, "crt");
});

check("activate_app: false убирает поднятие окна", () => {
  const config = normalizeConfig({ securecrt_path: "/bin/crt", activate_app: false });

  assert.strictEqual(config.terminals.crt.darwin?.activate, undefined);
});

check("явный пресет crt важнее собранного из старых ключей", () => {
  const config = normalizeConfig({
    securecrt_path: "/bin/старый",
    terminals: { crt: { job: "posix", darwin: { argv: ["/bin/новый", "{{job}}"] } } },
  });

  assert.deepStrictEqual(config.terminals.crt.darwin?.argv, ["/bin/новый", "{{job}}"]);
});

check("type: crt с явным terminal не превращается в противоречие", () => {
  const button = normalizeButton({ id: "x", type: "crt", terminal: "iterm" }, 0);

  assert.strictEqual(button.type, "ext");
  assert.strictEqual(button.terminal, "iterm");
});

check("type: logs читается как есть, log — его синоним", () => {
  assert.strictEqual(normalizeButton({ id: "x", type: "logs" }, 0).type, "logs");
  assert.strictEqual(normalizeButton({ id: "x", type: "log" }, 0).type, "logs");
});

check("кнопке логов команда не нужна — она всё равно запускается", () => {
  const button = normalizeButton({ id: "x", type: "logs", scopes: ["DaemonSet"] }, 0);
  const scope = parseScope("DaemonSet");

  assert.ok(scope);

  const built = buildButtonCommand(
    DEFAULT_CONFIG,
    button,
    scope,
    { context: CONTEXT, namespace: "web", name: "fluent-bit", kind: "DaemonSet" },
    "/kubeconfig",
  );

  assert.strictEqual(built.command, "");
  assert.ok(isRunnable(button, built));
  // цель для диалога подтверждения и лога в консоли берётся из подстановок
  assert.strictEqual(built.vars.kind, "DaemonSet");
  assert.strictEqual(built.vars.name, "fluent-bit");
});

check("кнопка без команды и без type: logs по-прежнему не запускается", () => {
  const button = normalizeButton({ id: "x", scopes: ["DaemonSet"] }, 0);
  const scope = parseScope("DaemonSet");

  assert.ok(scope);

  const built = buildButtonCommand(
    DEFAULT_CONFIG,
    button,
    scope,
    { context: CONTEXT, namespace: "web", name: "fluent-bit", kind: "DaemonSet" },
    "/kubeconfig",
  );

  assert.ok(!isRunnable(button, built));
});

// ── остановленные поды и контейнеры ──────────────────────────────────────────

/** Цели пода так, как их отдаёт targetsFor: под плюс его контейнеры с флагом. */
function podWith(running: boolean, containers: { name: string; running: boolean }[]) {
  const object: Target = {
    context: CONTEXT,
    namespace: "web",
    pod: "worker-1",
    name: "worker-1",
    kind: "Pod",
    running,
  };

  return {
    object,
    containers: containers.map((container) => ({
      ...object,
      container: container.name,
      name: container.name,
      running: container.running,
    })),
  };
}

const withButton = (over: Record<string, unknown>) =>
  withConfig({ buttons: [normalizeButton({ id: "b", scopes: ["containers", "pods"], ...over }, 0)] });

check("по умолчанию кнопки нет ни на мёртвом поде, ни на мёртвом контейнере", () => {
  const config = withButton({ cmd: "kubectl exec" });
  const picked = pickButtons(config, "Pod", podWith(false, [{ name: "app", running: false }]));

  assert.deepStrictEqual(picked, []);
});

check("include_stopped показывает кнопку на упавшем поде вместе с контейнерами", () => {
  const config = withButton({ cmd: "kubectl logs", include_stopped: true });
  const picked = pickButtons(config, "Pod", podWith(false, [{ name: "app", running: false }]));

  assert.strictEqual(picked.length, 1);
  assert.deepStrictEqual(
    picked[0].targets.map((item) => item.container),
    [undefined, "app"],
  );
});

check("у живого пода мёртвый контейнер отсеивается, если не просили обратного", () => {
  const targets = podWith(true, [
    { name: "app", running: true },
    { name: "init-db", running: false },
  ]);
  const alive = pickButtons(withButton({ cmd: "x" }), "Pod", targets);
  const all = pickButtons(withButton({ cmd: "x", include_stopped: true }), "Pod", targets);

  assert.deepStrictEqual(
    alive[0].targets.map((item) => item.container),
    [undefined, "app"],
  );
  assert.deepStrictEqual(
    all[0].targets.map((item) => item.container),
    [undefined, "app", "init-db"],
  );
});

check("шелл на завершённой джобе: пода нет в живых — кнопки нет", () => {
  const config = withConfig({
    buttons: [normalizeButton({ id: "shell", scopes: ["containers"], cmd: "kubectl exec" }, 0)],
  });

  assert.deepStrictEqual(
    pickButtons(config, "Pod", podWith(false, [{ name: "app", running: false }])),
    [],
  );
});
