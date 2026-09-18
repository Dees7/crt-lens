import React from "react";
import { Renderer } from "@freelensapp/extensions";
import { computed, IComputedValue } from "mobx";
import { observer } from "mobx-react";

import { CrtLensConfig } from "./config";
import { observedConfig, watchConfig } from "./config-store";
import { runsFor, targetsFor } from "./kube-menu-item";
import { clusterMasksApply, pickButtons } from "./match";
import { activeCluster, ButtonIcon, ClusterInfo } from "./menu-common";
import { runButton } from "./run";
import { columnScopes, ColumnScope } from "./scopes";

type KubeObject = Renderer.K8sApi.KubeObject;

/**
 * Регистрация колонки: поле `kubeObjectListLayoutColumns` класса расширения.
 *
 * Точка живёт в нашем форке Freelens (патч `kubeObjectListLayoutColumns`), но
 * тип у неё публичный и приезжает вместе с API расширений — описывать его
 * руками, как это было под Lens 1.x, больше не нужно.
 */
export type ColumnRegistration = Renderer.Component.KubeObjectListLayoutColumnRegistration<KubeObject>;

/** Класс ячейки и заголовка: по нему колонку можно найти в стилях и в тестах. */
function columnClassName(buttonId: string): string {
  return `crt-lens-${buttonId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/** Одна и та же кнопка в разных kind — один id: он обязан быть уникальным внутри kind. */
function columnId(buttonId: string): string {
  return `crt-lens-${buttonId}`;
}

/** Кнопка по id — с учётом того, что кнопок с одним id может быть несколько. */
function buttonWithColumn(config: CrtLensConfig, buttonId: string) {
  return config.buttons.find((button) => button.id === buttonId && button.column);
}

/**
 * Показывать ли колонку в этом кластере.
 *
 * Порядок чтения важен: сначала наблюдаемый активный кластер, потом конфиг.
 * Если выйти из computed раньше, чем прочитана хоть одна наблюдаемая величина,
 * зависимостей у него не останется и значение залипнет до перезапуска.
 *
 * Проверяются только маски уровня кластера (`context`, `kube_version`): маски
 * по имени пода или неймспейсу считаются уже в ячейке — на строке.
 */
function columnVisible(buttonId: string): IComputedValue<boolean> {
  return computed(() => {
    const cluster = activeCluster();
    const config = observedConfig();

    if (!cluster || !config) return false;

    const button = buttonWithColumn(config, buttonId);

    return button !== undefined && clusterMasksApply(button, cluster.context, cluster.kubeVersion);
  });
}

/** Что кнопка сделает на этой строке: первая цель, как и клик по пункту меню. */
function cellRun(
  config: CrtLensConfig,
  object: KubeObject,
  buttonId: string,
  cluster: ClusterInfo,
) {
  const picked = pickButtons(config, object.kind, targetsFor(object, cluster)).find(
    (candidate) => candidate.button.id === buttonId,
  );

  if (!picked) return undefined;

  const runs = runsFor(config, picked, cluster);

  if (runs.length === 0) return undefined;

  return { button: picked.button, run: runs[0], count: runs.length };
}

/**
 * Ячейка колонки.
 *
 * Строк в списке бывают сотни, и он перерисовывается на каждое обновление из
 * watch, поэтому на диск отсюда не ходим: конфиг берётся из observable
 * (`config-store`). Кнопка не подошла этой строке — ячейка пустая.
 *
 * `observer` нужен, чтобы правка конфига доезжала до уже нарисованных строк:
 * сам список перерисовывается только на изменения кубера.
 */
const ColumnCell = observer(function ColumnCell(props: {
  object: KubeObject;
  buttonId: string;
}) {
  const config = observedConfig();
  const cluster = activeCluster();

  if (!config || !cluster) return null;

  const found = cellRun(config, props.object, props.buttonId, cluster);

  if (!found) return null;

  const { button, run, count } = found;
  // у scope containers колонка открывает контейнер по умолчанию — остальные в меню
  const tooltip =
    count > 1 && run.target.container ? `${button.name}: ${run.target.container}` : button.name;

  return (
    <ButtonIcon
      config={config}
      button={button}
      tooltip={tooltip}
      onClick={(event: React.MouseEvent) => {
        // без этого вместе с запуском распахнётся панель деталей объекта
        event.stopPropagation();
        runButton(config, button, run.built, props.object);
      }}
    />
  );
});

/**
 * Заголовок колонки — та же иконка, что и в ячейке: подписи в шапке нет.
 *
 * Элемент заголовка создаётся один раз, при регистрации колонки, поэтому без
 * `observer` смена иконки в конфиге до шапки не доехала бы.
 */
const ColumnHeader = observer(function ColumnHeader(props: { buttonId: string }) {
  const config = observedConfig();
  const button = config && buttonWithColumn(config, props.buttonId);

  if (!config || !button) return null;

  return <ButtonIcon config={config} button={button} />;
});

/** Регистрации колонок по конфигу; порядок — как в конфиге, все правее встроенных. */
export function columnsFor(scopes: ColumnScope[]): ColumnRegistration[] {
  return scopes.map((scope, index) => ({
    id: columnId(scope.buttonId),
    kind: scope.kind,
    apiVersions: scope.apiVersions,
    priority: -1 - index,
    header: {
      title: <ColumnHeader buttonId={scope.buttonId} />,
      className: columnClassName(scope.buttonId),
      id: columnId(scope.buttonId),
    },
    content: (object: KubeObject) => (
      <ColumnCell object={object} buttonId={scope.buttonId} />
    ),
    visible: columnVisible(scope.buttonId),
  }));
}

/**
 * Колонки расширения.
 *
 * Набор колонок Lens читает один раз при загрузке расширения, поэтому он
 * считается по конфигу на старте: `column: true` у новой кнопки виден после
 * перезагрузки окна. Всё остальное — какая команда, видна ли колонка сейчас —
 * берётся из observable и обновляется без перезапуска.
 */
export function crtColumns(config: CrtLensConfig): ColumnRegistration[] {
  watchConfig();

  return columnsFor(columnScopes(config));
}
