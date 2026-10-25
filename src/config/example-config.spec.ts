import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseAuraConfig } from './load-config';

describe('examples/aura.config.yaml', () => {
  it('is a valid configuration', () => {
    const raw: unknown = parse(
      readFileSync(join(__dirname, '../../examples/aura.config.yaml'), 'utf8'),
    );
    const config = parseAuraConfig(raw);
    expect(config.policy.rooms['Kids Room']).toBe('child');
  });
});
