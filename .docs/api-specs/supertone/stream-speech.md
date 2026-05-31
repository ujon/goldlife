> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Stream speech

> Receive audio chunks as they are synthesized — useful when a single clip is long and you want to start playback before generation finishes.

`stream_speech` returns audio chunk-by-chunk so you can start playback or forwarding **before** the full clip is finished. The path is `/v1/text-to-speech/{voice_id}/stream`.

<Note>
  Streaming is currently supported on **`sona_speech_1`** only.
</Note>

## When to use streaming

Streaming is most useful when a **single** TTS clip is long enough that waiting for the whole thing to finish would be noticeable — for example, a multi-sentence paragraph synthesized as one call.

For **interactive agents and chatbots**, where each utterance is a short sentence, you'll usually get better total latency by using a fast non-streaming model:

* **`sona_speech_2_flash`** — balanced speed and quality.
* **`supertonic_api_3`** — fastest inference with high speech stability. Use when time-to-first-audio is the priority.

See [Latency optimization](/en/docs/production/latency-optimization) for the full discussion. The sentence-by-sentence pattern in [Stream TTS from an LLM response](/en/docs/examples/llm-streaming-tts) doesn't use `stream_speech` at all — it relies on fast non-streaming models firing per sentence.

## Basic streaming

<Tabs>
  <Tab title="Python (sync)">
    ```python theme={"dark"}
    from supertone import Supertone

    VOICE_ID = "20160a4c5ba38967330c84"  # replace with your voice ID

    with Supertone(api_key=API_KEY) as client:
        response = client.text_to_speech.stream_speech(
            voice_id=VOICE_ID,
            text="This response is streamed chunk by chunk.",
            language="en",
            model="sona_speech_1",
            output_format="wav",
        )

        with open("streamed.wav", "wb") as f:
            for chunk in response.result.iter_bytes():
                f.write(chunk)
    ```
  </Tab>

  <Tab title="Python (async)">
    ```python theme={"dark"}
    import asyncio
    from supertone import Supertone

    VOICE_ID = "20160a4c5ba38967330c84"  # replace with your voice ID

    async def main():
        async with Supertone(api_key=API_KEY) as client:
            response = await client.text_to_speech.stream_speech_async(
                voice_id=VOICE_ID,
                text="This response is streamed chunk by chunk.",
                language="en",
                model="sona_speech_1",
            )

            with open("streamed.wav", "wb") as f:
                async for chunk in response.result.aiter_bytes():
                    f.write(chunk)

    asyncio.run(main())
    ```
  </Tab>

  <Tab title="TypeScript">
    ```typescript theme={"dark"}
    import { Supertone } from "@supertone/supertone";
    import * as fs from "node:fs";

    const VOICE_ID = "20160a4c5ba38967330c84"; // replace with your voice ID

    const client = new Supertone({ apiKey: API_KEY });

    const response = await client.textToSpeech.streamSpeech({
      voiceId: VOICE_ID,
      apiConvertTextToSpeechUsingCharacterRequest: {
        text: "This response is streamed chunk by chunk.",
        language: "en",
        model: "sona_speech_1",
        outputFormat: "wav",
      },
    });

    if (response.result && typeof response.result === "object" && "getReader" in response.result) {
      const reader = (response.result as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      fs.writeFileSync("streamed.wav", Buffer.concat(chunks));
    }
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={"dark"}
    curl -X POST "https://supertoneapi.com/v1/text-to-speech/20160a4c5ba38967330c84/stream" \
      -H "x-sup-api-key: $SUPERTONE_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "This response is streamed chunk by chunk.",
        "language": "en",
        "model": "sona_speech_1"
      }' \
      --output streamed.wav
    ```

    `curl` writes incoming chunks straight to the file as they arrive.
  </Tab>
</Tabs>

## Request fields

Same as [Create speech](/en/docs/text-to-speech/create-speech), with `model` fixed at `sona_speech_1` (the only model that supports streaming today). The path is `/v1/text-to-speech/{voice_id}/stream`.

## Response

By default, the response body is a **binary audio stream** with `Content-Type` matching `output_format`:

* `audio/wav` — chunks of the WAV file (the first chunk includes the WAV header).
* `audio/mpeg` — chunks of the MP3 file.

When `include_phonemes=true`, the response switches to **NDJSON** — one JSON object per line, each with a base64 audio chunk and the matching phoneme data.

## Streaming a long input

The SDKs auto-chunk text past 300 characters even when streaming. Internally they split the text, send sequential streaming requests, and forward chunks to the caller's iterator — so your reading loop stays the same.

See [Long text](/en/docs/text-to-speech/long-text) for details.

## Tips

* **Player buffering.** Most players need an initial buffer before playback starts. Buffering 1–2 seconds of audio before play tends to feel smoother than playing the first chunk immediately.
* **WAV vs MP3.** WAV chunks are larger but easier to concatenate; MP3 streams are smaller and friendlier for delivery over slow networks.
* **Error handling.** Stream errors can surface mid-read — wrap iteration in your usual error handler and be prepared to retry, especially for transient `429` or `5xx` responses. See [Retries and backoff](/en/docs/production/retries-and-backoff).

## Related

<CardGroup cols={2}>
  <Card title="LLM streaming TTS" icon="robot" href="/en/docs/examples/llm-streaming-tts">
    Sentence-by-sentence pattern for voice agents.
  </Card>

  <Card title="Latency optimization" icon="gauge-high" href="/en/docs/production/latency-optimization">
    Choose the right model and pattern for low latency.
  </Card>
</CardGroup>
