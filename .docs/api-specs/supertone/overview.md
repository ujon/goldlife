> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Welcome

> Production-grade voice AI in 31 languages — character-driven, expressive, and adjustable.

<img src="https://mintcdn.com/supertone-b89202c8/0gAKILFZFHulmmA8/images/hero-dark.svg?fit=max&auto=format&n=0gAKILFZFHulmmA8&q=85&s=b9fad8ef7b8e3e27946fb05ebd3778b3" alt="" width="1920" height="830" data-path="images/hero-dark.svg" />

# Empowering Voices, Simplifying AI Integration

Generate realistic speech, clone custom voices from a short sample, and integrate voice into your product through clean SDKs and a REST API.

## As simple as it sounds

Authenticate, pick a voice, and synthesize:

<Tabs>
  <Tab title="Python">
    ```python theme={"dark"}
    from supertone import Supertone

    with Supertone(api_key=API_KEY) as client:
        response = client.text_to_speech.create_speech(
            voice_id=VOICE_ID,
            text="Hello from Supertone.",
            language="en",
        )
        open("speech.wav", "wb").write(response.result.read())
    ```
  </Tab>

  <Tab title="TypeScript">
    ```typescript theme={"dark"}
    import { Supertone } from "@supertone/supertone";

    const client = new Supertone({ apiKey: API_KEY });
    const response = await client.textToSpeech.createSpeech({
      voiceId: VOICE_ID,
      apiConvertTextToSpeechUsingCharacterRequest: {
        text: "Hello from Supertone.",
        language: "en",
      },
    });
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={"dark"}
    curl -X POST "https://supertoneapi.com/v1/text-to-speech/$VOICE_ID" \
      -H "x-sup-api-key: $SUPERTONE_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"text": "Hello from Supertone.", "language": "en"}' \
      --output speech.wav
    ```
  </Tab>
</Tabs>

The full walkthrough is in the [Quickstart](/en/docs/quickstart).

## Built for production

* ✅ **31 languages** with character identity preserved across each one
* ✅ **150+ premium voices**, with 50+ emotional styles
* ✅ **Voice cloning** from \~10-second audio samples
* ✅ **TTS models for every use case** — from flagship quality (`sona_speech_2`) to ultra-low latency with high speech stability (`supertonic_api_3`)
* ✅ **Fully adjustable** pitch, intonation, and speed via `voice_settings`
* ✅ **Official Python & TypeScript SDKs** with auto-chunking, retries, and async support

## What you can build

Supertone is the voice layer for products shipping today — trusted by entertainment and AI teams to power voice agents, character dialogue, multilingual content, and more.

<CardGroup cols={2}>
  <Card title="AI voice agents" icon="robot" href="/en/docs/examples/llm-streaming-tts">
    Chatbots, virtual assistants, and customer-support agents that respond in real time with emotional range.
  </Card>

  <Card title="Audiobooks & long-form audio" icon="book-open" href="/en/docs/examples/long-form-narration">
    Audiobooks, educational content, and meditation apps — natural delivery over long scripts.
  </Card>

  <Card title="Multilingual product experiences" icon="globe" href="/en/docs/core-concepts/models#supported-languages">
    Localize your product's voice across 23 languages while preserving each character's identity.
  </Card>

  <Card title="In-app audio & accessibility" icon="volume-high">
    Reading mode, voice notifications, audio guides, and accessibility features inside your app.
  </Card>
</CardGroup>

## Get started

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/en/docs/quickstart">
    From zero to a playable audio file in five minutes.
  </Card>

  <Card title="Get an API key" icon="key" href="https://console.supertoneapi.com">
    Issue keys and view your dashboard in the developer console.
  </Card>

  <Card title="API Reference" icon="book-open" href="/en/api-reference/introduction">
    Endpoint-by-endpoint specification.
  </Card>

  <Card title="Enterprise" icon="building" href="https://docs.google.com/forms/d/1YexQpjpK0ZEou12blTytkZLqvrV-Uv95GbhxoOQ54R8/edit">
    Higher limits, dedicated capacity, and custom voices.
  </Card>
</CardGroup>
