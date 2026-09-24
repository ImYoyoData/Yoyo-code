/**
 * Provider 导航的默认落点决策。
 *
 * 不变量：选中键必须落在侧栏（左侧列表）键空间内，详情页才解析得到 NavItem 并渲染详情。
 *
 * 违反它的后果是静默的空态：右侧显示「暂未添加模型」，而 `selectedNodeKey === fallbackNodeKey`
 * 让上层 effect 认为已经落定，不会自愈。本分支没有账号体系，侧栏只有自定义供应商，
 * 但初始化优先级仍可能从账号时代的套餐项推导出 `start-plan` 预设键——那个键在这里没有对应项，
 * 所以候选键必须过滤，最后兜底到侧栏第一项（即第一个已配置的供应商）。
 *
 * 这里只做键的取舍，不依赖 React / 资源文件，便于单测覆盖。
 */
export function pickRenderableFallbackNodeKey(input: {
  /** 初始化优先级推导出的落点；可能指向侧栏里不存在、因而无法渲染的键。 */
  preferredNodeKey: string | null;
  /** 侧栏里真实存在的键，顺序即渲染顺序。 */
  sideNavigationNodeKeys: readonly string[];
}): string | null {
  const { preferredNodeKey, sideNavigationNodeKeys } = input;
  if (preferredNodeKey !== null && sideNavigationNodeKeys.includes(preferredNodeKey)) {
    return preferredNodeKey;
  }
  return sideNavigationNodeKeys[0] ?? null;
}
