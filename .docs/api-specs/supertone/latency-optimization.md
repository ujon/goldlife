> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Latency optimization

> Reduce time-to-audio in real-time experiences — model choice, sentence batching, and connection reuse.

For real-time experiences like voice agents and chatbots, **time-to-first-audio** matters more than total throughput. Use this guide to keep that number low.

## The latency stack

Total latency is roughly:

```
input → LLM token stream → text buffer → TTS request → first audio chunk → playback
```

Each layer adds latency. Optimize from the layer with the biggest contribution.

## 1. Pick the fastest model that fits your quality bar

Model choice is usually the biggest lever you have.

| Model                     | When to use it                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`sona_speech_2`**       | When quality is the priority and you can afford the latency. Highest-quality model.                                                                                                                           |
| **`sona_speech_2_flash`** | When you want a balance of speed and quality. Lower latency than `sona_speech_2`, with similar quality. Supports voice settings and `normalized_text`.                                                        |
| **`supertonic_api_3`**    | When speed is the top priority. Lowest-overhead inference and best time-to-first-audio, now with significantly improved speech stability over `supertonic_api_1`. Voice settings are limited to `speed` only. |
| **`supertonic_api_1`**    | Legacy supertonic model. Use only for existing integrations pinned to it; new projects should prefer `supertonic_api_3`. Voice settings are limited to `speed` only.                                          |
| **`sona_speech_1`**       | When you specifically need `stream_speech` chunked output, or the full set of voice settings (`similarity`, `text_guidance`, `subharmonic_amplitude_control`).                                                |

For most interactive agents and chatbots, **`sona_speech_2_flash` or `supertonic_api_3` will outperform streaming on `sona_speech_1`** simply because each call returns faster overall.

See [Models](/en/docs/core-concepts/models) for the full feature matrix.

## 2. Batch tokens into sentences

If you're piping an LLM into TTS, don't send one token per request. Group tokens into sentence-sized chunks and fire one TTS request per sentence. See [Stream TTS from an LLM response](/en/docs/examples/llm-streaming-tts) for runnable examples.

A reasonable batching strategy:

* Flush on sentence-ending punctuation (`.`, `!`, `?`, `。`, `！`, `？`).
* Flush after a comma once the buffer exceeds \~60 characters (to keep first-audio latency tight).
* Flush at end-of-stream.

## 3. Use streaming only when it actually helps

`stream_speech` (on `sona_speech_1`) returns audio chunk-by-chunk and is useful when:

* A single piece of input is long enough that waiting for the whole clip would be noticeable, and
* You want to start playback before the full clip is ready.

For short, sentence-sized inputs, **a non-streaming call on a fast model is usually faster end-to-end** than streaming on a slower one — because each call completes more quickly.

```python theme={"dark"}
# Often the fastest option for an interactive agent:
response = client.text_to_speech.create_speech(
    voice_id=VOICE_ID,
    text=sentence,
    language="en",
    model="supertonic_api_3",
)
```

## 4. Reuse connections

Both SDKs reuse a single HTTPS connection across calls when you use a single client and a context manager. Don't construct a new client per call — TLS setup adds 100–500 ms.

<Tabs>
  <Tab title="Python">
    ```python theme={"dark"}
    # Good: one client, reused across requests
    with Supertone(api_key=API_KEY) as client:
        for sentence in sentences:
            client.text_to_speech.create_speech(...)

    # Bad: constructs a new client (and TCP/TLS handshake) per call
    for sentence in sentences:
        with Supertone(api_key=API_KEY) as client:
            client.text_to_speech.create_speech(...)
    ```
  </Tab>

  <Tab title="TypeScript">
    ```typescript theme={"dark"}
    // Good: one client, reused across requests
    const client = new Supertone({ apiKey: API_KEY });
    for (const sentence of sentences) {
      await client.textToSpeech.createSpeech({ /* ... */ });
    }
    ```
  </Tab>
</Tabs>

## 5. Tune retries to your latency budget

Aggressive retries on a slow connection will *worsen* perceived latency. Keep `maxElapsedTime` proportional to your SLO — for an agent that should respond within 2 seconds, don't budget 60 seconds of retries.

See [Retries and backoff](/en/docs/production/retries-and-backoff) for tuning.

## 6. Pre-warm at startup

If your service has a burst of traffic right after deployment, make a single TTS call on startup to warm DNS, TLS, and connection pools. Subsequent calls will be faster.

## 7. Locate close to the API

The Supertone API is hosted at `supertoneapi.com`. If your service runs in a faraway region, the network round-trip itself can dominate latency for short clips. Co-locate your service or add edge proxies as needed.

## Measuring time-to-first-audio

Wrap your call to measure precisely where the time goes:

```python theme={"dark"}
import time

start = time.perf_counter()
response = client.text_to_speech.create_speech(
    voice_id=VOICE_ID,
    text="Hello!",
    language="en",
    model="supertonic_api_3",
)
audio = response.result.read()
end = time.perf_counter()

print(f"Total time: {end - start:.3f}s   audio bytes: {len(audio)}")
```

Track this metric in production — when it regresses, the cause is usually one of: model change, network change, retry tuning, or queueing in your own service.

## Related

<CardGroup cols={2}>
  <Card title="Models" icon="layer-group" href="/en/docs/core-concepts/models">
    Model trade-offs in detail.
  </Card>

  <Card title="LLM streaming TTS" icon="robot" href="/en/docs/examples/llm-streaming-tts">
    End-to-end recipe for low-latency voice agents.
  </Card>
</CardGroup>
