/**
 * Кнопка `type: logs`: логи в штатном доке Freelens.
 *
 * Здесь только выбор — чьи поды, какой под и какой контейнер; сам таб открывает
 * `run.tsx`. Из-за этого модуль не трогает `Renderer` в рантайме (только тип), и
 * его можно проверять тестами без приложения.
 *
 * Таб всегда открывается через `logTabStore.createPodTab`, даже для воркоада:
 * владельцем таба становится `ownerRefs[0]` пода, а встроенный селектор логов
 * показывает всех соседей по этому владельцу. Для DaemonSet, StatefulSet и Job
 * это сам объект, для Deployment — его ReplicaSet, то есть поды текущей
 * ревизии. Так один и тот же путь закрывает все kind'ы, а `createWorkloadTab`
 * не нужен: он всё равно возвращает undefined, пока стор подов не загружен.
 */
import type { Renderer } from "@freelensapp/extensions";

type KubeObject = Renderer.K8sApi.KubeObject;
type Pod = Renderer.K8sApi.Pod;

/**
 * Контейнер пода: обычный или ephemeral.
 *
 * `createPodTab` просит `Container`, а `getAllContainers` отдаёт объединение с
 * `EphemeralContainer` — он наследует `Container`, так что объединение туда
 * подходит целиком. Тип берётся из возвращаемого значения, потому что сам
 * `Container` в публичных типах расширений по имени не экспортирован.
 */
export type PodContainer = ReturnType<Pod["getAllContainers"]>[number];

/** Контейнер, который kubectl считает основным: его же открывает клик по кнопке. */
export const DEFAULT_CONTAINER_ANNOTATION = "kubectl.kubernetes.io/default-container";

/**
 * Через кого объект владеет подами, если не напрямую.
 *
 * Поды ссылаются в `ownerReferences` на ближайшего владельца, а не на верхний
 * воркоад: у Deployment это ReplicaSet, у CronJob — Job. Для остальных kind'ов
 * промежуточного звена нет, и поды находятся по uid самого объекта.
 */
export const OWNER_CHAIN: Record<string, "ReplicaSet" | "Job"> = {
  Deployment: "ReplicaSet",
  CronJob: "Job",
};

/** Kind'ы, у которых есть поды: только им есть что показать в логах. */
export const LOG_KINDS = [
  "Pod",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
  "CronJob",
];

export function logsKindSupported(kind: string): boolean {
  return LOG_KINDS.includes(kind);
}

/** Владельца ищем по uid: имена в разных kind'ах совпадают, uid — нет. */
export function ownedByAny(object: KubeObject, ownerIds: Set<string>): boolean {
  return object.getOwnerRefs().some((owner) => ownerIds.has(owner.uid));
}

/**
 * Под, с которого открыть таб: самый свежий из бегущих.
 *
 * Свежий — потому что на выкате у Deployment живы поды обеих ревизий, и нужна
 * новая, а не доживающая старая (владельцем таба станет её ReplicaSet, то есть
 * и выпадашка будет про новую ревизию). Бегущий — потому что терминирующийся
 * под отдаст логи и оборвётся. Живых нет вовсе — открываем самый свежий: логи
 * упавшего пода как раз и нужны. Остальные поды никуда не деваются, они в
 * выпадашке самого таба.
 */
export function pickPod(pods: Pod[]): Pod | undefined {
  const newestFirst = [...pods].sort((left, right) => {
    const age = created(right).localeCompare(created(left));

    // без таймстемпа (или при равном) — по имени, чтобы выбор не зависел от порядка ответа
    return age !== 0 ? age : left.getName().localeCompare(right.getName());
  });

  return newestFirst.find((pod) => String(pod.getStatus()) === "Running") ?? newestFirst[0];
}

/** Время создания в ISO-8601: строки этого формата сравниваются как даты. */
function created(pod: Pod): string {
  return pod.metadata?.creationTimestamp ?? "";
}

/**
 * Контейнер, на котором открыть таб: запрошенный, иначе основной, иначе первый.
 *
 * `wanted` приходит из scope `containers` — там кнопка целится в конкретный
 * контейнер. Пода из выпадашки это не касается: контейнер в табе потом
 * переключается своим селектором.
 */
export function pickContainer(pod: Pod, wanted?: string): PodContainer | undefined {
  const containers = pod.getAllContainers();

  if (wanted) {
    const exact = containers.find((container) => container.name === wanted);

    if (exact) return exact;
  }

  const preferred = pod.metadata?.annotations?.[DEFAULT_CONTAINER_ANNOTATION];

  return containers.find((container) => container.name === preferred) ?? containers[0];
}
