> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Create speech

> Generate a complete audio file from text — the most common Supertone TTS call. Covers request fields, output formats, response shape, and saving the result.

`create_speech` converts text into a finished audio file. The full audio is returned in the response body, ready to save or play.

If you need to stream audio chunks as they are synthesized — for example, to start playback before generation finishes — see [Stream speech](/en/docs/text-to-speech/stream-speech) instead.

## Basic usage

<Tabs>
  <Tab title="Python">
    ```python theme={"dark"}
    import os
    from supertone import Supertone

    VOICE_ID = "20160a4c5ba38967330c84"  # replace with your voice ID

    with Supertone(api_key=os.environ["SUPERTONE_API_KEY"]) as client:
        response = client.text_to_speech.create_speech(
            voice_id=VOICE_ID,
            text="Hello from Supertone.",
            language="en",
            model="sona_speech_1",
            output_format="wav",
        )

        with open("speech.wav", "wb") as f:
            f.write(response.result.read())
    ```
  </Tab>

  <Tab title="TypeScript">
    ```typescript theme={"dark"}
    import { Supertone } from "@supertone/supertone";
    import * as fs from "node:fs";

    const VOICE_ID = "20160a4c5ba38967330c84"; // replace with your voice ID

    const client = new Supertone({ apiKey: process.env.SUPERTONE_API_KEY });

    const response = await client.textToSpeech.createSpeech({
      voiceId: VOICE_ID,
      apiConvertTextToSpeechUsingCharacterRequest: {
        text: "Hello from Supertone.",
        language: "en",
        model: "sona_speech_1",
        outputFormat: "wav",
      },
    });

    if (response.result instanceof Uint8Array) {
      fs.writeFileSync("speech.wav", response.result);
    } else if (response.result && "getReader" in response.result) {
      const reader = (response.result as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      fs.writeFileSync("speech.wav", Buffer.concat(chunks));
    }
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={"dark"}
    VOICE_ID="20160a4c5ba38967330c84"  # replace with your voice ID

    curl -X POST "https://supertoneapi.com/v1/text-to-speech/$VOICE_ID" \
      -H "x-sup-api-key: $SUPERTONE_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "Hello from Supertone.",
        "language": "en",
        "model": "sona_speech_1",
        "output_format": "wav"
      }' \
      --output speech.wav
    ```
  </Tab>
</Tabs>

## Request fields

| Field              | Required | Description                                                                                                                                                 |
| ------------------ | :------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice_id`         |     ✅    | Path parameter — identifies the character.                                                                                                                  |
| `text`             |     ✅    | The text to synthesize. **Max 300 characters per API call** (SDKs auto-chunk longer text).                                                                  |
| `language`         |     ✅    | Language code. Must be supported by the voice and the model.                                                                                                |
| `style`            |     —    | Emotional style (e.g. `neutral`, `happy`). Defaults to the first style in the voice's `styles` array.                                                       |
| `model`            |     —    | TTS model. Defaults to `sona_speech_1`. See [Models](/en/docs/core-concepts/models).                                                                        |
| `output_format`    |     —    | `wav` (default) or `mp3`. See [Output formats](#output-formats) below.                                                                                      |
| `voice_settings`   |     —    | Pitch, intonation, speed, etc. See [Voice settings](/en/docs/text-to-speech/voice-settings).                                                                |
| `include_phonemes` |     —    | When `true`, returns phoneme symbols and timestamps. See [Pronunciation and phonemes](/en/docs/text-to-speech/pronunciation-and-phonemes).                  |
| `normalized_text`  |     —    | Pronunciation-normalized companion text (currently for Japanese on `sona_speech_2` family). See [Normalized text](/en/docs/text-to-speech/normalized-text). |

For the complete schema, see [Create speech (API reference)](/en/api-reference/endpoints/text-to-speech).

## Output formats

| Format        | `output_format` value | Content type | Use when                                                                                                     |
| ------------- | --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| WAV (default) | `wav`                 | `audio/wav`  | You want lossless audio — best for production audio pipelines, further processing, or game/animation assets. |
| MP3           | `mp3`                 | `audio/mpeg` | You want smaller files for delivery to end-user devices and don't need lossless quality.                     |

If you omit `output_format`, the API defaults to `wav`. The same option applies to [Stream speech](/en/docs/text-to-speech/stream-speech) — chunks come back as binary in the requested format.

## Response

By default the API returns **binary audio** in the body. The response carries two useful headers:

| Header           | Meaning                                                |
| ---------------- | ------------------------------------------------------ |
| `Content-Type`   | `audio/wav` or `audio/mpeg`, matching `output_format`. |
| `X-Audio-Length` | Duration of the generated audio in seconds (float).    |

### When `include_phonemes=true`

If you opt in to phoneme timestamps, the response **switches to JSON** with a base64-encoded audio payload alongside the phoneme arrays:

```json theme={"dark"}
{
  "audio_base64": "UklGRnoGAABXQVZF...",
  "phonemes": {
    "symbols": ["", "h", "ɐ", "ɡ", "ʌ", ""],
    "start_times_seconds": [0, 0.092, 0.197, 0.255, 0.29, 0.58],
    "durations_seconds": [0.092, 0.104, 0.058, 0.034, 0.29, 0.162]
  }
}
```

See [Pronunciation and phonemes](/en/docs/text-to-speech/pronunciation-and-phonemes) for the full structure.

## Save the result

<Tabs>
  <Tab title="Python">
    ```python theme={"dark"}
    response = client.text_to_speech.create_speech(...)
    with open("speech.wav", "wb") as f:
        f.write(response.result.read())
    ```
  </Tab>

  <Tab title="TypeScript">
    ```typescript theme={"dark"}
    import * as fs from "node:fs";

    const response = await client.textToSpeech.createSpeech(...);

    if (response.result instanceof Uint8Array) {
      fs.writeFileSync("speech.wav", response.result);
    } else if (response.result && "getReader" in response.result) {
      const reader = (response.result as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      fs.writeFileSync("speech.wav", Buffer.concat(chunks));
    }
    ```
  </Tab>
</Tabs>

## Tips

* **Style matters.** Different voices may have different default styles. Either explicitly set `style`, or call [Get voice](/en/api-reference/endpoints/get-voice) once at startup to read the voice's default.
* **Estimate before you generate.** [`predict_duration`](/en/docs/production/cost-and-usage#predict-duration) returns the expected audio length without consuming credits — useful for UI hints and cost forecasting.
* **Long text.** The raw API caps `text` at 300 characters. The Python and TypeScript SDKs split, generate, and merge automatically — see [Long text](/en/docs/text-to-speech/long-text).
* **Empty or very short input** can produce unnatural results. Aim for at least a complete short sentence.

## Related

<CardGroup cols={2}>
  <Card title="Pick a model" icon="layer-group" href="/en/docs/core-concepts/models">
    Choose between fast and high-quality TTS models.
  </Card>

  <Card title="Long text" icon="align-left" href="/en/docs/text-to-speech/long-text">
    Generate audio from text longer than 300 characters.
  </Card>

  <Card title="Voice settings" icon="sliders" href="/en/docs/text-to-speech/voice-settings">
    Tune pitch, intonation, and speed.
  </Card>

  <Card title="API reference" icon="book-open" href="/en/api-reference/endpoints/text-to-speech">
    Full request and response schema.
  </Card>
</CardGroup>
