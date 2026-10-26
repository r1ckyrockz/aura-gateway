import { entity, testConfig } from '../testing/fixtures';
import { PolicyService } from './policy.service';

describe('PolicyService', () => {
  const policy = new PolicyService(testConfig());

  describe('resolve', () => {
    it('prefers an identified speaker over the room', () => {
      const p = policy.resolve({ speaker: 'alex', room: 'kids_room' });
      expect(p.profileName).toBe('adult');
      expect(p.resolvedBy).toBe('speaker');
    });

    it('falls back to room rights for unknown speakers (normalised area names)', () => {
      const p = policy.resolve({ speaker: 'unknown', room: 'kids-room' });
      expect(p.profileName).toBe('child');
      expect(p.resolvedBy).toBe('room');
    });

    it('maps API clients to profiles', () => {
      expect(policy.resolve({ client: 'abc123' }).profileName).toBe('viewer');
    });

    it('uses the default profile otherwise', () => {
      expect(policy.resolve({}).resolvedBy).toBe('default');
    });
  });

  describe('canControl', () => {
    it('allows everything for wildcard profiles and flags confirm domains', () => {
      const adult = policy.resolve({ speaker: 'alex' });
      expect(policy.canControl(adult, entity('light.kitchen'))).toEqual({
        allowed: true,
        requiresConfirmation: false,
      });
      expect(policy.canControl(adult, entity('lock.front_door'))).toEqual({
        allowed: true,
        requiresConfirmation: true,
      });
    });

    it('limits children to their own room via $room', () => {
      const child = policy.resolve({ room: 'Kids Room' });
      expect(policy.canControl(child, entity('light.kids', 'kids room')).allowed).toBe(true);
      expect(policy.canControl(child, entity('light.living', 'Living Room')).allowed).toBe(false);
      expect(policy.canControl(child, entity('cover.kids', 'Kids Room')).allowed).toBe(false);
    });

    it('respects denyEntities for reading and control', () => {
      const child = policy.resolve({ room: 'Kids Room' });
      expect(policy.canRead(child, entity('media_player.tv'))).toBe(false);
      expect(policy.canControl(child, entity('media_player.tv', 'Kids Room')).allowed).toBe(false);
    });

    it('requires confirmation for confirmEntities patterns, whatever the domain', () => {
      const strict = new PolicyService(
        testConfig({
          policy: { ...testConfig().policy, confirmEntities: ['name:*Door*relay', 'switch.car_*'] },
        }),
      );
      const adult = strict.resolve({ speaker: 'alex' });
      const relay = { ...entity('switch.haustuere_door_1_relay'), name: 'Haustuere Door 1 relay' };
      expect(strict.canControl(adult, relay)).toEqual({
        allowed: true,
        requiresConfirmation: true,
      });
      expect(strict.canControl(adult, entity('switch.car_doorlock'))).toEqual({
        allowed: true,
        requiresConfirmation: true,
      });
      expect(strict.canControl(adult, entity('switch.coffee'))).toEqual({
        allowed: true,
        requiresConfirmation: false,
      });
    });

    it('supports patterns in denyEntities', () => {
      const strict = new PolicyService(
        testConfig({
          policy: {
            ...testConfig().policy,
            profiles: {
              ...testConfig().policy.profiles,
              guest: { allowDomains: ['*'], denyEntities: ['name:*heizung'] },
            },
          },
        }),
      );
      const guest = strict.resolve({});
      expect(strict.canRead(guest, { ...entity('switch.x'), name: 'Bad Deckenheizung' })).toBe(
        false,
      );
      expect(strict.canRead(guest, { ...entity('switch.y'), name: 'Bad Licht' })).toBe(true);
    });

    it('blocks read-only profiles', () => {
      const viewer = policy.resolve({ client: 'abc123' });
      const decision = policy.canControl(viewer, entity('light.kitchen'));
      expect(decision).toEqual({ allowed: false, reason: expect.stringContaining('read-only') });
    });
  });
});
