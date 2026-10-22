import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Structural regression guard only: real WGSL compilation and GPU correctness
// remain part of the visible-browser verification journey.
export function checkRadixSync(source) {
  const code = source.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');
  assert.match(code, /atomicStore\(&smem\[lid\.x\], digit\); workgroupBarrier\(\); var count = 0u;/,
    'publish every digit before peer reads');
  assert.match(code, /kr\[i\] = \(count << 16u\) \| rank; workgroupBarrier\(\); } zero_smem\(lid\.x\);/,
    'finish peer reads before row overwrite or clearing');
  assert.match(code, /for \(var i = 0u; i < subgroup_count; i\+\+\) { for \(var j = 0u; j < rs_scatter_block_rows; j\+\+\) {/,
    'all invocations traverse every histogram row');
  assert.match(code, /kr\[j\] = prev \+ rank; } workgroupBarrier\(\); if subgroup_id == i && rank == count { histogram_store\(digit, \(prev \+ count\)\); } workgroupBarrier\(\);/,
    'histogram read and write barriers stay outside lane-dependent branches');
}

const shader = readFileSync(new URL('../src/sort/radix_sort.wgsl', import.meta.url), 'utf8');
checkRadixSync(shader);
for (const [pattern, label] of [
  [/atomicStore\(&smem\[lid\.x\], digit\);\s*\/\/[^\n]*\n\s*workgroupBarrier\(\);/, 'digit publication'],
  [/workgroupBarrier\(\);\s*if subgroup_id == i && rank == count/, 'histogram read phase'],
]) {
  assert.throws(() => checkRadixSync(shader.replace(pattern, match => match.replace('workgroupBarrier();', ''))),
    assert.AssertionError, `guard must reject missing ${label} barrier`);
}
console.log('radix synchronization structure: pass (including missing-barrier controls)');
