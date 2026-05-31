> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Voice settings

> Fine-tune pitch, intonation, speed, and other delivery parameters with the `voice_settings` field.

`voice_settings` is an optional object on every TTS request that tunes how the audio is delivered — pitch, intonation, speed, and a few advanced parameters for the flagship models.

## Quick reference

| Setting                         | Range    | Default | What it does                                                              |
| ------------------------------- | -------- | ------- | ------------------------------------------------------------------------- |
| `pitch_shift`                   | -24 → 24 | 0       | Semitone shift. ±12 is one full octave.                                   |
| `pitch_variance`                | 0 → 2    | 1       | How much the pitch varies — lower is flatter, higher is more animated.    |
| `speed`                         | 0.5 → 2  | 1       | Playback rate multiplier. Applied after `duration`.                       |
| `duration`                      | 0 → 60   | 0       | Forces the generated audio to a target length in seconds (0 = no target). |
| `similarity`                    | 1 → 5    | 3       | How closely the output matches the original character voice.              |
| `text_guidance`                 | 0 → 4    | 1       | How sensitively delivery adapts to the text content.                      |
| `subharmonic_amplitude_control` | 0 → 2    | 1       | Amount of subharmonic amplitude in the generated speech.                  |

## Setting voice parameters

<Tabs>
  <Tab title="Python">
    ```python theme={"dark"}
    VOICE_ID = "20160a4c5ba38967330c84"  # replace with your voice ID

    response = client.text_to_speech.create_speech(
        voice_id=VOICE_ID,
        text="Let me tell you a story.",
        language="en",
        model="sona_speech_1",
        voice_settings={
            "pitch_shift": 2,
            "pitch_variance": 1.3,
            "speed": 0.95,
        },
    )
    ```
  </Tab>

  <Tab title="TypeScript">
    ```typescript theme={"dark"}
    const VOICE_ID = "20160a4c5ba38967330c84"; // replace with your voice ID

    const response = await client.textToSpeech.createSpeech({
      voiceId: VOICE_ID,
      apiConvertTextToSpeechUsingCharacterRequest: {
        text: "Let me tell you a story.",
        language: "en",
        model: "sona_speech_1",
        voiceSettings: {
          pitchShift: 2,
          pitchVariance: 1.3,
          speed: 0.95,
        },
      },
    });
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={"dark"}
    VOICE_ID="20160a4c5ba38967330c84"

    curl -X POST "https://supertoneapi.com/v1/text-to-speech/$VOICE_ID" \
      -H "x-sup-api-key: $SUPERTONE_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "Let me tell you a story.",
        "language": "en",
        "model": "sona_speech_1",
        "voice_settings": {
          "pitch_shift": 2,
          "pitch_variance": 1.3,
          "speed": 0.95
        }
      }' \
      --output speech.wav
    ```
  </Tab>
</Tabs>

## Support by model

Not every model honors every setting. Unsupported settings are **silently ignored**, so a `subharmonic_amplitude_control` value on `supertonic_api_3` won't error — it just won't change the output.

| Setting                         | `sona_speech_2` | `sona_speech_2_flash` | `supertonic_api_3` | `supertonic_api_1` | `sona_speech_1` |
| ------------------------------- | :-------------: | :-------------------: | :----------------: | :----------------: | :-------------: |
| `pitch_shift`                   |        ✅        |           ✅           |          —         |          —         |        ✅        |
| `pitch_variance`                |        ✅        |           ✅           |          —         |          —         |        ✅        |
| `speed`                         |        ✅        |           ✅           |          ✅         |          ✅         |        ✅        |
| `duration`                      |        ✅        |           ✅           |          —         |          —         |        ✅        |
| `similarity`                    |        ✅        |           —           |          —         |          —         |        ✅        |
| `text_guidance`                 |        ✅        |           —           |          —         |          —         |        ✅        |
| `subharmonic_amplitude_control` |        —        |           —           |          —         |          —         |        ✅        |

## How parameters interact

* **`pitch_shift` is in semitones.** `+12` raises the voice by a full octave. Use small values (±1 to ±4) for natural-sounding adjustments; large values start to sound robotic.
* **`pitch_variance` controls expressiveness.** Set to 0 for monotone (good for instructional, news-reading style), or up to 2 for very expressive delivery.
* **`duration` then `speed`.** If both are set, the engine first targets `duration` seconds, then `speed` is applied as a multiplier. Setting `duration=5` with `speed=2` produces roughly 10 seconds of audio.
* **`similarity` and `text_guidance`** are most useful on cloned voices and `sona_speech_2`/`sona_speech_1`. Higher `similarity` adheres more strictly to the source voice. Higher `text_guidance` lets delivery shift to match the emotional tone of the text.

## Recipes

**Calm, slow narration:**

```json theme={"dark"}
{ "pitch_variance": 0.7, "speed": 0.9 }
```

**Excited, fast delivery:**

```json theme={"dark"}
{ "pitch_shift": 1, "pitch_variance": 1.5, "speed": 1.15 }
```

**Match a target clip length** (e.g. dub a 6-second scene):

```json theme={"dark"}
{ "duration": 6 }
```

## Related

<CardGroup cols={2}>
  <Card title="Models" icon="layer-group" href="/en/docs/core-concepts/models">
    See which model supports which voice settings.
  </Card>

  <Card title="API reference" icon="book-open" href="/en/api-reference/endpoints/text-to-speech">
    Full request and response schema.
  </Card>
</CardGroup>
