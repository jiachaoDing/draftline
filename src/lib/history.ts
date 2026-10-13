export type History<T> = { items: T[]; index: number };
export function pushHistory<T>(history: History<T>, item: T): History<T> {
  const items = [...history.items.slice(0, history.index + 1), item].slice(-30);
  return { items, index: items.length - 1 };
}
