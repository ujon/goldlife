> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart

> Install an SDK, set your API key, and generate your first speech audio in under five minutes.

This quickstart walks you through your first Supertone API call — from authentication to a playable audio file.

## 1. Get an API key

The Supertone API uses API-key authentication. Issue one from the developer console:

1. Sign up at [console.supertoneapi.com](https://console.supertoneapi.com).
2. Create a new service and copy the generated key.
3. Store it as an environment variable so it stays out of source control:

```bash theme={"dark"}
export SUPERTONE_API_KEY="Kp9mZ3xQ7v..."
```

<Note>
  You can issue up to 3 API keys per account. If a key leaks, revoke and reissue it from the console.
</Note>

## 2. Generate your first speech

Pick your language below and run the snippet. The Python and TypeScript SDKs handle authentication, retries, and chunking for long text out of the box.

The code uses an example `voice_id` — once you've heard it work, swap it for any voice from [the voice library](/en/docs/core-concepts/voices).

<Tabs>
  <Tab title="Python">
    Install the SDK:

    ```bash theme={"dark"}
    pip install supertone
    # or: uv add supertone
    # or: poetry add supertone
    ```

    Create `quickstart.py`:

    ```python theme={"dark"}
    import os
    from supertone import Supertone

    VOICE_ID = "20160a4c5ba38967330c84"  # example voice — replace with your own

    with Supertone(api_key=os.environ["SUPERTONE_API_KEY"]) as client:
        response = client.text_to_speech.create_speech(
            voice_id=VOICE_ID,
            text="Hello from Supertone. This audio was generated with the Python SDK.",
            language="en",
            output_format="wav",
        )

        with open("speech.wav", "wb") as f:
            f.write(response.result.read())

    print("Saved speech.wav")
    ```

    Run it:

    ```bash theme={"dark"}
    python quickstart.py
    ```
  </Tab>

  <Tab title="TypeScript">
    Install the SDK:

    ```bash theme={"dark"}
    npm add @supertone/supertone
    # or: pnpm add @supertone/supertone
    # or: bun add @supertone/supertone
    # or: yarn add @supertone/supertone zod
    ```

    Create `quickstart.ts`:

    ```typescript theme={"dark"}
    import { Supertone } from "@supertone/supertone";
    import * as fs from "node:fs";

    const VOICE_ID = "20160a4c5ba38967330c84"; // example voice — replace with your own

    const client = new Supertone({ apiKey: process.env.SUPERTONE_API_KEY });

    const response = await client.textToSpeech.createSpeech({
      voiceId: VOICE_ID,
      apiConvertTextToSpeechUsingCharacterRequest: {
        text: "Hello from Supertone. This audio was generated with the TypeScript SDK.",
        language: "en",
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

    console.log("Saved speech.wav");
    ```

    Run it:

    ```bash theme={"dark"}
    npx tsx quickstart.ts
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={"dark"}
    VOICE_ID="20160a4c5ba38967330c84"  # example voice — replace with your own

    curl -X POST "https://supertoneapi.com/v1/text-to-speech/$VOICE_ID" \
      -H "x-sup-api-key: $SUPERTONE_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "text": "Hello from Supertone. This audio was generated with cURL.",
        "language": "en",
        "model": "sona_speech_1"
      }' \
      --output speech.wav
    ```

    The response body is the raw audio file. The `X-Audio-Length` response header tells you how many seconds were generated.
  </Tab>
</Tabs>

Open `speech.wav` — you should hear the line spoken in the example voice.

## 3. What's happening under the hood

| Step                                                   | What it does                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `Supertone(api_key=...)` / `new Supertone({ apiKey })` | Creates a client. The key is sent in the `x-sup-api-key` header.                            |
| `voice_id`                                             | Identifies which character speaks the text.                                                 |
| `text`                                                 | The script to synthesize. Max **300 characters** per API call. SDKs auto-chunk longer text. |
| `language`                                             | Language of the text. Required, and must be supported by the voice and model.               |
| `model`                                                | Defaults to `sona_speech_1`. See [Models](/en/docs/core-concepts/models) for trade-offs.    |
| `output_format`                                        | `wav` (default) or `mp3`.                                                                   |

The SDKs also expose typed enum constants (e.g. `models.APIConvertTextToSpeechUsingCharacterRequestLanguage.EN`) if you prefer type safety over plain strings — both work.

## 4. Next steps

<CardGroup cols={2}>
  <Card title="Find more voices" icon="users" href="/en/docs/core-concepts/voices">
    Browse the preset library and find a `voice_id` for your use case.
  </Card>

  <Card title="Pick a model" icon="layer-group" href="/en/docs/core-concepts/models">
    Choose between `sona_speech_2`, `sona_speech_2_flash`, `supertonic_api_3`, `supertonic_api_1`, and `sona_speech_1`.
  </Card>

  <Card title="Handle long text" icon="align-left" href="/en/docs/text-to-speech/long-text">
    Understand the 300-character API limit and SDK auto-chunking.
  </Card>

  <Card title="Tune the voice" icon="sliders" href="/en/docs/text-to-speech/voice-settings">
    Adjust pitch, intonation, and speed with `voice_settings`.
  </Card>
</CardGroup>
