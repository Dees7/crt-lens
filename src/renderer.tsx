import { Renderer } from "@freelensapp/extensions";

import { CrtLensConfig, DEFAULT_CONFIG, loadConfig } from "./config";
import { CrtMenuItems } from "./kube-menu-item";
import { crtColumns } from "./list-columns";
import { CrtLensPreferenceHint, CrtLensPreferenceInput } from "./preferences";
import { scopeRegistrations } from "./scopes";

type KubeObject = Renderer.K8sApi.KubeObject;

/** Конфиг на старте: битый файл не должен мешать расширению загрузиться. */
function startupConfig(): CrtLensConfig {
  try {
    return loadConfig();
  } catch (error) {
    console.warn("[crt-lens] could not read the config at startup:", error);

    return DEFAULT_CONFIG;
  }
}

/**
 * Kind'ы из конфига плюс Pod/Node/Namespace.
 *
 * `kubeObjectMenuItems` читается один раз при загрузке расширения, поэтому
 * набор kind'ов фиксируется на старте: новая кнопка и новое правило подхватятся
 * сразу (конфиг перечитывается на каждый рендер меню), а новый kind — только
 * после перезагрузки окна.
 */
function registrations() {
  return scopeRegistrations(startupConfig());
}

export default class CrtLensExtensionRenderer extends Renderer.LensExtension {
  /**
   * Колонки-кнопки в списке объектов — по одной на кнопку с `column: true`
   * и на каждый kind из её `scopes`.
   *
   * `kubeObjectListLayoutColumns` — точка нашего форка Freelens; на сборке без
   * этого патча поле класса молча игнорируется, а пункты меню работают как
   * раньше.
   */
  kubeObjectListLayoutColumns = crtColumns(startupConfig());

  kubeObjectMenuItems = registrations().map(({ kind, apiVersions }) => ({
    kind,
    apiVersions,
    components: {
      MenuItem: (props: Renderer.Component.KubeObjectMenuProps<KubeObject>) => (
        <CrtMenuItems {...props} />
      ),
    },
  }));

  appPreferences = [
    {
      title: "crt-lens",
      components: {
        Hint: () => <CrtLensPreferenceHint />,
        Input: () => <CrtLensPreferenceInput />,
      },
    },
  ];
}
