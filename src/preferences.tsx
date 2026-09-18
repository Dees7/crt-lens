import React from "react";
import { Renderer } from "@freelensapp/extensions";
import * as yaml from "js-yaml";

import { buildButtonCommand } from "./command";
import {
  configPath,
  CrtLensConfig,
  defaultConfigYaml,
  loadConfig,
  readConfigYaml,
  saveConfigYaml,
} from "./config";
import { refreshConfig } from "./config-store";
import { installExamples } from "./examples";
import { chooseTerminal, isProblem } from "./launch/terminals";
import { pickButtons, Resolved, Target } from "./match";
import { activeCluster, ClusterInfo } from "./menu-common";
import { scopeRegistrations } from "./scopes";
import styles from "./styles.module.css";
import { validateConfig } from "./validate";

const {
  Component: { Button },
} = Renderer;

/** Моноширинный фрагмент в цветах темы — чтобы не белел на тёмной теме. */
function Mono(props: { children: React.ReactNode }) {
  return <span className={styles.mono}>{props.children}</span>;
}

export function CrtLensPreferenceHint() {
  return (
    <span className={styles.hint}>
      Кнопки-плагины в меню объектов кластера: каждая запись <Mono>buttons</Mono> — отдельный
      пункт меню со своим действием. <Mono>type: local</Mono> открывает терминал в доке,{" "}
      <Mono>type: ext</Mono> — внешний терминал по пресету из <Mono>terminals</Mono>,{" "}
      <Mono>type: url</Mono> — ссылку в браузере.
      <br />
      Где кнопка видна, решает <Mono>scopes</Mono> (<Mono>containers</Mono>, <Mono>pods</Mono>,{" "}
      <Mono>nodes</Mono>, <Mono>namespaces</Mono> или kind), а значения подбирают{" "}
      <Mono>rules</Mono> по маскам — выигрывает самое специфичное правило. Идентификаторы
      окружений для ссылок лежат в <Mono>vars</Mono> и подбираются теми же масками.
      <br />
      <Mono>column: true</Mono> добавляет кнопку ещё и колонкой в список объектов — по колонке
      на каждый kind из её <Mono>scopes</Mono> (скрыть её можно шестерёнкой в шапке таблицы).
      <br />
      Конфиг лежит в <Mono>{configPath()}</Mono>, его можно править и руками. Новый kind в{" "}
      <Mono>scopes</Mono> и новая колонка видны после перезагрузки окна (Cmd+R).
      <br />
      Пресету <Mono>crt</Mono> нужна разовая ручная установка сессии SecureCRT — кнопка
      «Разложить примеры SecureCRT» готовит файлы и печатает, что с ними сделать.
    </span>
  );
}

/** Примерные объекты, на которых считается превью. */
function sampleTargets(
  kind: string,
  cluster: ClusterInfo,
): { containers: Target[]; object: Target } {
  const base: Target = { context: cluster.context, kubeVersion: cluster.kubeVersion, kind };

  if (kind === "Node") {
    return {
      containers: [],
      object: { ...base, node: "example-node-0", name: "example-node-0" },
    };
  }

  if (kind === "Namespace") {
    return { containers: [], object: { ...base, namespace: "default", name: "default" } };
  }

  if (kind === "Pod") {
    const pod: Target = {
      ...base,
      namespace: "default",
      pod: "example-pod-0",
      name: "example-pod-0",
    };

    return {
      containers: [{ ...pod, container: "app", name: "app" }],
      object: pod,
    };
  }

  return {
    containers: [],
    object: { ...base, namespace: "default", name: `example-${kind.toLowerCase()}` },
  };
}

function ruleLine(label: string, resolved: Resolved<string>): string {
  return resolved.rule
    ? `    ${label}: правило #${resolved.index} ${JSON.stringify(resolved.rule)}`
    : `    ${label}: ${resolved.value ? "дефолт" : "не задано"}`;
}

/** Строчка про терминалы: что описано и что из этого нашлось на машине. */
function terminalsLine(config: CrtLensConfig): string {
  const auto = chooseTerminal(config, "");
  const names = Object.keys(config.terminals).join(", ");

  return isProblem(auto)
    ? `терминалы: ${names || "нет ни одного"} — автоопределение: ${auto.problem}`
    : `терминалы: ${names} — автоопределение выбрало ${auto.name} (задание ${auto.flavor})`;
}

function previewFor(config: CrtLensConfig, cluster: ClusterInfo): string[] {
  const head = [
    `кластер: контекст ${cluster.context}, версия ${cluster.kubeVersion || "неизвестна"}`,
    terminalsLine(config),
  ];
  const lines: string[] = [];

  for (const { kind } of scopeRegistrations(config)) {
    const targets = sampleTargets(kind, cluster);

    for (const item of pickButtons(config, kind, targets)) {
      const built = buildButtonCommand(
        config,
        item.button,
        item.scope,
        item.targets[0],
        cluster.kubeconfig,
      );
      const where =
        item.button.type === "ext" ? `ext:${built.terminal.value || "auto"}` : item.button.type;

      lines.push(
        `[${item.button.id}] ${kind}/${item.scope.raw} ${where}` +
          `${item.button.confirm ? " confirm" : ""}${item.button.input ? " input" : ""}` +
          `${item.button.column ? " column" : ""}` +
          `${item.button.include_stopped ? " stopped" : ""}  «${built.title}»`,
      );

      if (built.problem) {
        lines.push(`    ! ${built.problem}`);
      }

      if (item.button.type === "url") {
        lines.push(
          `    ${built.url || "ссылку взять неоткуда — задайте url"}`,
          ruleLine("ссылка", built.urlRule),
        );

        if (built.vars.query) {
          lines.push(`    селектор: ${built.vars.query}`, ruleLine("селектор", built.queryRule));
        }

        continue;
      }

      lines.push(
        `    ${built.command || "команду взять неоткуда — задайте cmd"}`,
        ruleLine("команда", built.cmd),
        ruleLine("шелл", built.shell),
      );

      if (kind === "Node") {
        lines.push(ruleLine("образ", built.image));
      }
    }
  }

  if (lines.length === 0) {
    lines.push("ни одна кнопка не подошла к примерным объектам");
  }

  return [...head, ...lines];
}

/** Что получится для примера — по текущему кластеру и сохранённому конфигу. */
function preview(): string[] {
  const cluster = activeCluster();

  try {
    const config = loadConfig();
    const problems = validateConfig(yaml.load(readConfigYaml()));
    const head = problems.map((problem) => `! ${problem}`);

    if (!cluster) {
      return [...head, "нет активного кластера — команды посчитать не на чем"];
    }

    return [...head, ...previewFor(config, cluster)];
  } catch (error) {
    return [`не посчитал превью: ${String(error)}`];
  }
}

export function CrtLensPreferenceInput() {
  const [text, setText] = React.useState<string>(() => {
    try {
      return readConfigYaml();
    } catch {
      return defaultConfigYaml();
    }
  });
  const [status, setStatus] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [lines, setLines] = React.useState<string[]>(() => preview());

  const save = () => {
    try {
      saveConfigYaml(text);
      // колонки списка живут от observable — без этого они ждали бы опроса файла
      refreshConfig();

      const problems = validateConfig(yaml.load(text));

      setStatus({
        ok: problems.length === 0,
        message: problems.length
          ? `Сохранено в ${configPath()}, но есть замечания — смотри ниже`
          : `Сохранено в ${configPath()}`,
      });
      setLines(preview());
    } catch (error) {
      setStatus({ ok: false, message: `Не сохранил: ${String(error)}` });
    }
  };

  const reload = () => {
    try {
      setText(readConfigYaml());
      setStatus({ ok: true, message: "Перечитал файл с диска" });
      setLines(preview());
    } catch (error) {
      setStatus({ ok: false, message: `Не прочитал: ${String(error)}` });
    }
  };

  const reset = () => {
    setText(defaultConfigYaml());
    setStatus({ ok: true, message: "Подставил дефолты — нажми «Сохранить», чтобы записать" });
  };

  /** Разложить примеры SecureCRT. Настройки самого SecureCRT при этом не трогаются. */
  const examples = () => {
    try {
      const files = installExamples();
      const session = files.find((file) => file.endsWith(".ini"));

      setStatus({
        ok: true,
        message:
          `Разложил файлы рядом: ${session}. Осталось скопировать .ini в каталог сессий ` +
          "SecureCRT и включить Single Instance — как именно, написано в README.md рядом с ними.",
      });
    } catch (error) {
      setStatus({ ok: false, message: `Не разложил: ${String(error)}` });
    }
  };

  return (
    <div className={styles.editor}>
      <textarea
        className={styles.textarea}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.row}>
        <Button primary label="Сохранить" onClick={save} />
        <Button plain label="Перечитать" onClick={reload} />
        <Button plain label="Дефолты" onClick={reset} />
        <Button plain label="Разложить примеры SecureCRT" onClick={examples} />
      </div>
      {status && <div className={status.ok ? styles.ok : styles.error}>{status.message}</div>}
      <div className={styles.preview}>{lines.join("\n")}</div>
    </div>
  );
}
