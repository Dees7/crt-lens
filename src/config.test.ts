/**
 * Проверка примера конфига: он лежит отдельным файлом, попадает в поставку и
 * подставляется кнопкой «Дефолты», поэтому обязан разбираться без замечаний и
 * собирать рабочие команды со ссылками.
 */
import * as assert from "assert";
import * as yaml from "js-yaml";
import { test as check } from "vitest";

import { buildButtonCommand } from "./command";
import { defaultConfigYaml, normalizeConfig, sampleConfigPath } from "./config";
import { BUILTIN_ICONS } from "./icon";
import { pickButtons, Target } from "./match";
import { parseScope } from "./scopes";
import { validateConfig } from "./validate";

const PROD = "acme-eu-prod-1";
const raw = yaml.load(defaultConfigYaml());
const config = normalizeConfig(raw);

const target = (over: Partial<Target> = {}): Target => ({
  context: PROD,
  namespace: "backend",
  pod: "worker-1",
  container: "app",
  name: "app",
  kind: "Pod",
  ...over,
});

function button(id: string) {
  const found = config.buttons.find((candidate) => candidate.id === id);

  assert.ok(found, `в примере нет кнопки ${id}`);

  return found;
}

check("пример читается с диска, а не собирается из кода", () => {
  assert.ok(sampleConfigPath().endsWith("crt-lens.sample.yaml"));
  // первая строка файла — комментарий: дамп YAML такого не умеет
  assert.ok(defaultConfigYaml().startsWith("# crt-lens settings"));
});

check("пример разбирается и не даёт замечаний", () => {
  assert.deepStrictEqual(validateConfig(raw), []);
});

check("в примере есть шелл, логи внешние и в доке, дашборд, ВМ под нодой, debug и логи с фильтром", () => {
  assert.deepStrictEqual(
    config.buttons.map((item) => item.id),
    ["shell", "logs", "dock-logs", "mon", "gce-vm", "gke-node-logs", "debug", "wl-logs"],
  );
});

check("ВМ под нодой GKE: проект, зона и имя берутся из providerID, а не из vars", () => {
  const vm = button("gce-vm");

  assert.deepStrictEqual(vm.scopes, ["nodes"]);
  assert.ok(vm.url?.includes("zones/{{provider_2}}/instances/{{provider_3}}?project={{provider_1}}"));
});

check("кнопка логов воркоада спрашивает фильтр и дописывает его в команду", () => {
  const logs = button("wl-logs");

  // поле открывается заполненным — обычный запуск не требует ничего печатать
  assert.strictEqual(logs.input?.default, "| grep -i -E 'error|warn'");
  assert.strictEqual(logs.input?.required, false);
  assert.ok(logs.cmd?.endsWith("{{input}}"));
});

check("логи в доке не требуют ни команды, ни ссылки", () => {
  const logs = button("dock-logs");

  assert.strictEqual(logs.type, "logs");
  assert.strictEqual(logs.cmd, undefined);
  assert.strictEqual(logs.url, undefined);
  // воркоады важнее пода: у пода штатная кнопка Logs и так есть
  assert.ok(logs.scopes.includes("DaemonSet"));
  assert.ok(logs.scopes.includes("Deployment"));
});

check("кнопка шелла открывает SecureCRT", () => {
  const shell = button("shell");

  assert.strictEqual(shell.type, "ext");
  assert.strictEqual(shell.terminal, "crt");
  // пресеты в примере не перечислены — они встроенные, и мержатся к нему
  assert.ok(config.terminals.crt.darwin?.argv.includes("{{title}}"));
});

check("логи собирают ссылку по контейнеру", () => {
  const built = buildButtonCommand(config, button("logs"), parseScope("containers")!, target(), "");

  assert.ok(built.url.startsWith("https://logs.example.com/logs?query="));
  assert.ok(built.vars.query.includes('pod = "worker-1"'));
  assert.ok(built.vars.query.includes('container = "app"'));
});

check("логи по ноде уходят на метку ноды, а не на пустой под", () => {
  const node = target({ container: undefined, pod: undefined, node: "cp-01", name: "cp-01", kind: "Node" });
  const built = buildButtonCommand(config, button("logs"), parseScope("nodes")!, node, "");

  assert.ok(built.vars.query.includes('node = "cp-01"'));
  assert.ok(!built.vars.query.includes("pod ="));
});

check("у логов встроенная иконка-график, а не material", () => {
  assert.strictEqual(button("logs").icon, "svg:chart");
  assert.ok(BUILTIN_ICONS.chart.includes("<svg"));
});

check("логи на поде: пункт открывает под, подменю — контейнеры", () => {
  const object = target({ container: undefined, name: "worker-1" });
  const containers = ["app", "sidecar"].map((container) => target({ container, name: container }));
  const picked = pickButtons(config, "Pod", { containers, object });
  const logs = picked.find((item) => item.button.id === "logs");

  assert.ok(logs);
  // первый — сам под: именно его открывает клик по пункту и по иконке в строке
  assert.strictEqual(logs.targets[0].container, undefined);
  assert.deepStrictEqual(
    logs.targets.slice(1).map((item) => item.container),
    ["app", "sidecar"],
  );
});

check("у шелла первым идёт контейнер: scope pods он не объявлял", () => {
  const object = target({ container: undefined, name: "worker-1" });
  const containers = [target({ container: "app", name: "app" })];
  const shell = pickButtons(config, "Pod", { containers, object }).find(
    (item) => item.button.id === "shell",
  );

  assert.ok(shell);
  assert.strictEqual(shell.targets[0].container, "app");
});

check("логи по поду целиком не тянут пустой контейнер", () => {
  // у цели-пода поля container нет вовсе — ровно так его отдаёт targetsFor
  const pod = target({ container: undefined, name: "worker-1" });
  const built = buildButtonCommand(config, button("logs"), parseScope("pods")!, pod, "");

  assert.ok(built.vars.query.includes('pod = "worker-1"'));
  assert.ok(!built.vars.query.includes("container ="));
});

check("дашборд собирает ссылку на под", () => {
  const built = buildButtonCommand(config, button("mon"), parseScope("pods")!, target(), "");

  assert.strictEqual(
    built.url,
    "https://grafana.example.com/d/kubernetes-pods" +
      "?var-cluster=prod&var-namespace=backend&var-pod=worker-1&from=now-1d&to=now",
  );
});

check("узкая запись vars перекрывает общую только по своим ключам", () => {
  const dev = buildButtonCommand(
    config,
    button("logs"),
    parseScope("containers")!,
    target({ context: "acme-eu-dev-1" }),
    "",
  );
  const prod = buildButtonCommand(config, button("logs"), parseScope("containers")!, target(), "");

  assert.strictEqual(dev.vars.logs_project, "demo");
  assert.strictEqual(prod.vars.logs_project, "prod");
  // logs_base задан только в общей записи — его видно в обоих окружениях
  assert.strictEqual(prod.vars.logs_base, "https://logs.example.com");
});

check("правило про прод меняет образ debug", () => {
  const dev = buildButtonCommand(
    config,
    button("debug"),
    parseScope("containers")!,
    target({ context: "acme-eu-dev-1" }),
    "",
  );
  const prod = buildButtonCommand(config, button("debug"), parseScope("containers")!, target(), "");

  assert.ok(dev.command.includes("praqma/network-multitool:latest"));
  assert.ok(prod.command.includes("busybox:1.36"));
});
