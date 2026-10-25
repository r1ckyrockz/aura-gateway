# Household policy

A family assistant needs rules that hold no matter what the model "thinks". AURA's policy engine decides **who is asking** and **what they may do**, and it runs in code, outside the LLM.

## 1. Who is asking: principal resolution

Every request carries some context. The first match wins:

| Order | Source                                        | Example                 | Config                  |
| ----- | --------------------------------------------- | ----------------------- | ----------------------- |
| 1     | Identified **speaker** (e.g. a voice profile) | `"speaker": "parent_1"` | `policy.speakers`       |
| 2     | **API client** (fingerprint of the key used)  | the wall-display key    | `policy.clients`        |
| 3     | **Room** of the request                       | `"room": "Kids Room"`   | `policy.rooms`          |
| 4     | Fallback                                      | —                       | `policy.defaultProfile` |

This supports a privacy-friendly setup where **only some household members enrol a voice profile**. Children, for example, never have one. Their requests are then handled by **room rights**: whatever is allowed in the room they're speaking in.

Room names are matched loosely: `Kids Room`, `kids_room` and `kids-room` are the same.

To get a client's fingerprint, take the first 12 hex characters of the SHA-256 of the key:

```bash
printf '%s' "$KEY" | sha256sum | cut -c1-12
```

## 2. What may they see?

- Only **exposed** entities exist for the model (`homeAssistant.exposure`).
- `denyEntities` hides individual entities from a profile.

## 3. What may they do?

Each service call is checked for every target entity:

1. The profile is not `readOnly`.
2. The entity is exposed and not in `denyEntities`.
3. The entity's domain is in `allowDomains` (or `*` is).
4. If the profile has `areas`, the entity's Home Assistant area is in that list. `$room` is replaced with the requesting room.
5. The service domain matches the entity's domain (or is `homeassistant`).
6. Targets are explicit `entity_id`s. `area_id`, `device_id`, `floor_id` and `label_id` in service data are rejected.

If any check fails, the tool returns `not_permitted` with a reason. The model is told to pass that on politely, and Home Assistant is never called.

## 4. Confirmations

For domains in `confirmDomains`, an allowed action is **held**:

```text
User:  "Unlock the front door."
AURA:  "Just to be sure: should I lock.unlock → Front Door? Please say yes or no."
User:  "Yes."
AURA:  "Done."
```

- Only a **short, clear yes** ("yes", "yes please", "ja", "mach es", …) runs it.
- A "no" cancels it. Any other sentence drops the held action and is handled as a new request.
- Held actions expire after `conversation.confirmationTtlSeconds`.
- Apps or satellite displays can show buttons and call `POST /v1/conversation/{id}/confirmation` with `{"approve": true}`.

Follow-ups need the same `conversationId`. The OpenAI/Ollama facades derive a stable id automatically for clients like Home Assistant that resend the whole transcript.

## Example: a family of four

```yaml
policy:
  defaultProfile: guest
  confirmDomains: [lock, alarm_control_panel, cover]
  profiles:
    adult: { allowDomains: ['*'] }
    child:
      allowDomains: [light, media_player]
      areas: ['$room']
      denyEntities: [media_player.living_room_tv]
    guest: { allowDomains: [light] }
  speakers: { parent_1: adult, parent_2: adult }
  rooms: { Kids Room: child }
```

- A parent anywhere can do everything, and still gets asked before unlocking doors or moving blinds.
- In the kids' room, without a recognised adult voice, only the lights and speaker in that room respond.
- Everyone else, anywhere else, can switch lights.

## Debugging your policy

`GET /v1/entities?speaker=…&room=…` lists what a principal can see, whether each entity is `controllable`, and whether it `requiresConfirmation`.

## Trust boundary

`speaker` and `room` are **asserted by the caller**. AURA trusts whatever the voice pipeline or app sends. Only give API keys to components that determine these values honestly, and use a separate key per component.
