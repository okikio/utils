import * as state from './state.ts';
using source = state.create({ count: 1 });
using selected = state.select(source.reader, (value) => value.count);
const number: number = selected.get();
void number;
// @ts-expect-error A projection does not grant write authority.
selected.set(2);
using combined = state.combine([source.reader, selected] as const, ([value, count]) => value.count + count);
const sum: number = combined.get();
void sum;
