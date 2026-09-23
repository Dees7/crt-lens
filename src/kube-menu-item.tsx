import React from "react";
import { Renderer } from "@freelensapp/extensions";

import { buildButtonCommand, BuiltCommand, isRunnable } from "./command";
import { CrtLensConfig } from "./config";
import { pickButtons, PickedButton, Target } from "./match";
import { activeCluster, ClusterInfo, loadConfigSafe, MenuLabel } from "./menu-common";
import { runButton } from "./run";
import styles from "./styles.module.css";

const {
  Component: { Icon, MenuItem, StatusBrick, SubMenu },
} = Renderer;

type KubeObject = Renderer.K8sApi.KubeObject;
type Pod = Renderer.K8sApi.Pod;

const DEFAULT_CONTAINER_ANNOTATION = "kubectl.kubernetes.io/default-container";

/**
 * Контейнеры пода в том порядке, в каком их показывать.
 *
 * Берём все — обычные, init и ephemeral, — потому что отсеивать мёртвые
 * должна кнопка, а не этот список: в шелл к остановленному контейнеру не
 * зайти, а логи у него есть. Кто именно бежит, видно по флагу `running`
 * у цели.
 *
 * Первым ставим контейнер из аннотации default-container: именно его открывает
 * клик по самому пункту меню (когда кнопка целится в контейнеры).
 */
export function podContainers(pod: Pod): { name: string; running: boolean }[] {
  const running = new Set(pod.getRunningContainers().map((container) => container.name));
  const names = pod.getAllContainers().map((container) => container.name);
  const preferred = pod.metadata?.annotations?.[DEFAULT_CONTAINER_ANNOTATION];
  const ordered =
    preferred && names.includes(preferred)
      ? [preferred, ...names.filter((name) => name !== preferred)]
      : names;

  return ordered.map((name) => ({ name, running: running.has(name) }));
}

/**
 * Класс кирпича-статуса рядом с именем контейнера.
 *
 * Классы — те же, что приложение ставит в панели деталей пода
 * (`container-status-class-name.tsx`), потому что и стили на них те же:
 * `running` — зелёный, `restarted` — зелёный с ободком, `waiting` —
 * оранжевый, `terminated` — пустой контур. Без класса кирпич серый
 * (`--colorVague`), то есть выглядит остановленным всегда.
 *
 * С тех пор как кнопка может показываться и на мёртвом поде, сюда попадают
 * все состояния, а не только running.
 */
export function containerBrickClass(pod: Pod, container: string): string {
  const status = pod.getContainerStatuses(true, true).find((item) => item.name === container);

  if (!status) return "terminated";

  const state = Object.keys(status.state ?? {})[0];

  if (state === "terminated") return "terminated";
  if (status.ready && status.restartCount > 0) return "restarted";
  if (status.ready) return "running";
  if (state === "running") return "waiting";

  return state ?? "waiting";
}

/**
 * Цели для объекта: одна на сам объект и по одной на каждый контейнер.
 *
 * Флаг `running` проставляется там, где он есть смысл (под и его контейнеры);
 * по нему кнопка решает, показываться ли на остановленном — см.
 * `include_stopped` в конфиге.
 */
export function targetsFor(
  object: KubeObject,
  cluster: ClusterInfo,
): { containers: Target[]; object: Target } {
  const name = object.getName();
  const base: Target = {
    context: cluster.context,
    kubeVersion: cluster.kubeVersion,
    kind: object.kind,
    apiVersion: object.apiVersion,
    name,
  };

  if (object.kind === "Node") {
    const providerId = (object as KubeObject & { spec?: { providerID?: string } }).spec?.providerID;

    return { containers: [], object: { ...base, node: name, providerId } };
  }

  if (object.kind === "Namespace") {
    return { containers: [], object: { ...base, namespace: name } };
  }

  if (object.kind !== "Pod") {
    return { containers: [], object: { ...base, namespace: object.getNs() } };
  }

  const pod = object as Pod;
  const podTarget: Target = {
    ...base,
    namespace: pod.getNs(),
    pod: name,
    running: String(pod.getStatus()) === "Running",
  };

  return {
    containers: podContainers(pod).map((container) => ({
      ...podTarget,
      container: container.name,
      name: container.name,
      running: container.running,
    })),
    object: podTarget,
  };
}

export interface Run {
  target: Target;
  built: BuiltCommand;
}

function ButtonMenuItem(props: {
  config: CrtLensConfig;
  picked: PickedButton;
  object: KubeObject;
  pod?: Pod;
  runs: Run[];
  toolbar?: boolean;
}) {
  const { config, picked, object, pod, runs, toolbar } = props;
  const { button, scope } = picked;
  const start = (run: Run) => runButton(config, button, run.built, object);
  const containerRuns = runs.filter((run) => run.target.container !== undefined);
  // клик по пункту открывает под целиком — значит контейнеры нужны в подменю все,
  // даже если контейнер один; иначе первый контейнер и есть сам пункт
  const podRunFirst = runs[0]?.target.container === undefined;
  const showSubmenu =
    scope.containers && (podRunFirst ? containerRuns.length > 0 : containerRuns.length > 1);

  return (
    <MenuItem onClick={() => start(runs[0])}>
      <MenuLabel config={config} button={button} toolbar={toolbar} />
      {showSubmenu && (
        <>
          <Icon className="arrow" material="keyboard_arrow_right" />
          <SubMenu>
            {containerRuns.map((run) => (
              <MenuItem
                key={run.target.container}
                className={styles.row}
                onClick={(event: React.MouseEvent) => {
                  // без этого сработает и обработчик родительского пункта — откроются две вкладки
                  event.stopPropagation();
                  start(run);
                }}
              >
                <StatusBrick
                  className={pod ? containerBrickClass(pod, run.target.container ?? "") : undefined}
                />
                {/*
                  className="title" здесь ставить нельзя: в панели деталей Lens прячет всё
                  подряд правилом `.MenuActions.toolbar .title { display: none }`, и подменю
                  превращается в пустой прямоугольник. Так же сделано в openlens-node-pod-menu.
                */}
                <span>{run.target.container}</span>
              </MenuItem>
            ))}
          </SubMenu>
        </>
      )}
    </MenuItem>
  );
}

/**
 * Готовые команды кнопки по всем её целям.
 *
 * Отсеиваются те, которым нечего открывать: пустая команда (её взять неоткуда),
 * пустая ссылка (не задан `url` или не нашлись переменные окружения) и кнопка
 * `ext`, для которой не удалось выбрать терминал.
 */
export function runsFor(
  config: CrtLensConfig,
  picked: PickedButton,
  cluster: ClusterInfo,
): Run[] {
  return picked.targets
    .map((target) => ({
      target,
      built: buildButtonCommand(config, picked.button, picked.scope, target, cluster.kubeconfig),
    }))
    .filter((run) => run.built.problem === undefined && isRunnable(picked.button, run.built));
}

/**
 * Почему кнопку не нарисовали — одной строкой в devtools.
 *
 * Считается только для пропущенных кнопок, поэтому лишней работы на каждый
 * рендер меню не добавляет.
 */
export function skipReason(
  config: CrtLensConfig,
  picked: PickedButton,
  cluster: ClusterInfo,
): string {
  const target = picked.targets[0];

  if (!target) return "no matching target was found";

  const built = buildButtonCommand(config, picked.button, picked.scope, target, cluster.kubeconfig);

  if (built.problem) return built.problem;

  return picked.button.type === "url"
    ? "empty link — set url and check that the context has an entry in vars"
    : "nowhere to take the command from — set cmd";
}

/**
 * Все кнопки, подходящие этому объекту, одним фрагментом.
 *
 * Lens рендерит компоненты регистраций как детей MenuActions, а MenuItem
 * цепляется к меню через контекст, поэтому вернуть несколько пунктов можно.
 */
export function CrtMenuItems(props: Renderer.Component.KubeObjectMenuProps<KubeObject>) {
  const { object, toolbar } = props;

  if (!object) return null;

  const cluster = activeCluster();

  if (!cluster) {
    console.warn("[crt-lens] no active cluster, or its kubeconfigContext is empty");

    return null;
  }

  const config = loadConfigSafe();

  if (!config) return null;

  const targets = targetsFor(object, cluster);
  const items = pickButtons(config, object.kind, targets)
    .map((picked) => ({ picked, runs: runsFor(config, picked, cluster) }))
    .filter((item) => {
      if (item.runs.length > 0) return true;

      console.warn(
        `[crt-lens] button ${item.picked.button.id}: nothing to open in scope ${item.picked.scope.raw} — ` +
          `${skipReason(config, item.picked, cluster)}`,
      );

      return false;
    });

  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => (
        <ButtonMenuItem
          key={item.picked.button.id}
          config={config}
          picked={item.picked}
          object={object}
          pod={object.kind === "Pod" ? (object as Pod) : undefined}
          runs={item.runs}
          toolbar={toolbar}
        />
      ))}
    </>
  );
}
