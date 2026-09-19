import React from "react";
import { Renderer } from "@freelensapp/extensions";

import { ButtonSpec, CrtLensConfig, loadConfig } from "./config";
import { BUILTIN_ICONS, TERMINAL_ICON_SVG } from "./icon";

const {
  Component: { Icon },
} = Renderer;

export interface ClusterInfo {
  context: string;
  kubeconfig: string;
  /** Версия сервера, как её определил Lens: `v1.33.3`. Пусто — ещё не определилась */
  kubeVersion: string;
}

/** Контекст, kubeconfig и версия активного кластера. Их же Lens отдаёт своему терминалу. */
export function activeCluster(): ClusterInfo | undefined {
  try {
    const entity = Renderer.Catalog.activeCluster.get();
    const spec = entity?.spec as
      | { kubeconfigContext?: string; kubeconfigPath?: string }
      | undefined;
    const metadata = entity?.metadata as { kubeVersion?: string } | undefined;

    if (!spec?.kubeconfigContext) return undefined;

    return {
      context: spec.kubeconfigContext,
      kubeconfig: spec.kubeconfigPath ?? "",
      kubeVersion: metadata?.kubeVersion ?? "",
    };
  } catch (error) {
    return undefined;
  }
}

export function loadConfigSafe(): CrtLensConfig | undefined {
  try {
    return loadConfig();
  } catch (error) {
    console.warn("[crt-lens] could not read the config:", error);

    return undefined;
  }
}

/**
 * Иконка кнопки: `text:<глиф>`, `svg:<имя или xml>`, иначе имя material-иконки.
 * Пусто — своя иконка терминала.
 *
 * Глиф рисуется обычным текстом внутри `<i class="Icon">`, поэтому Nerd
 * Font-символ виден, только если такой шрифт есть в системе; шрифт задаётся
 * настройкой `icon_font`.
 */
export function ButtonIcon(props: {
  config: CrtLensConfig;
  button: ButtonSpec;
  toolbar?: boolean;
  /** Своя подсказка вместо `name` — например с контейнером, который откроется */
  tooltip?: string;
  /** Задан — иконка сама и есть кнопка: так она работает в колонке списка */
  onClick?: (event: React.MouseEvent) => void;
}) {
  const { icon } = props.button;
  // ни в тулбаре деталей, ни в колонке подписи нет — иконку объясняет только tooltip
  const interactive = props.toolbar === true || props.onClick !== undefined;
  const common = {
    interactive,
    tooltip: interactive ? props.tooltip ?? props.button.name : undefined,
    onClick: props.onClick,
    style: props.onClick ? { cursor: "pointer" } : undefined,
  };

  if (icon.startsWith("text:")) {
    return (
      <Icon
        {...common}
        style={{
          ...common.style,
          fontFamily: props.config.icon_font || "var(--font-monospace)",
        }}
      >
        {icon.slice("text:".length)}
      </Icon>
    );
  }

  if (icon.startsWith("svg:")) {
    const name = icon.slice("svg:".length);

    // имя из встроенного набора (`svg:chart`) разворачивается в свой XML,
    // всё остальное уходит в Icon как есть — именем иконки приложения или XML
    return <Icon {...common} svg={BUILTIN_ICONS[name] ?? name} />;
  }

  if (icon.includes("<svg")) {
    return <Icon {...common} svg={icon} />;
  }

  if (icon) {
    return <Icon {...common} material={icon} />;
  }

  return <Icon {...common} svg={TERMINAL_ICON_SVG} />;
}

/**
 * Заголовок пункта и иконка.
 *
 * Проп `title` у Icon для подсказки не годится: Icon рисует её именно по
 * `tooltip` (так же сделано в openlens-node-pod-menu).
 */
export function MenuLabel(props: {
  config: CrtLensConfig;
  button: ButtonSpec;
  toolbar?: boolean;
}) {
  return (
    <>
      <ButtonIcon config={props.config} button={props.button} toolbar={props.toolbar} />
      <span className="title">{props.button.name}</span>
    </>
  );
}
