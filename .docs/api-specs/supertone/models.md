> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Models

> Compare Supertone TTS models on quality, latency, language coverage, voice settings, and features — and pick the right one for your use case.

Supertone offers five TTS models with different trade-offs between quality, latency, language coverage, and configurability. Use this page to choose the model that fits your product.

## How to choose

| If you need…                                                                                            | Pick                                          |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **The best overall quality**, 23 languages — narration, audiobooks                                      | [`sona_speech_2`](#sona-speech-2)             |
| **A balance of speed and quality** — interactive apps with quality bar                                  | [`sona_speech_2_flash`](#sona-speech-2-flash) |
| **The fastest response with high speech stability**, 31 languages — voice agents, real-time interaction | [`supertonic_api_3`](#supertonic-api-3)       |
| **Chunked streaming** or the full voice-settings surface                                                | [`sona_speech_1`](#sona-speech-1)             |

The model is selected per-request via the `model` field. If omitted, the default is `sona_speech_1`.

## Model summary

| Model                     | Positioning                                                  | Languages | Voice settings                                       | Notable features          |
| ------------------------- | ------------------------------------------------------------ | --------- | ---------------------------------------------------- | ------------------------- |
| **`sona_speech_2`**       | Highest quality                                              | 23        | All except `subharmonic_amplitude_control`           | Phonemes, normalized text |
| **`sona_speech_2_flash`** | Balanced speed and quality                                   | 23        | `pitch_shift`, `pitch_variance`, `speed`, `duration` | Phonemes, normalized text |
| **`supertonic_api_3`**    | Ultra-lightweight, lowest latency, improved speech stability | 31        | `speed` only                                         | —                         |
| **`supertonic_api_1`**    | Legacy supertonic model                                      | 5         | `speed` only                                         | —                         |
| **`sona_speech_1`**       | Legacy flagship                                              | 3         | All voice settings                                   | Streaming, phonemes       |

## Models in detail

### sona\_speech\_2

The most natural, highest-quality voice on the platform with broad multilingual coverage. Recommended for narration, audiobooks, character dialogue, and production-quality marketing audio — anywhere quality matters more than latency.

* **Languages (23):** `en`, `ko`, `ja`, `bg`, `cs`, `da`, `el`, `es`, `et`, `fi`, `hu`, `it`, `nl`, `pl`, `pt`, `ro`, `ar`, `de`, `fr`, `hi`, `id`, `ru`, `vi`
* **Voice settings:** all parameters except `subharmonic_amplitude_control`
* **Extras:** `include_phonemes` (timestamps for lip-sync), `normalized_text` (pronunciation control)
* **Streaming:** not supported

### sona\_speech\_2\_flash

A lightweight variant of `sona_speech_2` optimized for lower latency while keeping the same multilingual coverage. Use it when you care about response time **and** want acceptable quality — for example, interactive agents or batch generation at scale.

* **Languages (23):** same as `sona_speech_2`
* **Voice settings:** `pitch_shift`, `pitch_variance`, `speed`, `duration`
* **Extras:** `include_phonemes`, `normalized_text`
* **Streaming:** not supported

### supertonic\_api\_3

The next-generation successor to `supertonic_api_1` with **significantly improved speech stability**. Trained differently from the open-weights Supertonic 3 release, this API variant inherits the ultra-low latency profile of `supertonic_api_1` while delivering far more reliable pronunciation and reduced reading errors. The best default for voice agents, chatbots, and any real-time experience where time-to-first-audio is the top priority.

* **Languages (31):** `en`, `ko`, `ja`, `ar`, `bg`, `cs`, `da`, `de`, `el`, `es`, `et`, `fi`, `fr`, `hi`, `hr`, `hu`, `id`, `it`, `lt`, `lv`, `nl`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sv`, `tr`, `uk`, `vi`
* **Voice settings:** `speed` only — all other settings are silently ignored
* **Extras:** —
* **Streaming:** not supported (but per-call latency is so low that streaming is usually unnecessary)

### supertonic\_api\_1

The **legacy supertonic model**. Superseded by [`supertonic_api_3`](#supertonic-api-3), which offers broader language coverage and dramatically better speech stability at the same latency profile. Pick `supertonic_api_1` only if you have an existing integration pinned to it; new projects should use `supertonic_api_3`.

* **Languages (5):** `en`, `ko`, `ja`, `es`, `pt`
* **Voice settings:** `speed` only — all other settings are silently ignored
* **Extras:** —
* **Streaming:** not supported

### sona\_speech\_1

The legacy flagship. It supports the full voice-settings surface and is the only model that currently supports **chunked streaming** (`stream_speech`). For most use cases the newer models are a better starting point; pick `sona_speech_1` if you specifically need `stream_speech` output or the full set of fine-tuning parameters (`similarity`, `text_guidance`, `subharmonic_amplitude_control`).

* **Languages (3):** `en`, `ko`, `ja`
* **Voice settings:** all parameters
* **Extras:** `include_phonemes`
* **Streaming:** supported

## Supported languages

`language` is required on every TTS request and must be a value supported by both the model **and** the chosen voice (check the voice's `language` array).

| Code | Language   | `sona_speech_2` | `sona_speech_2_flash` | `supertonic_api_3` | `supertonic_api_1` | `sona_speech_1` |
| ---- | ---------- | :-------------: | :-------------------: | :----------------: | :----------------: | :-------------: |
| `en` | English    |        ✅        |           ✅           |          ✅         |          ✅         |        ✅        |
| `ko` | Korean     |        ✅        |           ✅           |          ✅         |          ✅         |        ✅        |
| `ja` | Japanese   |        ✅        |           ✅           |          ✅         |          ✅         |        ✅        |
| `es` | Spanish    |        ✅        |           ✅           |          ✅         |          ✅         |        —        |
| `pt` | Portuguese |        ✅        |           ✅           |          ✅         |          ✅         |        —        |
| `de` | German     |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `fr` | French     |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `it` | Italian    |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `nl` | Dutch      |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `pl` | Polish     |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `ro` | Romanian   |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `cs` | Czech      |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `da` | Danish     |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `el` | Greek      |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `et` | Estonian   |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `fi` | Finnish    |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `hu` | Hungarian  |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `bg` | Bulgarian  |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `ar` | Arabic     |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `hi` | Hindi      |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `id` | Indonesian |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `ru` | Russian    |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `vi` | Vietnamese |        ✅        |           ✅           |          ✅         |          —         |        —        |
| `hr` | Croatian   |        —        |           —           |          ✅         |          —         |        —        |
| `lt` | Lithuanian |        —        |           —           |          ✅         |          —         |        —        |
| `lv` | Latvian    |        —        |           —           |          ✅         |          —         |        —        |
| `sk` | Slovak     |        —        |           —           |          ✅         |          —         |        —        |
| `sl` | Slovenian  |        —        |           —           |          ✅         |          —         |        —        |
| `sv` | Swedish    |        —        |           —           |          ✅         |          —         |        —        |
| `tr` | Turkish    |        —        |           —           |          ✅         |          —         |        —        |
| `uk` | Ukrainian  |        —        |           —           |          ✅         |          —         |        —        |

Pass the language as a lowercase ISO code string:

```python theme={"dark"}
response = client.text_to_speech.create_speech(
    voice_id=VOICE_ID,
    text="Hello!",
    language="en",
    model="sona_speech_2",
)
```

For multilingual content, fire one request per language rather than mixing languages inside a single `text`. For Japanese inputs with kanji, numbers, units, or symbols, see [Normalized text](/en/docs/text-to-speech/normalized-text).

## Feature support matrix

| Feature                                              | `sona_speech_2` | `sona_speech_2_flash` | `supertonic_api_3` | `supertonic_api_1` | `sona_speech_1` |
| ---------------------------------------------------- | :-------------: | :-------------------: | :----------------: | :----------------: | :-------------: |
| Streaming (`stream_speech`)                          |        —        |           —           |          —         |          —         |        ✅        |
| `include_phonemes`                                   |        ✅        |           ✅           |          —         |          —         |        ✅        |
| `normalized_text`                                    |        ✅        |           ✅           |          —         |          —         |        —        |
| `pitch_shift`, `pitch_variance`, `speed`, `duration` |        ✅        |           ✅           |    `speed` only    |    `speed` only    |        ✅        |
| `similarity`, `text_guidance`                        |        ✅        |           —           |          —         |          —         |        ✅        |
| `subharmonic_amplitude_control`                      |        —        |           —           |          —         |          —         |        ✅        |

## Related

<CardGroup cols={2}>
  <Card title="Voice settings" icon="sliders" href="/en/docs/text-to-speech/voice-settings">
    Reference for every voice-setting parameter and its supported models.
  </Card>

  <Card title="Voices" icon="users" href="/en/docs/core-concepts/voices">
    Find a voice ID that matches your language and style requirements.
  </Card>
</CardGroup>

## On-device TTS

Looking to run TTS **locally on CPU**, with no API call and no network round-trip? Supertone also publishes an open-weights model in the same Supertonic 3 family — **Supertonic 3** (99M parameters, ONNX Runtime, OpenRAIL-M license).

<Warning>
  **Supertonic 3 (open-weights) is a different model from `supertonic_api_3`.** They share the same family name and lineage, but were trained differently and produce different audio. The API model (`supertonic_api_3`) is what's exposed by this API; the open-weights model is a separate on-device release. Don't assume parity in voice quality, supported voices, or behavior.
</Warning>

<CardGroup cols={1}>
  <Card title="Supertonic 3 — On-device TTS ↗" icon="microchip" href="https://supertonic3.github.io/">
    99M-parameter open-weights TTS that runs locally on CPU via ONNX Runtime — 31 languages, no GPU, no cloud, no API. A separate model from `supertonic_api_3`; visit the project site for weights, samples, and SDKs (Python, Node.js, Web, iOS, Android, C++).
  </Card>
</CardGroup>
