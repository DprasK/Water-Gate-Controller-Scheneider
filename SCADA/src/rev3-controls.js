export const REV3_PROFILE = [221, 3001];
// The current, inspected BEFORE_SIM_INPUTS project has the version rung removed.
// Opt into its exact [221, 0] marker only for this local Schneider simulator.
// This marker is compatibility checking, NOT authentication or a safety mechanism.
export function rev3ProfileFor(config = {}) {
  if (config.rev3ProfileVersion === undefined || config.rev3ProfileVersion === 3001) return REV3_PROFILE;
  if (config.rev3ProfileVersion !== 0 || config.host !== '127.0.0.1' || config.port !== 502 || (config.unitId ?? 1) !== 1) {
    throw new Error('Profil BEFORE_SIM_INPUTS tanpa versi hanya untuk simulator 127.0.0.1:502 Unit 1 yang sudah diperiksa');
  }
  return [221, 0];
}
export const REV3_CONTROLS = Object.freeze({
  commissioning: { address: 5, label: 'Commissioning OK', access: 'RW', physical: '%M5' },
  run: { address: 6, label: 'Izin gerak SCADA', access: 'RW', physical: '%M6 (1=STOP)', inverted: true }
});
export const REV3_INPUTS = Object.freeze({
  safety: { address: 300, label: 'Safety OK', physical: '%I0.0' },
  overload1: { address: 307, label: 'Overload G1 OK', physical: '%I0.7' },
  overload2: { address: 308, label: 'Overload G2 OK', physical: '%I0.8' },
  overload3: { address: 309, label: 'Overload G3 OK', physical: '%I0.9' },
  auto: { address: 344, label: 'Mode AUTO', physical: '%I1.24' },
  limitClose1: { address: 301, label: 'Limit CLOSE G1', physical: '%I0.1' },
  limitOpen1: { address: 302, label: 'Limit OPEN G1', physical: '%I0.2' },
  limitClose2: { address: 303, label: 'Limit CLOSE G2', physical: '%I0.3' },
  limitOpen2: { address: 304, label: 'Limit OPEN G2', physical: '%I0.4' },
  limitClose3: { address: 305, label: 'Limit CLOSE G3', physical: '%I0.5' },
  limitOpen3: { address: 306, label: 'Limit OPEN G3', physical: '%I0.6' },
  reset: { address: 351, label: 'Reset fault', physical: '%I1.31' }
});
export function hasRev3Profile(words, expected = REV3_PROFILE) { return expected.every((value, i) => words[110+i] === value); }
export function decodeRev3Controls(words, coils, expected = REV3_PROFILE) {
  if (!hasRev3Profile(words, expected)) return { compatible: false, values: {}, inputs: {}, blockers: [], outputs: [], profile: words.slice(110,112), expectedProfile: expected };
  const values = Object.fromEntries(Object.entries(REV3_CONTROLS).map(([name, tag]) => [name, tag.inverted ? !coils[tag.address] : Boolean(coils[tag.address])]));
  const inputs = Object.fromEntries(Object.entries(REV3_INPUTS).map(([name, tag]) => [name, Boolean(coils[tag.address])]));
  const blockers = ['safety','overload1','overload2','overload3'].filter(name => !inputs[name]).map(name => REV3_INPUTS[name].label);
  if (!values.commissioning) blockers.push('Commissioning belum OK');
  if (!values.run) blockers.push('SCADA STOP aktif');
  return { compatible: true, profile: words.slice(110,112), expectedProfile: expected, values, inputs, blockers,
    outputs: [1,2,3].map(id => ({ id, open: Boolean(coils[358+id*2]), close: Boolean(coils[359+id*2]) })) };
}
