/**
 * Тип точки расширения `kubeObjectListLayoutColumns` — кнопки прямо в строке
 * списка объектов.
 *
 * Точка живёт в патче форка Freelens и в апстрим не уехала, поэтому в
 * опубликованных типах 1.10.3 её нет: общий код (`src/list-columns.tsx`) берёт
 * тип как `Renderer.Component.KubeObjectListLayoutColumnRegistration`, а
 * компилятору взять его неоткуда. Дописываем недостающий член в тот самый
 * модуль, из которого собирается `Renderer.Component`, — так общий код
 * остаётся нетронутым, а объявление живёт только в этой ветке.
 *
 * Сборка и тесты от этого файла не зависят, он нужен только `npm run
 * type:check`. Определение скопировано с патча (ветка `cloudlogging-column`
 * форка, `kube-object-list-layout-column-registration.ts`) — при расхождении
 * править по нему.
 */

import type { KubeObject } from "@freelensapp/kube-object";
import type { SearchFilter, TableCellProps, TableSortCallback } from "@freelensapp/list-layout";
import type { StrictReactNode } from "@freelensapp/utilities";
import type { IComputedValue } from "mobx";

declare module "../node_modules/@freelensapp/core/static/build/library/src/extensions/renderer-api/components" {
  export interface KubeObjectListLayoutColumnRegistration<K extends KubeObject = KubeObject> {
    /** Уникален внутри kind: по нему работает меню «настроить колонки» */
    id: string;

    kind: string;
    apiVersions: string[];

    /** Чем больше, тем левее; встроенные колонки подов идут от 120 до 0 */
    priority: number;

    header: TableCellProps | undefined | null;
    content: (item: K) => StrictReactNode | TableCellProps;

    sortingCallBack?: TableSortCallback<K>;
    searchFilter?: SearchFilter<K>;

    /** Пока считается в false — колонки нет совсем */
    visible?: IComputedValue<boolean>;
  }
}

export {};
