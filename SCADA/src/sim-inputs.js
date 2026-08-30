export const SIM_PROFILE = [221, 4001];
export const SIM_INPUTS = Object.freeze({
  commissioning: { address: 5, label: 'Commissioning OK (simulator)', physical: '%M5' },
  safety: { address: 300, label: 'Safety OK (simulator)', physical: '%I0.0' },
  overload1: { address: 307, label: 'Overload G1 OK (simulator)', physical: '%I0.7' },
  overload2: { address: 308, label: 'Overload G2 OK (simulator)', physical: '%I0.8' },
  overload3: { address: 309, label: 'Overload G3 OK (simulator)', physical: '%I0.9' },
  auto: { address: 344, label: 'Mode AUTO (simulator)', physical: '%I1.24' },
  run: { address: 370, label: 'ENABLE / STOP request', physical: 'SIM_RUN_REQUEST' },
  limitClose1: { address: 301, label: 'Limit CLOSE G1', physical: '%I0.1' },
  limitOpen1: { address: 302, label: 'Limit OPEN G1', physical: '%I0.2' },
  limitClose2: { address: 303, label: 'Limit CLOSE G2', physical: '%I0.3' },
  limitOpen2: { address: 304, label: 'Limit OPEN G2', physical: '%I0.4' },
  limitClose3: { address: 305, label: 'Limit CLOSE G3', physical: '%I0.5' },
  limitOpen3: { address: 306, label: 'Limit OPEN G3', physical: '%I0.6' },
  reset: { address: 351, label: 'Reset fault (kembalikan OFF setelah reset)', physical: '%I1.31' }
});
export function hasSimProfile(words) { return SIM_PROFILE.every((value, i) => words[110 + i] === value); }
export function decodeSimInputs(words, coils) {
  if (!hasSimProfile(words)) return { compatible: false, values: {}, outputs: [] };
  return {
    compatible: true,
    values: Object.fromEntries(Object.entries(SIM_INPUTS).map(([name, tag]) => [name, Boolean(coils[tag.address])])),
    outputs: [1,2,3].map(id => ({ id, open: Boolean(coils[358 + id*2]), close: Boolean(coils[359 + id*2]) }))
  };
}
export function getSimInput(name) {
  if (!Object.hasOwn(SIM_INPUTS, name)) throw new Error('Input simulator tidak diizinkan');
  return SIM_INPUTS[name];
}
